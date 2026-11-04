/*
 * Vencord Extended
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// upstream 由来のファイルへの変更が FORK_CHANGES.md の一覧と一致するかを検査する。
// 使い方: node scripts/checkForkChanges.mjs [upstream の ref（既定: upstream/main）]

import { execFileSync } from "child_process";
import { readFileSync } from "fs";

const upstreamRef = process.argv[2] ?? "upstream/main";

// 変更（M）・削除（D）・型変更（T）だけを見る。追加（A）は upstream と衝突しないので対象外。
// rename は削除＋追加として扱い、元のファイルの削除を拾う。
const diff = execFileSync(
    "git",
    ["diff", "--name-only", "--no-renames", "--diff-filter=MDT", `${upstreamRef}...HEAD`],
    { encoding: "utf8" }
);
const changed = new Set(diff.split("\n").map(s => s.trim()).filter(Boolean));

const listed = new Set(
    [...readFileSync("FORK_CHANGES.md", "utf8").matchAll(/^- `([^`]+)`/gm)].map(m => m[1])
);

const unlisted = [...changed].filter(p => !listed.has(p));
const stale = [...listed].filter(p => !changed.has(p));

if (unlisted.length) {
    console.error("FORK_CHANGES.md に載っていない upstream ファイルの変更があります:");
    for (const p of unlisted) console.error(`  - ${p}`);
}
if (stale.length) {
    console.error("FORK_CHANGES.md に、もう変更していない項目が残っています:");
    for (const p of stale) console.error(`  - ${p}`);
}
if (unlisted.length || stale.length) process.exit(1);

console.log(`FORK_CHANGES.md と一致しました（${changed.size} ファイル）`);
