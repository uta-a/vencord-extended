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

export const httpFetch: Fetcher = async (url, accept) => {
    if (!isTrustedHost(url)) throw new Error(`GitHub 以外からは取得しません: ${url}`);
    const res = await fetch(url, { headers: { "Accept": accept, "User-Agent": "VencordExtendedInstaller" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    // リダイレクト先も確かめる
    if (!isTrustedHost(res.url)) throw new Error(`GitHub 以外へ転送されたので取得をやめました: ${res.url}`);
    if (!res.ok) throw new Error(`${url} を取得できませんでした（${res.status} ${res.statusText}）`);
    if (Number(res.headers.get("content-length")) > MAX_BYTES) throw new Error(`${url} が大きすぎます`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error(`${url} が大きすぎます`);
    return buf;
};

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
