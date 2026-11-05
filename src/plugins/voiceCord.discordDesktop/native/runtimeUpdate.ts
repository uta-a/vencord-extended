/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createHash, randomUUID } from "crypto";
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
    linkSync(existing: string, newPath: string): void;
    readdirSync(p: string): string[];
}

export const MANIFEST = "manifest.json";
const ENGINE = "engine.mjs";

// 持ち主が生きていても、これより古いロックは残りと見なす（pid の使い回しで回収できなくなるのを防ぐ）。
// ロックの中は rename と小さな削除だけなので十分長い
const LOCK_STALE_MS = 10 * 60_000;

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

/** そのプロセスが生きているか（権限が無いだけなら生きている） */
export function pidAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        return (e as NodeJS.ErrnoException).code === "EPERM";
    }
}

interface LockOwner {
    pid: number;
    token: string;
}

function readOwner(fs: RuntimeFs, lock: string): LockOwner | null {
    try {
        const o = JSON.parse(fs.readFileSync(lock, "utf8")) as Partial<LockOwner>;
        return typeof o.pid === "number" && typeof o.token === "string" ? { pid: o.pid, token: o.token } : null;
    } catch {
        return null;
    }
}

/** ロックを作る。ほかが持っていれば false */
function tryCreateLock(fs: RuntimeFs, lock: string, token: string): boolean {
    let fd: number;
    try {
        fd = fs.openSync(lock, "wx");
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
        throw e;
    }
    try {
        fs.closeSync(fd);
    } catch { }
    try {
        fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, token } satisfies LockOwner));
    } catch (e) {
        try {
            fs.unlinkSync(lock);
        } catch { }
        throw e;
    }
    return true;
}

/**
 * 持ち主が終わったロック（または古すぎるロック）を片付ける。
 * 複数のプロセスが同時に片付けても、別のプロセスが作り直したばかりのロックを消さないよう、
 * 自分だけの名前へ rename してから中身を確かめ、見たものと違えば元に戻す
 */
function reapStaleLock(fs: RuntimeFs, lock: string, token: string) {
    const seen = fs.readFileSync(lock, "utf8");
    const seenMtime = fs.statSync(lock).mtimeMs;
    const owner = readOwner(fs, lock);
    // 中身がまだ無いのは、作った直後で書き込み前のロック。時間だけで判断する
    const stale = (owner !== null && !pidAlive(owner.pid)) || Date.now() - seenMtime >= LOCK_STALE_MS;
    if (!stale) return;
    const reap = `${lock}.reap-${token}`;
    fs.renameSync(lock, reap); // ほかのプロセスが先に片付けていれば失敗する
    if (fs.readFileSync(reap, "utf8") === seen && fs.statSync(reap).mtimeMs === seenMtime) {
        fs.unlinkSync(reap);
        return;
    }
    // 見てから rename するまでの間に、ほかのプロセスが作り直したロックだった。戻す（新しいロックがあれば戻さない）
    try {
        fs.linkSync(reap, lock);
    } finally {
        fs.unlinkSync(reap);
    }
}

/** ランタイムの置き場所の排他。ほかのプロセスが持っていれば fn を呼ばずに null を返す */
export function withRuntimeLock<T>(fs: RuntimeFs, dir: string, fn: () => T): T | null {
    const lock = `${dir}.lock`;
    const token = `${process.pid}-${randomUUID()}`;
    if (!tryCreateLock(fs, lock, token)) {
        try {
            reapStaleLock(fs, lock, token);
            if (!tryCreateLock(fs, lock, token)) return null;
        } catch {
            return null;
        }
    }
    try {
        return fn();
    } finally {
        // 自分のロックのときだけ消す（古いと見なされて片付けられ、ほかのプロセスが持ち直している場合がある）
        try {
            if (readOwner(fs, lock)?.token === token) fs.unlinkSync(lock);
        } catch { }
    }
}

/** 展開の途中で落ちたプロセスの一時フォルダ（`<dir>.tmp-<pid>-<時刻>`）を消す。持ち主が生きていれば残す */
export function removeOrphanTmp(fs: RuntimeFs, dir: string) {
    const parent = path.dirname(dir);
    const prefix = `${path.basename(dir)}.tmp-`;
    let names: string[];
    try {
        names = fs.readdirSync(parent);
    } catch {
        return;
    }
    for (const name of names) {
        if (!name.startsWith(prefix)) continue;
        const pid = Number(name.slice(prefix.length).split("-")[0]);
        if (Number.isInteger(pid) && pid > 0 && pidAlive(pid)) continue;
        try {
            fs.rmSync(path.join(parent, name), { recursive: true, force: true });
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
    removeOrphanTmp(fs, dir);
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

const LOCK_RETRY_MS = 250;

export function sha256Hex(buf: Buffer): string {
    return createHash("sha256").update(buf).digest("hex");
}

/** 取り消されていたら投げる */
function throwIfAborted(signal: AbortSignal | undefined) {
    if (signal?.aborted) throw new Error("ランタイムの取得を取り消しました");
}

/**
 * zip を取得して検証し、`<dir>.next` に展開する。検証に通らなければ何も残さずに throw する。
 * ほかのプロセスがロックを持っていれば空くまで待ち、lockWaitMs を過ぎたら throw する
 */
export async function stageRuntime(
    fs: RuntimeFs,
    dir: string,
    required: RequiredRuntime,
    fetchZip: (url: string, signal?: AbortSignal) => Promise<Buffer>,
    signal?: AbortSignal,
    lockWaitMs = 10_000
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
        // ロックの中は rename だけなので、ほかのプロセスが持っていても少し待てば空く
        for (let waited = 0; ; waited += LOCK_RETRY_MS) {
            throwIfAborted(signal);
            const placed = withRuntimeLock(fs, dir, () => {
                fs.rmSync(`${dir}.next`, { recursive: true, force: true });
                fs.renameSync(tmp, `${dir}.next`);
                return true;
            });
            if (placed) break;
            if (waited >= lockWaitMs) throw new Error("ほかの Discord がランタイムを更新しているため、新しいランタイムを置けませんでした");
            await new Promise(r => setTimeout(r, LOCK_RETRY_MS));
        }
    } finally {
        // 名前を変えられたら残っていない。失敗したときはここで消える
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
    const res = await (opts.fetch ?? fetch)(url, { signal: anySignal(signals) });
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

/** AbortSignal.any（Node 20.3 / 18.17 から）が無い Electron でも動くように */
export function anySignal(signals: AbortSignal[], native: boolean = typeof AbortSignal.any === "function"): AbortSignal {
    if (native) return AbortSignal.any(signals);
    const ac = new AbortController();
    for (const s of signals) {
        if (s.aborted) {
            ac.abort(s.reason);
            break;
        }
        s.addEventListener("abort", () => ac.abort(s.reason), { once: true });
    }
    return ac.signal;
}
