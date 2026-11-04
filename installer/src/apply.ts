/*
 * Vencord Extended installer
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// VoiceCord Manager（voicecord-module/src/manager/patch/apply.ts）由来。
// 連鎖 shim をやめ、patcher.js を 1 つだけ require する shim にした。

import { createHash } from "crypto";
import fs from "fs";
import { join, win32 } from "path";

import { type AppAsarKind, buildFlatAsar, classifyAppAsar, classifyAsarBytes } from "./asar";
import { renderShimSource, SHIM_PACKAGE_JSON } from "./shim";

/**
 * app.asar の差し替えは破壊的で、失敗すると Discord が起動しなくなる。
 * 「常に app.asar が存在する状態を保つ」ことを最優先に組んである:
 *   1. 素の Discord なら copy（rename ではない）で _app.asar を作る
 *   2. shim を <resources>/vencord-extended-shim.tmp に書く（パスに .asar を含めない）
 *   3. 同一ボリューム上の rename で app.asar へ差し替える
 *   4. 書いたものを読み直して検証し、駄目なら _app.asar から戻す
 */

export interface PatchTarget {
    resourcesDir: string;
    appAsar: string;
    backupAsar: string;
    /** パスに .asar を含めないこと */
    tmpFile: string;
}

export function targetFor(resourcesDir: string): PatchTarget {
    return {
        resourcesDir,
        appAsar: join(resourcesDir, "app.asar"),
        backupAsar: join(resourcesDir, "_app.asar"),
        tmpFile: join(resourcesDir, "vencord-extended-shim.tmp")
    };
}

export interface InstallPlanOk {
    ok: true;
    patcher: string;
    /** 置き換えで外れる既存の mod（表示用）。空なら何も外さない */
    replaces: string[];
    needsBackup: boolean;
    current: AppAsarKind;
    appSha256: string;
    backupSha256: string | null;
}

export type InstallPlan = InstallPlanOk | { ok: false; reason: string; };

/** Windows のパスは大文字小文字と区切り文字の違いを無視して比べる */
export function samePath(a: string, b: string): boolean {
    return win32.normalize(a).toLowerCase() === win32.normalize(b).toLowerCase();
}

/** Vencord 系の shim が require する patcher に見えるか */
function looksLikePatcher(p: string): boolean {
    return /[\\/]patcher\.js$/i.test(p);
}

/**
 * 適用計画を立てる。ここで弾いた場合は一切ファイルを触らない。
 * 分類したバイト列そのもののハッシュを記録し、実行時に変化を検出する。
 */
export function planInstall(t: PatchTarget, patcher: string): InstallPlan {
    if (!fs.existsSync(t.appAsar)) return { ok: false, reason: `app.asar が見つかりません: ${t.appAsar}` };
    const appBytes = fs.readFileSync(t.appAsar);
    const current = classifyAsarBytes(appBytes, t.appAsar);
    const backupBytes = fs.existsSync(t.backupAsar) ? fs.readFileSync(t.backupAsar) : null;
    const backup: AppAsarKind = backupBytes ? classifyAsarBytes(backupBytes, t.backupAsar) : { kind: "missing" };
    const base = { appSha256: sha256(appBytes), backupSha256: backupBytes ? sha256(backupBytes) : null };

    if (current.kind === "missing") return { ok: false, reason: `app.asar が見つかりません: ${t.appAsar}` };
    if (current.kind === "unknown") {
        return { ok: false, reason: `app.asar の中身が想定外です。手を触れずに中断しました（${current.reason}）` };
    }

    if (current.kind === "plain") {
        if (backup.kind !== "missing" && backup.kind !== "plain") {
            return { ok: false, reason: `_app.asar が Discord 本体ではありません（${backup.kind}）。手動での確認が必要です` };
        }
        // 既に妥当な _app.asar があるならそれを温存する（既知の正本を上書きしない）
        return { ok: true, patcher, replaces: [], needsBackup: backup.kind === "missing", current, ...base };
    }

    // ここから先は app.asar が shim。本体は _app.asar にあるはず
    if (backup.kind === "missing") {
        return {
            ok: false,
            reason: "app.asar が shim なのに _app.asar がありません。Discord 本体の所在が不明なため中断しました。Discord の再インストールが必要です"
        };
    }
    if (backup.kind !== "plain") {
        return { ok: false, reason: `_app.asar が Discord 本体ではありません（${backup.kind}）。手動での確認が必要です` };
    }

    let replaces: string[];
    switch (current.kind) {
        case "extended":
            replaces = samePath(current.patcher, patcher) ? [] : [current.patcher];
            break;
        case "legacyChain":
            replaces = current.chain.map(c => `${current.owner}: ${c}`);
            break;
        case "foreignShim":
            // 正体の分かる Vencord 系（patcher.js を require するだけ）しか置き換えない
            if (current.requires.length === 0 || !current.requires.every(looksLikePatcher)) {
                return {
                    ok: false,
                    reason: `app.asar に正体の分からない mod の shim が入っています（${current.requires.join(", ") || "require なし"}）。手を触れずに中断しました`
                };
            }
            replaces = current.requires;
            break;
    }
    return { ok: true, patcher, replaces, needsBackup: false, current, ...base };
}

export interface InstallResult {
    patcher: string;
    replaced: string[];
    backedUp: boolean;
}

/** 計画を実行する。呼び出し前に Discord が起動していないことを必ず確認すること */
export function applyInstall(t: PatchTarget, plan: InstallPlanOk): InstallResult {
    if (!fs.existsSync(t.appAsar) || sha256(fs.readFileSync(t.appAsar)) !== plan.appSha256) {
        throw new Error("app.asar が計画時から変わっています。やり直してください");
    }
    const backupExists = fs.existsSync(t.backupAsar);
    if (
        (plan.backupSha256 === null && backupExists)
        || (plan.backupSha256 !== null && (!backupExists || sha256(fs.readFileSync(t.backupAsar)) !== plan.backupSha256))
    ) {
        throw new Error("_app.asar が計画時から変わっています。やり直してください");
    }

    // rename ではなく copy。ここで落ちても app.asar は残る
    if (plan.needsBackup) fs.copyFileSync(t.appAsar, t.backupAsar);

    writeShim(t, plan.patcher);

    const written = classifyAppAsar(t.appAsar);
    if (written.kind !== "extended" || !samePath(written.patcher, plan.patcher)) {
        rollback(t);
        throw new Error(`shim の書き込み検証に失敗しました（${written.kind}）。_app.asar から復旧しました`);
    }
    return { patcher: plan.patcher, replaced: plan.replaces, backedUp: plan.needsBackup };
}

function writeShim(t: PatchTarget, patcher: string) {
    const shim = buildFlatAsar({
        "index.js": renderShimSource(patcher),
        "package.json": SHIM_PACKAGE_JSON
    });
    fs.writeFileSync(t.tmpFile, shim);
    fs.renameSync(t.tmpFile, t.appAsar);
}

export interface UninstallResult {
    /** _app.asar から素の Discord に戻したか（false なら元から素だった） */
    restored: boolean;
}

/**
 * 素の Discord に戻す。このインストーラの shim でなければ拒む
 * （他の mod を知らないうちに外さないため）。
 */
export function uninstall(t: PatchTarget): UninstallResult {
    const current = classifyAppAsar(t.appAsar);
    if (current.kind === "plain") return { restored: false };
    if (current.kind !== "extended") {
        throw new Error(`app.asar は vencord-extended の shim ではありません（${current.kind}）。手を触れずに中断しました`);
    }
    const backup = classifyAppAsar(t.backupAsar);
    if (backup.kind !== "plain") {
        throw new Error(`_app.asar が Discord 本体ではありません（${backup.kind}）。手動での復旧が必要です`);
    }
    // copy → 検証 → 削除の順にする。rename 一発だと途中で落ちたとき両方消える
    fs.copyFileSync(t.backupAsar, t.tmpFile);
    fs.renameSync(t.tmpFile, t.appAsar);
    if (classifyAppAsar(t.appAsar).kind !== "plain") {
        throw new Error("復元後の app.asar が Discord 本体として読めません");
    }
    fs.unlinkSync(t.backupAsar);
    return { restored: true };
}

function rollback(t: PatchTarget) {
    try {
        fs.copyFileSync(t.backupAsar, t.tmpFile);
        fs.renameSync(t.tmpFile, t.appAsar);
    } catch {
        // ここまで来たら自動復旧は諦める。呼び出し側が復旧手順を案内する
    }
}

export function sha256(buf: Buffer): string {
    return createHash("sha256").update(buf).digest("hex");
}
