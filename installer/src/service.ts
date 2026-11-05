/*
 * Vencord Extended installer
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// VoiceCord Manager（voicecord-module/src/manager/service.ts）由来。
// 既定では Discord を終了させない。起動中なら断って理由を返し、
// 利用者が明示的に選んだ（forceClose）ときだけ強制終了し、終わったら再起動する。

import fs from "fs";
import { dirname, join, resolve } from "path";

import { applyInstall, planInstall, targetFor, uninstall } from "./apply";
import { isRunning, type ProcessLister, type RunningCheck } from "./running";
import { BRANCHES, type DiscordInstall, scanInstalls } from "./scan";

export interface Paths {
    /** %LOCALAPPDATA%\VencordExtended */
    root: string;
    /** shim が require する patcher.js の置き場 */
    dist: string;
    patcher: string;
}

/**
 * 配置先。公式 Vencord の dist（%APPDATA%\Vencord\dist）とは分ける。
 * データディレクトリ（設定）は共有するが、dist まで同じだと公式インストーラの修復で上書きされる。
 */
export function pathsFor(localAppData: string): Paths {
    const root = join(localAppData, "VencordExtended");
    const dist = join(root, "dist");
    return { root, dist, patcher: join(dist, "patcher.js") };
}

export interface ServiceDeps {
    localAppData: string;
    listProcesses: ProcessLister;
    killProcess: (imageName: string) => void;
    sleep: (ms: number) => void;
    /** <rootDir>\Update.exe --processStart <exeName> で Discord を起動する */
    startDiscord: (rootDir: string, exeName: string) => void;
}

/** dist の用意の仕方 */
export type DistSource =
    /** 開発用。リポジトリの dist へジャンクションを張る */
    | { kind: "link"; dir: string; }
    /** 配布用。フォルダの中身をコピーする */
    | { kind: "copy"; dir: string; };

export type OpResult = { ok: boolean; message: string; };

export function findInstall(deps: ServiceDeps, branch: string): DiscordInstall | undefined {
    return scanInstalls(deps.localAppData).find(i => i.spec.branch === branch);
}

/** 置き換えで外れるものを適用前に見せるための下見 */
export function previewInstall(deps: ServiceDeps, install: DiscordInstall) {
    return planInstall(targetFor(install.resourcesDir), pathsFor(deps.localAppData).patcher);
}

export interface InstallOptions {
    /** 修復。VoiceCord のランタイムも消し、次の起動で取り直させる（壊れたランタイムを直すため） */
    resetRuntime?: boolean;
}

export function installTo(deps: ServiceDeps, install: DiscordInstall, source: DistSource, forceClose = false, opts: InstallOptions = {}): OpResult {
    // ランタイムはすべての Discord で共有している。ほかのブランチが動いていると、そのエンジンが使っているものを消してしまう
    if (opts.resetRuntime) {
        const others = BRANCHES.filter(b => b.exeName !== install.spec.exeName && isRunning(deps.listProcesses, b.exeName).running);
        if (others.length > 0) {
            return {
                ok: false,
                message: `${others.map(b => b.label).join("・")} が起動しています。VoiceCord のランタイムはすべての Discord で共有しているため、終了してから修復してください`
            };
        }
    }
    return withDiscordClosed(deps, install, forceClose, () => {
        const paths = pathsFor(deps.localAppData);
        const plan = planInstall(targetFor(install.resourcesDir), paths.patcher);
        if (!plan.ok) return { ok: false, message: plan.reason };

        // shim が指す先を先に用意する。逆だと patcher が無い状態で Discord が起動してしまう
        try {
            deployDist(paths, source);
            // Discord が止まっている間に消す（起動中はエンジンが frida の .node を掴んでいて消せない）
            if (opts.resetRuntime) resetRuntime(paths);
        } catch (e) {
            return { ok: false, message: `dist の配置に失敗しました: ${msg(e)}` };
        }

        try {
            const res = applyInstall(targetFor(install.resourcesDir), plan);
            const replaced = res.replaced.length > 0 ? `\n置き換えたもの: ${res.replaced.join(", ")}` : "";
            return { ok: true, message: `${install.spec.label} ${install.version} に適用しました${replaced}` };
        } catch (e) {
            return { ok: false, message: msg(e) };
        }
    });
}

export function uninstallFrom(deps: ServiceDeps, install: DiscordInstall, forceClose = false): OpResult {
    return withDiscordClosed(deps, install, forceClose, () => {
        try {
            const res = uninstall(targetFor(install.resourcesDir));
            return {
                ok: true,
                message: res.restored
                    ? `${install.spec.label} を素の状態に戻しました`
                    : `${install.spec.label} には何も入っていません`
            };
        } catch (e) {
            return { ok: false, message: msg(e) };
        }
    });
}

export function deployDist(paths: Paths, source: DistSource) {
    const src = resolve(source.dir);
    if (!fs.existsSync(join(src, "patcher.js"))) {
        throw new Error(`patcher.js がありません: ${src}（先に pnpm build を実行してください）`);
    }
    fs.mkdirSync(paths.root, { recursive: true });
    const existing = lstatOrNull(paths.dist);

    if (source.kind === "link") {
        if (existing?.isSymbolicLink()) {
            if (samePathReal(paths.dist, src)) return;
            fs.unlinkSync(paths.dist);
        } else if (existing) {
            throw new Error(`${paths.dist} に配布版のファイルが置かれています。開発用のリンクに切り替えるには、このフォルダを手動で削除してください`);
        }
        fs.symlinkSync(src, paths.dist, "junction");
        return;
    }

    // コピーのときにリンクが残っていると、リポジトリの dist を書き換えてしまう
    if (existing?.isSymbolicLink()) fs.unlinkSync(paths.dist);
    fs.cpSync(src, paths.dist, { recursive: true });
}

/** VoiceCord のランタイム（用意中・入れ替え待ちの分も）を消す。patcher.js が次の起動で取り直す */
export function resetRuntime(paths: Paths) {
    // 開発用のリンクのときはリポジトリの dist を指しているので触らない
    if (lstatOrNull(paths.dist)?.isSymbolicLink()) return;
    for (const suffix of ["", ".next", ".tmp", ".old"]) {
        fs.rmSync(join(paths.dist, `voicecord${suffix}`), { recursive: true, force: true });
    }
}

function lstatOrNull(p: string) {
    try {
        return fs.lstatSync(p);
    } catch {
        return null;
    }
}

function samePathReal(a: string, b: string) {
    try {
        return fs.realpathSync(a).toLowerCase() === fs.realpathSync(b).toLowerCase();
    } catch {
        return false;
    }
}

const EXIT_POLL_MS = 250;
const EXIT_TIMEOUT_MS = 10_000;

/**
 * Discord が起動していない状態で op を行う。
 * forceClose なら強制終了して終了を確かめてから行い、op の成否にかかわらず最後に再起動する。
 */
function withDiscordClosed(deps: ServiceDeps, install: DiscordInstall, forceClose: boolean, op: () => OpResult): OpResult {
    const { exeName, label } = install.spec;
    const check: RunningCheck = isRunning(deps.listProcesses, exeName);
    if (!check.running) return op();
    if (!forceClose) {
        return { ok: false, message: `${label} が起動しています。終了してから実行するか、--force-close を付けてください（PID ${check.pids.join(", ") || "不明"}）` };
    }
    // tasklist が失敗して判定できないだけのときは、落とすべきプロセスがあるか分からないので進まない
    if (check.pids.length === 0) {
        return { ok: false, message: `${label} の起動状態を確認できません。手動で終了してからもう一度実行してください` };
    }
    try {
        deps.killProcess(exeName);
    } catch {
        // 確認の間に自分で終了していても taskkill は失敗する。終わったかどうかは下で確かめる
    }
    if (!waitForExit(deps, exeName)) {
        return { ok: false, message: `${label} を終了できませんでした。タスクマネージャーで ${exeName} を終了してから、もう一度実行してください` };
    }

    let result: OpResult;
    try {
        result = op();
    } catch (e) {
        result = { ok: false, message: msg(e) };
    }
    return { ...result, message: `${result.message}\n${restartDiscord(deps, install)}` };
}

function waitForExit(deps: ServiceDeps, exeName: string): boolean {
    for (let waited = 0; ; waited += EXIT_POLL_MS) {
        if (!isRunning(deps.listProcesses, exeName).running) return true;
        if (waited >= EXIT_TIMEOUT_MS) return false;
        deps.sleep(EXIT_POLL_MS);
    }
}

function restartDiscord(deps: ServiceDeps, install: DiscordInstall): string {
    // Update.exe は app-<version> の親にある。app 内の exe を直接起動すると更新や古い版の掃除が働かない
    const rootDir = dirname(install.appDir);
    const manual = `${install.spec.label} を手動で起動してください`;
    if (!fs.existsSync(join(rootDir, "Update.exe"))) return `Update.exe が見つからないため再起動できませんでした。${manual}`;
    try {
        deps.startDiscord(rootDir, install.spec.exeName);
    } catch (e) {
        return `${install.spec.label} を再起動できませんでした（${msg(e)}）。${manual}`;
    }
    return `${install.spec.label} の再起動を開始しました`;
}

function msg(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}
