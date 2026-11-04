/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { win32 } from "path";
import { describe, expect, it } from "vitest";

import { voiceCordPaths } from "../../src/voicecord/shared/paths";

describe("voiceCordPaths", () => {
    const paths = voiceCordPaths({
        distDir: "C:\\Users\\u\\AppData\\Local\\VencordExtended\\dist",
        dataDir: "C:\\Users\\u\\AppData\\Roaming\\Vencord",
        localAppData: "C:\\Users\\u\\AppData\\Local"
    }, win32.join);

    it("エンジンと hook は patcher.js と同じ dist の下の voicecord に並べる（エンジンは自分の隣の hook.js を読む）", () => {
        expect(paths.engine).toBe("C:\\Users\\u\\AppData\\Local\\VencordExtended\\dist\\voicecord\\engine.mjs");
        expect(win32.dirname(paths.hook)).toBe(win32.dirname(paths.engine));
    });

    it("設定は Vencord のデータディレクトリの下に置く", () => {
        expect(paths.config).toBe("C:\\Users\\u\\AppData\\Roaming\\Vencord\\voicecord\\config.json");
    });

    it("移行元は voicecord-module の設定", () => {
        expect(paths.legacyConfig).toBe("C:\\Users\\u\\AppData\\Local\\VoiceCord\\config.json");
    });
});
