/*
 * Vencord Extended
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// @ts-check

// インストーラを、Node が無い PC でも動く単一の exe（Node SEA）にする。Windows で実行する。
//
//   1. installer/src/cli.ts を 1 つの CommonJS に束ねる（SEA は CommonJS の 1 ファイルしか読めない）
//   2. node --experimental-sea-config で blob を作る
//   3. 今の node.exe を複製し、postject で blob を埋める
//
// 使い方: node scripts/build/installer.mjs [--version <版>]
// 出力: dist/VencordExtendedInstaller.exe

import { execFileSync } from "child_process";
import { build } from "esbuild";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { createRequire } from "module";
import { join } from "path";

import { VERSION } from "./common.mjs";

if (process.platform !== "win32") throw new Error("インストーラの exe は Windows でビルドしてください");

const versionArg = process.argv.indexOf("--version");
const version = versionArg > 0 ? process.argv[versionArg + 1] : VERSION;

const WORK = "dist/installer";
const BUNDLE = join(WORK, "cli.cjs");
const BLOB = join(WORK, "sea-prep.blob");
const OUT = "dist/VencordExtendedInstaller.exe";

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

await build({
    entryPoints: ["installer/src/cli.ts"],
    outfile: BUNDLE,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: `node${process.versions.node.split(".")[0]}`,
    define: { INSTALLER_VERSION: JSON.stringify(version) },
    logLevel: "info"
});

writeFileSync(join(WORK, "sea-config.json"), JSON.stringify({
    main: BUNDLE,
    output: BLOB,
    disableExperimentalSEAWarning: true
}));
execFileSync(process.execPath, ["--experimental-sea-config", join(WORK, "sea-config.json")], { stdio: "inherit" });

copyFileSync(process.execPath, OUT);
// node.exe の署名は埋め込みで壊れる。壊れた署名を残すより、署名なしにする（signtool が無ければ飛ばす）
try {
    execFileSync("signtool", ["remove", "/s", OUT], { stdio: "ignore" });
} catch { }

const postject = createRequire(import.meta.url).resolve("postject/dist/cli.js");
execFileSync(process.execPath, [
    postject, OUT, "NODE_SEA_BLOB", BLOB,
    "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"
], { stdio: "inherit" });

rmSync(WORK, { recursive: true, force: true });
console.log(`インストーラ: ${OUT}（${version}）`);
