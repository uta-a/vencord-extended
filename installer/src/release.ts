/*
 * Vencord Extended installer
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// GitHub のリリースから、Discord に読ませる 4 ファイルを取ってくる。
// VoiceCord のランタイム（zip）はここでは取らない。patcher.js が初回の起動時に、埋め込んだ sha256 で検証して取る。

import fs from "fs";
import { join } from "path";

/** Vencord の更新（src/main/updater/common.ts の VENCORD_FILES）と同じ 4 ファイル */
export const DIST_FILES = ["patcher.js", "preload.js", "renderer.js", "renderer.css"] as const;

export const DEFAULT_REPO = "uta-a/vencord-extended";

export interface ReleaseAsset {
    name: string;
    browser_download_url: string;
}

export interface Release {
    tag_name: string;
    name: string | null;
    assets: ReleaseAsset[];
}

/** リリースの添付から 4 ファイルを選ぶ。1 つでも欠けていたら、そのリリースは使わない */
export function pickDistAssets(release: Release): ReleaseAsset[] {
    const picked = DIST_FILES.map(name => release.assets.find(a => a.name === name));
    const missing = DIST_FILES.filter((_, i) => !picked[i]);
    if (missing.length > 0) throw new Error(`リリース ${release.tag_name} に ${missing.join(", ")} がありません`);
    return picked as ReleaseAsset[];
}

export type Fetcher = (url: string, accept: string) => Promise<Buffer>;

/**
 * 取得先として信じるホスト。GitHub の API・リリースと、添付のリダイレクト先（*.githubusercontent.com）だけ。
 * 4 ファイルは署名を検証していない（配布元が侵害されたら防げない）。せめて取得先は GitHub に限る
 */
export function isTrustedHost(url: string): boolean {
    let u: URL;
    try {
        u = new URL(url);
    } catch {
        return false;
    }
    if (u.protocol !== "https:") return false;
    return u.hostname === "github.com" || u.hostname === "api.github.com" || u.hostname.endsWith(".githubusercontent.com");
}

const MAX_BYTES = 64 * 1024 * 1024; // renderer.js でも数 MB。取り違えた巨大な応答を読み切らない
const TIMEOUT_MS = 2 * 60_000;

const MAX_REDIRECTS = 5;

/**
 * GitHub だけから取る。リダイレクトは自分で辿り、転送先も取りに行く前に確かめる（自動で辿ると、確かめる前に要求が出る）。
 * 受信の途中でも上限を超えたら断つ（content-length が無い応答を全部読んでから測ると、メモリを使い切りうる）
 */
export async function httpFetch(url: string, accept: string, fetchImpl: typeof fetch = fetch, maxBytes = MAX_BYTES): Promise<Buffer> {
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    let current = url;
    for (let hops = 0; ; hops++) {
        if (!isTrustedHost(current)) {
            throw new Error(hops === 0 ? `GitHub 以外からは取得しません: ${current}` : `GitHub 以外へ転送されたので取得をやめました: ${current}`);
        }
        const res = await fetchImpl(current, { headers: { "Accept": accept, "User-Agent": "VencordExtendedInstaller" }, signal, redirect: "manual" });
        if (res.status >= 300 && res.status < 400) {
            const location = res.headers.get("location");
            await res.body?.cancel();
            if (!location) throw new Error(`${current} の転送先がありません（${res.status}）`);
            if (hops >= MAX_REDIRECTS) throw new Error(`${url} の転送が多すぎます`);
            current = new URL(location, current).toString();
            continue;
        }
        if (!res.ok) throw new Error(`${current} を取得できませんでした（${res.status} ${res.statusText}）`);
        return readLimited(res, maxBytes, url);
    }
}

async function readLimited(res: Response, maxBytes: number, url: string): Promise<Buffer> {
    if (Number(res.headers.get("content-length")) > maxBytes) throw new Error(`${url} が大きすぎます`);
    if (!res.body) return Buffer.alloc(0);
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel();
            throw new Error(`${url} が大きすぎます`);
        }
        chunks.push(value);
    }
    return Buffer.concat(chunks);
}

export async function fetchLatestRelease(repo: string, get: Fetcher = httpFetch): Promise<Release> {
    const buf = await get(`https://api.github.com/repos/${repo}/releases/latest`, "application/vnd.github+json");
    return JSON.parse(buf.toString("utf8")) as Release;
}

/** 最新のリリースの 4 ファイルを dir に置く。置いたリリースを返す */
export async function downloadLatestDist(repo: string, dir: string, get: Fetcher = httpFetch): Promise<Release> {
    const release = await fetchLatestRelease(repo, get);
    const assets = pickDistAssets(release);
    const bufs = await Promise.all(assets.map(a => get(a.browser_download_url, "application/octet-stream")));
    fs.mkdirSync(dir, { recursive: true });
    assets.forEach((a, i) => fs.writeFileSync(join(dir, a.name), bufs[i]));
    return release;
}
