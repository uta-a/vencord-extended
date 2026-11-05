/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createHash } from "crypto";
import path from "path";

import { readZip } from "./zip";

/**
 * VoiceCord のランタイム（engine.mjs・hook.js・frida）の取得と入れ替え。
 *
 * Vencord の更新は patcher.js などの 4 ファイルしか取りに行かない。ランタイムは別の zip で配り、
 * patcher.js にビルド時に埋めた「必要な版・zip の sha256・取得元」と、手元の manifest.json を比べて、
 * 食い違うときだけ取得する。
 *
 * - zip の検証は埋めた sha256 だけで行う。zip の中の manifest は zip と同じ出どころなので、検証には使わない
 *   （展開した版の記録にだけ使う）
 * - 展開は `<dir>.tmp` で行い、終わってから `<dir>.next` へ名前を変える。中途半端な展開は使われない
 * - 実行中のエンジンは frida の .node を掴んでいるので、入れ替えはエンジンを起こす前（次の起動時）に行う。
 *   ランタイムがまだ無いときだけ、取得してすぐに入れ替える
 */

export interface RequiredRuntime {
    /** ランタイムの中身から作った版（manifest.json の version と比べる） */
    version: string;
    /** zip の sha256（16 進） */
    sha256: string;
    /** zip の取得元（GitHub のリリースの添付） */
    url: string;
}

export interface RuntimeFs {
    existsSync(p: string): boolean;
    readFileSync(p: string, enc: "utf8"): string;
    writeFileSync(p: string, data: Buffer | string): void;
    mkdirSync(p: string, opts: { recursive: true; }): unknown;
    rmSync(p: string, opts: { recursive: true; force: true; }): void;
    renameSync(from: string, to: string): void;
}

export const MANIFEST = "manifest.json";
const ENGINE = "engine.mjs";

export type RuntimeState = "ok" | "missing" | "outdated";

function manifestVersion(fs: RuntimeFs, dir: string): string | null {
    try {
        const m = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), "utf8")) as { version?: unknown; };
        return typeof m.version === "string" ? m.version : null;
    } catch {
        return null;
    }
}

/** 手元のランタイムの状態。エンジンが無ければ missing、版が違えば（記録が無い場合も）outdated */
export function runtimeState(fs: RuntimeFs, dir: string, required: RequiredRuntime): RuntimeState {
    if (!fs.existsSync(path.join(dir, ENGINE))) return "missing";
    return manifestVersion(fs, dir) === required.version ? "ok" : "outdated";
}

/**
 * 前回までに用意した `<dir>.next` が必要な版なら、今のランタイムと入れ替える。エンジンを起こす前に呼ぶ。
 * 入れ替えたら true。版が違う `.next`（さらに新しい版が出た後の残り）は捨てる
 */
export function applyStagedRuntime(fs: RuntimeFs, dir: string, required: RequiredRuntime): boolean {
    const next = `${dir}.next`;
    if (!fs.existsSync(next)) return false;
    if (manifestVersion(fs, next) !== required.version || !fs.existsSync(path.join(next, ENGINE))) {
        fs.rmSync(next, { recursive: true, force: true });
        return false;
    }
    const old = `${dir}.old`;
    fs.rmSync(old, { recursive: true, force: true });
    if (fs.existsSync(dir)) fs.renameSync(dir, old);
    try {
        fs.renameSync(next, dir);
    } catch (e) {
        // 戻せるなら戻す。ランタイムが無い状態にしない
        if (!fs.existsSync(dir) && fs.existsSync(old)) fs.renameSync(old, dir);
        throw e;
    }
    // 古い版は消せなくても困らない（次の入れ替えの前に消す）
    try {
        fs.rmSync(old, { recursive: true, force: true });
    } catch { }
    return true;
}

export function sha256Hex(buf: Buffer): string {
    return createHash("sha256").update(buf).digest("hex");
}

/**
 * zip を取得して検証し、`<dir>.next` に展開する。検証に通らなければ何も残さずに throw する
 */
export async function stageRuntime(
    fs: RuntimeFs,
    dir: string,
    required: RequiredRuntime,
    fetchZip: (url: string) => Promise<Buffer>
): Promise<void> {
    const buf = await fetchZip(required.url);
    const actual = sha256Hex(buf);
    if (actual !== required.sha256.toLowerCase()) {
        throw new Error(`ランタイムの検証に失敗しました（sha256 が一致しません。期待 ${required.sha256.slice(0, 12)}…、実際 ${actual.slice(0, 12)}…）`);
    }
    const entries = readZip(buf);
    const manifest = entries.find(e => e.name === MANIFEST);
    let version: unknown = null;
    try {
        version = manifest ? (JSON.parse(manifest.data.toString("utf8")) as { version?: unknown; }).version : null;
    } catch { }
    // sha256 が合っていれば中身はビルドしたものなので、ここで食い違うのはビルドの誤り
    if (version !== required.version) throw new Error("ランタイムの zip の版が、必要な版と一致しません");

    const tmp = `${dir}.tmp`;
    const next = `${dir}.next`;
    fs.rmSync(tmp, { recursive: true, force: true });
    try {
        for (const e of entries) {
            const to = path.join(tmp, ...e.name.split("/"));
            fs.mkdirSync(path.dirname(to), { recursive: true });
            fs.writeFileSync(to, e.data);
        }
        fs.rmSync(next, { recursive: true, force: true });
        fs.renameSync(tmp, next);
    } catch (e) {
        fs.rmSync(tmp, { recursive: true, force: true });
        throw e;
    }
}
