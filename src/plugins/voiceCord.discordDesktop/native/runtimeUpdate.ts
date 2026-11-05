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
 * - 展開は取得ごとに別の `<dir>.tmp-<pid>-<時刻>` で行い、終わってから `<dir>.next` へ名前を変える。
 *   中途半端な展開は使われない
 * - 実行中のエンジンは frida の .node を掴んでいるので、入れ替えはエンジンを起こす前（次の起動時）に行う。
 *   ランタイムがまだ無いときだけ、取得してすぐに入れ替える
 * - 置き場所（dist）は Stable・Canary など複数の Discord で共有しうる。`.next` を置く処理と入れ替えは
 *   `<dir>.lock` で排他し、ほかのプロセスが持っていれば今回は見送る
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
    openSync(p: string, flags: "wx"): number;
    closeSync(fd: number): void;
    statSync(p: string): { mtimeMs: number; };
    unlinkSync(p: string): void;
}

export const MANIFEST = "manifest.json";
const ENGINE = "engine.mjs";

// ロックを持ったまま落ちたプロセスの残りと見なす時間。ロックの中は rename と小さな削除だけなので十分長い
const LOCK_STALE_MS = 2 * 60_000;

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

/** ランタイムの置き場所の排他。ほかのプロセスが持っていれば fn を呼ばずに null を返す */
export function withRuntimeLock<T>(fs: RuntimeFs, dir: string, fn: () => T): T | null {
    const lock = `${dir}.lock`;
    let fd: number;
    try {
        fd = fs.openSync(lock, "wx");
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        try {
            if (Date.now() - fs.statSync(lock).mtimeMs < LOCK_STALE_MS) return null;
            fs.unlinkSync(lock);
            fd = fs.openSync(lock, "wx");
        } catch {
            return null;
        }
    }
    try {
        return fn();
    } finally {
        fs.closeSync(fd);
        try {
            fs.unlinkSync(lock);
        } catch { }
    }
}

/**
 * 前回までに用意した `<dir>.next` が必要な版なら、今のランタイムと入れ替える。エンジンを起こす前に呼ぶ。
 * 入れ替えたら true。版が違う `.next`（さらに新しい版が出た後の残り）は捨てる。
 * ほかのプロセスが入れ替え中なら何もせず false（今ある版で起こす）
 */
export function applyStagedRuntime(fs: RuntimeFs, dir: string, required: RequiredRuntime): boolean {
    return withRuntimeLock(fs, dir, () => applyUnlocked(fs, dir, required)) ?? false;
}

function applyUnlocked(fs: RuntimeFs, dir: string, required: RequiredRuntime): boolean {
    const next = `${dir}.next`;
    const old = `${dir}.old`;
    // 前回の入れ替えが途中で止まり、ランタイムが無いまま旧版（.old）だけ残っていたら、先に戻す。
    // ここで .old を消すと、唯一の旧版を失う
    if (!fs.existsSync(dir) && fs.existsSync(old)) fs.renameSync(old, dir);

    if (!fs.existsSync(next)) return false;
    if (manifestVersion(fs, next) !== required.version || !fs.existsSync(path.join(next, ENGINE))) {
        fs.rmSync(next, { recursive: true, force: true });
        return false;
    }
    // 今のランタイムがあるので、残っている .old は前回の入れ替えのごみ
    fs.rmSync(old, { recursive: true, force: true });
    if (fs.existsSync(dir)) fs.renameSync(dir, old);
    try {
        fs.renameSync(next, dir);
    } catch (e) {
        // 戻せるなら戻す。戻せなくても .old は残し、次の呼び出しの最初に戻す
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

/** 取り消されていたら投げる */
function throwIfAborted(signal: AbortSignal | undefined) {
    if (signal?.aborted) throw new Error("ランタイムの取得を取り消しました");
}

/**
 * zip を取得して検証し、`<dir>.next` に展開する。検証に通らなければ何も残さずに throw する。
 * ほかのプロセスが `.next` を置いている最中なら、こちらの展開は捨てる（同じ版をあちらが置く）
 */
export async function stageRuntime(
    fs: RuntimeFs,
    dir: string,
    required: RequiredRuntime,
    fetchZip: (url: string, signal?: AbortSignal) => Promise<Buffer>,
    signal?: AbortSignal
): Promise<void> {
    throwIfAborted(signal);
    const buf = await fetchZip(required.url, signal);
    throwIfAborted(signal);
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

    // 取得ごとに別の一時フォルダ。同時に取得しているほかのプロセスの展開を消さない
    const tmp = `${dir}.tmp-${process.pid}-${Date.now()}`;
    try {
        for (const e of entries) {
            const to = path.join(tmp, ...e.name.split("/"));
            fs.mkdirSync(path.dirname(to), { recursive: true });
            fs.writeFileSync(to, e.data);
        }
        throwIfAborted(signal);
        withRuntimeLock(fs, dir, () => {
            fs.rmSync(`${dir}.next`, { recursive: true, force: true });
            fs.renameSync(tmp, `${dir}.next`);
        });
    } finally {
        // 名前を変えられたら残っていない。見送ったときと失敗したときはここで消える
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

/**
 * 上限と期限つきで取得する。zip は 35 MB 前後なので、取り違えや巨大な応答で main のメモリを使い切らないよう、
 * 受信の途中でも上限を超えたら断つ
 */
export async function downloadLimited(url: string, opts: {
    maxBytes: number;
    timeoutMs: number;
    signal?: AbortSignal;
    fetch?: typeof fetch;
}): Promise<Buffer> {
    const signals = [AbortSignal.timeout(opts.timeoutMs), ...(opts.signal ? [opts.signal] : [])];
    const res = await (opts.fetch ?? fetch)(url, { signal: AbortSignal.any(signals) });
    if (!res.ok) throw new Error(`${url} を取得できませんでした（${res.status} ${res.statusText}）`);
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > opts.maxBytes) throw new Error(`取得するファイルが大きすぎます（上限 ${opts.maxBytes} バイト）`);
    if (!res.body) throw new Error(`${url} の中身が空でした`);
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = res.body.getReader();
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > opts.maxBytes) {
            await reader.cancel();
            throw new Error(`取得するファイルが大きすぎます（上限 ${opts.maxBytes} バイト）`);
        }
        chunks.push(value);
    }
    return Buffer.concat(chunks);
}
