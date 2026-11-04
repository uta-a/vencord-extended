/*
 * Vencord Extended installer
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { buildFlatAsar, classifyAsarBytes, extractRequirePaths, readAsar } from "../src/asar";
import { isRunning, parseTasklist } from "../src/running";
import { compareVersions, newestAppDir } from "../src/scan";
import { deployDist, pathsFor } from "../src/service";
import { parseShimPatcher, renderShimSource } from "../src/shim";

describe("asar", () => {
    it("組み立てた asar を読み戻せる（ヘッダ長が 4 の倍数でなくても）", () => {
        for (const name of ["a", "ab", "abc", "abcd"]) {
            const buf = buildFlatAsar({ [name]: "hello", "package.json": "{}" });
            const view = readAsar(buf, "x");
            assert.deepEqual(Object.keys(view.header.files), [name, "package.json"]);
        }
    });

    it("require の絶対パスだけを拾う", () => {
        assert.deepEqual(extractRequirePaths('require("path");require("C:\\\\a\\\\patcher.js")'), ["C:\\a\\patcher.js"]);
    });

    it("bundle.js を含めば素の Discord", () => {
        assert.equal(classifyAsarBytes(buildFlatAsar({ "bundle.js": "", "package.json": "{}" }), "x").kind, "plain");
    });
});

describe("shim", () => {
    it("生成した shim から patcher を読み戻せる（バックスラッシュと引用符を含むパス）", () => {
        const p = 'C:\\Users\\a "b"\\dist\\patcher.js';
        assert.equal(parseShimPatcher(renderShimSource(p)), p);
    });

    it("マーカーの無いソースは null", () => {
        assert.equal(parseShimPatcher('require("C:\\\\x\\\\patcher.js");'), null);
    });
});

describe("scan", () => {
    it("バージョンを数値で比べる", () => {
        assert.ok(compareVersions("1.0.1099", "1.0.999") > 0);
        assert.equal(compareVersions("1.0.5", "1.0.5"), 0);
    });

    it("最新の app-<version> を選ぶ", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vx-scan-"));
        try {
            for (const n of ["app-1.0.999", "app-1.0.1099", "packages", "Update.exe"]) fs.mkdirSync(path.join(dir, n));
            assert.equal(newestAppDir(dir)?.version, "1.0.1099");
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe("running", () => {
    it("tasklist の CSV から PID を拾い、該当なしの行は無視する", () => {
        const out = '"DiscordCanary.exe","1234","Console","1","100 K"\r\n"DiscordCanary.exe","5678","Console","1","1 K"\r\n';
        assert.deepEqual(parseTasklist(out, "discordcanary.exe"), [1234, 5678]);
        assert.deepEqual(parseTasklist("情報: 指定された条件に一致するタスクは実行されていません。", "Discord.exe"), []);
    });

    it("判定できないときは起動中と見なす", () => {
        assert.equal(isRunning(() => { throw new Error("x"); }, "Discord.exe").running, true);
    });
});

describe("deployDist", () => {
    let dir: string;
    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "vx-dist-")); });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    function makeBuild(name: string) {
        const d = path.join(dir, name);
        fs.mkdirSync(d);
        fs.writeFileSync(path.join(d, "patcher.js"), name);
        return d;
    }

    it("開発用はジャンクションを張り、張り直しても壊れない", () => {
        const paths = pathsFor(path.join(dir, "local"));
        const a = makeBuild("a");
        const b = makeBuild("b");
        deployDist(paths, { kind: "link", dir: a });
        deployDist(paths, { kind: "link", dir: a });
        assert.equal(fs.readFileSync(paths.patcher, "utf8"), "a");
        deployDist(paths, { kind: "link", dir: b });
        assert.equal(fs.readFileSync(paths.patcher, "utf8"), "b");
    });

    it("配布版の実体がある所にはリンクを張らない", () => {
        const paths = pathsFor(path.join(dir, "local"));
        deployDist(paths, { kind: "copy", dir: makeBuild("release") });
        assert.throws(() => deployDist(paths, { kind: "link", dir: makeBuild("dev") }), /手動で削除/);
        assert.equal(fs.readFileSync(paths.patcher, "utf8"), "release");
    });

    it("コピーのときはリンクを外してから置き、リンク先を書き換えない", () => {
        const paths = pathsFor(path.join(dir, "local"));
        const dev = makeBuild("dev");
        deployDist(paths, { kind: "link", dir: dev });
        deployDist(paths, { kind: "copy", dir: makeBuild("release") });
        assert.equal(fs.readFileSync(path.join(dev, "patcher.js"), "utf8"), "dev");
        assert.equal(fs.lstatSync(paths.dist).isSymbolicLink(), false);
    });

    it("patcher.js の無い成果物は拒む", () => {
        const empty = path.join(dir, "empty");
        fs.mkdirSync(empty);
        assert.throws(() => deployDist(pathsFor(path.join(dir, "local")), { kind: "copy", dir: empty }), /patcher.js がありません/);
    });
});
