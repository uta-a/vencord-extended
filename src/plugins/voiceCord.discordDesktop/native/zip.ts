/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { inflateRawSync } from "zlib";

/**
 * VoiceCord のランタイムの zip を読む最小限の実装（stored と deflate、ZIP64 なし）。
 * 書き出しは scripts/build/zip.mjs。依存を増やさないため自前で持つ。
 *
 * 中身は取得後に sha256 で検証してから読むが、壊れた・細工された zip でも外へ書き出さないよう、
 * 名前（絶対パス・`..`・ドライブ名・NUL）と展開後の大きさをここでも断つ。
 */

const MAX_TOTAL = 512 * 1024 * 1024; // frida のランタイムは展開後 100MB 前後。十分な余裕を持たせた上限

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(buf: Uint8Array): number {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
    /** 「/」区切りの相対パス。ディレクトリの項目は含めない */
    name: string;
    data: Buffer;
}

/** zip の中の名前が、展開先の外を指さない相対パスか */
export function isSafeEntryName(name: string): boolean {
    if (name === "" || name.includes("\0") || name.includes("\\")) return false;
    if (name.startsWith("/") || /^[A-Za-z]:/.test(name)) return false;
    return name.split("/").every(part => part !== ".." && part !== ".");
}

export function readZip(buf: Buffer): ZipEntry[] {
    // 末尾の EOCD を探す（コメントは最大 65535 バイト）
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0) throw new Error("zip の形式ではありません");
    const count = buf.readUInt16LE(eocd + 10);
    const centralSize = buf.readUInt32LE(eocd + 12);
    let p = buf.readUInt32LE(eocd + 16);
    if (p + centralSize > eocd) throw new Error("zip の目次が壊れています");

    const out: ZipEntry[] = [];
    let total = 0;
    for (let n = 0; n < count; n++) {
        if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("zip の目次が壊れています");
        const flags = buf.readUInt16LE(p + 8);
        const method = buf.readUInt16LE(p + 10);
        const crc = buf.readUInt32LE(p + 16);
        const compSize = buf.readUInt32LE(p + 20);
        const size = buf.readUInt32LE(p + 24);
        const nameLen = buf.readUInt16LE(p + 28);
        const extraLen = buf.readUInt16LE(p + 30);
        const commentLen = buf.readUInt16LE(p + 32);
        const localOffset = buf.readUInt32LE(p + 42);
        const name = buf.subarray(p + 46, p + 46 + nameLen).toString(flags & 0x0800 ? "utf8" : "latin1");
        p += 46 + nameLen + extraLen + commentLen;

        if (flags & 0x0001) throw new Error(`暗号化された項目は読めません: ${name}`);
        if (name.endsWith("/")) continue; // ディレクトリ
        if (!isSafeEntryName(name)) throw new Error(`zip に展開先の外を指す名前があります: ${name}`);
        total += size;
        if (total > MAX_TOTAL) throw new Error("zip の展開後の大きさが上限を超えています");

        if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`zip の項目が壊れています: ${name}`);
        const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
        const comp = buf.subarray(dataStart, dataStart + compSize);
        if (comp.length !== compSize) throw new Error(`zip の項目が途中で切れています: ${name}`);

        let data: Buffer;
        if (method === 0) data = Buffer.from(comp);
        else if (method === 8) data = inflateRawSync(comp, { maxOutputLength: size + 1 });
        else throw new Error(`対応していない圧縮方式です（${method}）: ${name}`);
        if (data.length !== size || crc32(data) !== crc) throw new Error(`zip の項目の中身が一致しません: ${name}`);
        out.push({ name, data });
    }
    return out;
}
