/*
 * Vencord Extended
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// dist/voicecord のランタイムが単体で動くかを確かめる（Windows 用）。
// リポジトリの node_modules に解決が逃げないよう、一時フォルダへコピーしてから frida を読み込む。
// 読み込みは子プロセスで行う（frida のネイティブバイナリを掴んだままだと一時フォルダを消せないため）。
// 使い方: node scripts/checkVoiceCordRuntime.mjs

import { spawnSync } from "child_process";
import { cpSync, existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const src = "dist/voicecord";
for (const f of ["engine.mjs", "hook.js", "node_modules/frida/package.json"]) {
    if (!existsSync(join(src, f))) {
        console.error(`ランタイムに ${f} がありません`);
        process.exit(1);
    }
}

const probe = `
const { createRequire } = require("module");
const path = require("path");
const dir = process.cwd();
const req = createRequire(path.join(dir, "engine.mjs"));
const resolved = req.resolve("frida");
const rel = path.relative(dir, resolved);
if (rel.startsWith("..")) { console.error("frida がランタイムの外で解決されました: " + resolved); process.exit(1); }
req("frida").getLocalDevice().then(d => console.log("ランタイムの frida を読み込めました（" + rel + "、デバイス: " + d.name + "）"));
`;

const dir = mkdtempSync(join(tmpdir(), "vx-runtime-"));
let status = 1;
try {
    cpSync(src, dir, { recursive: true });
    status = spawnSync(process.execPath, ["-e", probe], { cwd: dir, stdio: "inherit" }).status ?? 1;
} finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
process.exit(status);
