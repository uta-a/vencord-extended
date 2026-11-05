/*
 * Vencord Extended
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// @ts-check

// VoiceCord のランタイムを配るための最小限の zip 書き出し（deflate、ZIP64 なし）。
// 読み込みは src/plugins/voiceCord.discordDesktop/native/zip.ts。依存を増やさないため自前で持つ。

import { deflateRawSync } from "zlib";

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

/** @param {Uint8Array} buf */
export function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

// 日時は固定する（1980-01-01 00:00）。同じ中身なら同じ zip になる
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

/**
 * @param {{ name: string, data: Buffer }[]} files name は「/」区切りの相対パス
 * @returns {Buffer}
 */
export function createZip(files) {
    /** @type {Buffer[]} */
    const locals = [];
    /** @type {Buffer[]} */
    const centrals = [];
    let offset = 0;

    for (const { name, data } of [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
        if (name.startsWith("/") || name.includes("\\") || name.split("/").includes("..")) throw new Error(`zip に入れられない名前です: ${name}`);
        const nameBuf = Buffer.from(name, "utf8");
        const comp = deflateRawSync(data, { level: 9 });
        const crc = crc32(data);
        if (comp.length > 0xffffffff || data.length > 0xffffffff || offset > 0xffffffff) throw new Error("zip が大きすぎます（ZIP64 は使いません）");

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4); // 展開に必要な版
        local.writeUInt16LE(0x0800, 6); // 名前は UTF-8
        local.writeUInt16LE(8, 8); // deflate
        local.writeUInt16LE(DOS_TIME, 10);
        local.writeUInt16LE(DOS_DATE, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(comp.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(nameBuf.length, 26);
        local.writeUInt16LE(0, 28);
        locals.push(local, nameBuf, comp);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0x0800, 8);
        central.writeUInt16LE(8, 10);
        central.writeUInt16LE(DOS_TIME, 12);
        central.writeUInt16LE(DOS_DATE, 14);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(comp.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(nameBuf.length, 28);
        central.writeUInt32LE(offset, 42);
        centrals.push(central, nameBuf);

        offset += local.length + nameBuf.length + comp.length;
    }

    const centralSize = centrals.reduce((n, b) => n + b.length, 0);
    const count = centrals.length / 2;
    if (count > 0xffff) throw new Error("zip のファイル数が多すぎます");
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(count, 8);
    end.writeUInt16LE(count, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, ...centrals, end]);
}
