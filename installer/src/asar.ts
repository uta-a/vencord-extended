/*
 * Vencord Extended installer
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// VoiceCord Manager（voicecord-module/src/manager/patch）由来。
// plain Node から動かすので original-fs は要らない（Electron の fs だけが .asar のパスを横取りする）。

import fs from "fs";

import { type LegacyOwner, parseLegacyChain, parseShimPatcher } from "./shim";

export interface AsarHeader {
    files: Record<string, { size?: number; offset?: string; files?: unknown; }>;
}

export interface AsarView {
    header: AsarHeader;
    /** ファイル本体の開始位置 */
    dataOffset: number;
    buffer: Buffer;
}

/**
 * asar のヘッダを読む。asar として読めなければ throw する。
 *
 * ヘッダは Chromium の Pickle 形式:
 *   [0..4)   = 4（次のフィールドのサイズ）
 *   [4..8)   = ヘッダ pickle のペイロード長（4 バイト境界にパディング済み）
 *   [12..16) = ヘッダ JSON の文字列長（パディングを含まない）
 * 本体の開始位置は 8 + [4..8) であって、16 + 文字列長ではない。
 */
export function readAsar(buffer: Buffer, filePath: string): AsarView {
    if (buffer.length < 16) throw new Error(`too small to be an asar: ${filePath}`);
    const headerPickleSize = buffer.readUInt32LE(4);
    const headerSize = buffer.readUInt32LE(12);
    const dataOffset = 8 + headerPickleSize;
    if (headerSize <= 0 || 16 + headerSize > buffer.length || dataOffset > buffer.length) {
        throw new Error(`invalid asar header size (${headerSize}/${headerPickleSize}): ${filePath}`);
    }
    let header: AsarHeader;
    try {
        header = JSON.parse(buffer.subarray(16, 16 + headerSize).toString("utf8"));
    } catch (e) {
        throw new Error(`invalid asar header json: ${filePath} (${String(e)})`);
    }
    if (!header || typeof header !== "object" || typeof header.files !== "object") {
        throw new Error(`asar header has no files table: ${filePath}`);
    }
    return { header, dataOffset, buffer };
}

/** トップレベルのファイルを文字列として読む。無ければ null */
export function readTopLevelFile(view: AsarView, name: string): string | null {
    const entry = view.header.files[name];
    if (!entry || entry.files || entry.size === undefined) return null;
    const start = view.dataOffset + Number(entry.offset ?? 0);
    return view.buffer.subarray(start, start + entry.size).toString("utf8");
}

const align4 = (n: number) => (n + 3) & ~3;

/** トップレベルにファイルだけを持つ asar を組み立てる（shim 用） */
export function buildFlatAsar(files: Record<string, string | Buffer>): Buffer {
    const bodies: Buffer[] = [];
    const table: Record<string, { size: number; offset: string; }> = {};
    let offset = 0;
    for (const [name, content] of Object.entries(files)) {
        const body = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
        table[name] = { size: body.length, offset: String(offset) };
        bodies.push(body);
        offset += body.length;
    }
    const headerString = JSON.stringify({ files: table });
    const len = Buffer.byteLength(headerString, "utf8");
    const alignedLen = align4(len);

    const head = Buffer.alloc(16 + alignedLen);
    head.writeUInt32LE(4, 0);
    head.writeUInt32LE(8 + alignedLen, 4);
    head.writeUInt32LE(4 + alignedLen, 8);
    head.writeUInt32LE(len, 12);
    head.write(headerString, 16, "utf8");
    return Buffer.concat([head, ...bodies]);
}

export type AppAsarKind =
    | { kind: "missing"; }
    /** 素の Discord（bundle.js を含む） */
    | { kind: "plain"; size: number; }
    /** このインストーラが書いた shim */
    | { kind: "extended"; size: number; patcher: string; }
    /** 旧 VoiceCord Manager や Modicord が書いた連鎖 shim */
    | { kind: "legacyChain"; size: number; owner: LegacyOwner; chain: string[]; }
    /** 他の mod が書いた shim（Vencord 公式など）。require しているパスを持つ */
    | { kind: "foreignShim"; size: number; requires: string[]; }
    /** asar として読めない、または想定外の中身 */
    | { kind: "unknown"; size: number; reason: string; };

/** app.asar の形態を判定する。どんな入力でも throw しない */
export function classifyAppAsar(filePath: string): AppAsarKind {
    if (!fs.existsSync(filePath)) return { kind: "missing" };
    const buffer = fs.readFileSync(filePath);
    return classifyAsarBytes(buffer, filePath);
}

export function classifyAsarBytes(buffer: Buffer, filePath: string): AppAsarKind {
    const size = buffer.length;
    let view: AsarView;
    try {
        view = readAsar(buffer, filePath);
    } catch (e) {
        return { kind: "unknown", size, reason: e instanceof Error ? e.message : String(e) };
    }
    const names = Object.keys(view.header.files);
    if (names.includes("bundle.js")) return { kind: "plain", size };

    const index = readTopLevelFile(view, "index.js");
    if (index !== null && names.includes("package.json")) {
        const patcher = parseShimPatcher(index);
        if (patcher) return { kind: "extended", size, patcher };
        const legacy = parseLegacyChain(index);
        if (legacy) return { kind: "legacyChain", size, ...legacy };
        return { kind: "foreignShim", size, requires: extractRequirePaths(index) };
    }
    return {
        kind: "unknown",
        size,
        reason: `top-level entries were [${names.join(", ")}]; expected bundle.js, or index.js + package.json`
    };
}

/** 他 mod の shim から require されている絶対パスを拾う（"path" などの組み込みは除く） */
export function extractRequirePaths(source: string): string[] {
    const out: string[] = [];
    const re = /require\(\s*("[^"]*"|'[^']*')\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
        const lit = m[1];
        let value: string;
        if (lit.startsWith('"')) {
            try {
                value = JSON.parse(lit);
            } catch {
                continue;
            }
        } else {
            value = lit.slice(1, -1);
        }
        if (!value.includes("\\") && !value.includes("/")) continue;
        out.push(value);
    }
    return out;
}
