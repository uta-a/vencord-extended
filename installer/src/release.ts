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

export const httpFetch: Fetcher = async (url, accept) => {
    const res = await fetch(url, { headers: { "Accept": accept, "User-Agent": "VencordExtendedInstaller" } });
    if (!res.ok) throw new Error(`${url} を取得できませんでした（${res.status} ${res.statusText}）`);
    return Buffer.from(await res.arrayBuffer());
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
