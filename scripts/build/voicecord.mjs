/*
 * Vencord Extended
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// @ts-check

// VoiceCord のエンジン（utilityProcess の子）と frida ランタイムを dist/voicecord/ に置く。
// voicecord-module の build.mjs 由来。
//
//   dist/voicecord/engine.mjs          エンジン。frida は import 文のまま残す
//   dist/voicecord/hook.js             frida エージェント（無改造のコピー）
//   dist/voicecord/node_modules/...    frida の package.json と build/、実行時依存
//
// --no-voicecord で全部飛ばす。frida ランタイムは Windows で frida が入っているときだけ配る。

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync } from "fs";
import { createRequire } from "module";
import { dirname, join } from "path";

export const IS_VOICECORD_DISABLED = process.argv.includes("--no-voicecord");

const OUT_DIR = "dist/voicecord";

/** インストール時にしか使わない依存。実行時には要らないので配らない */
const INSTALL_ONLY_DEPS = new Set(["prebuild-install"]);

/** @returns {import("esbuild").BuildOptions[]} */
export function voiceCordBuildConfigs() {
    if (IS_VOICECORD_DISABLED) return [];
    return [{
        entryPoints: ["src/voicecord/engine/engine.ts"],
        outfile: join(OUT_DIR, "engine.mjs"),
        bundle: true,
        platform: "node",
        target: "node20",
        // utilityProcess.fork の子として Node のモジュールローダに読まれる。ESM のまま出す
        format: "esm",
        // frida を束ねると bindings が package.json と build/ を辿れなくなる
        packages: "external",
        sourcemap: true,
        logLevel: "info"
    }];
}

/** 同じ内容ならコピーしない。frida のバイナリは約 75MB あり、毎回コピーすると遅い */
function copyIfChanged(from, to) {
    try {
        const a = statSync(from);
        const b = statSync(to);
        if (a.size === b.size && a.mtimeMs <= b.mtimeMs) return 0;
    } catch {
        // 宛先が無い。コピーする
    }
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    return 1;
}

function copyTree(from, to) {
    let n = 0;
    for (const e of readdirSync(from, { withFileTypes: true })) {
        const f = join(from, e.name);
        const t = join(to, e.name);
        if (e.isDirectory()) {
            if (e.name === "node_modules") continue;
            n += copyTree(f, t);
        } else n += copyIfChanged(f, t);
    }
    return n;
}

/**
 * frida の実行時依存を辿る。pnpm は依存を .pnpm の下にリンクで並べるので、
 * パスを決め打ちせず、各パッケージの位置から require の解決で次を探す。
 * @returns {Map<string, string>} パッケージ名 → 実体のディレクトリ
 */
export function collectRuntimeDeps(fridaDir) {
    /** @type {Map<string, string>} */
    const found = new Map();
    const visit = pkgDir => {
        const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
        const req = createRequire(join(pkgDir, "package.json"));
        for (const dep of Object.keys(pkg.dependencies ?? {})) {
            if (INSTALL_ONLY_DEPS.has(dep) || found.has(dep)) continue;
            const depDir = realpathSync(dirname(req.resolve(`${dep}/package.json`)));
            found.set(dep, depDir);
            visit(depDir);
        }
    };
    visit(fridaDir);
    return found;
}

/** hook.js と frida ランタイムを置く */
export function copyVoiceCordRuntime() {
    if (IS_VOICECORD_DISABLED) return;
    mkdirSync(OUT_DIR, { recursive: true });

    // frida エージェントは無改造でそのまま置く（開発中にホット差し替えできる）
    copyIfChanged("src/voicecord/agent/hook.js", join(OUT_DIR, "hook.js"));

    if (process.platform !== "win32") {
        console.log("VoiceCord: Windows 以外なので frida ランタイムは配りません");
        return;
    }
    if (!existsSync("node_modules/frida")) {
        console.log("VoiceCord: frida が入っていないので、ランタイムは配りません");
        return;
    }

    const fridaDir = realpathSync("node_modules/frida");
    const dst = join(OUT_DIR, "node_modules");
    let n = copyIfChanged(join(fridaDir, "package.json"), join(dst, "frida/package.json"));
    n += copyTree(join(fridaDir, "build"), join(dst, "frida/build"));
    for (const [name, dir] of collectRuntimeDeps(fridaDir)) {
        n += copyTree(dir, join(dst, name));
    }
    console.log(`VoiceCord: frida ランタイム ${n} ファイルを更新`);
}
