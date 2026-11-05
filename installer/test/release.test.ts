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

import { DIST_FILES, downloadLatestDist, pickDistAssets, type Release } from "../src/release";
import { pathsFor, resetRuntime } from "../src/service";
import { moveIndex, renderSelect } from "../src/tui";

const release = (names: readonly string[]): Release => ({
    tag_name: "v1.0.0-ext.2",
    name: "Vencord Extended v1.0.0-ext.2 abc1234",
    assets: names.map(n => ({ name: n, browser_download_url: `https://example.invalid/${n}` }))
});

let tmp: string;
beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vext-installer-"));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("release", () => {
    it("4 ファイルを選ぶ（ほかの添付は無視する）", () => {
        const picked = pickDistAssets(release([...DIST_FILES, "voicecord-runtime-win32-x64.zip", "VencordExtendedInstaller.exe"]));
        assert.deepEqual(picked.map(a => a.name), [...DIST_FILES]);
    });

    it("1 つでも欠けていたら、そのリリースは使わない", () => {
        assert.throws(() => pickDistAssets(release(["patcher.js", "preload.js", "renderer.js"])), /renderer\.css/);
    });

    it("最新のリリースの 4 ファイルを置く", async () => {
        const requested: string[] = [];
        const r = await downloadLatestDist("uta-a/vencord-extended", tmp, async url => {
            requested.push(url);
            if (url.endsWith("/releases/latest")) return Buffer.from(JSON.stringify(release(DIST_FILES)));
            return Buffer.from(`content of ${url.split("/").pop()}`);
        });
        assert.equal(r.tag_name, "v1.0.0-ext.2");
        assert.equal(requested[0], "https://api.github.com/repos/uta-a/vencord-extended/releases/latest");
        for (const f of DIST_FILES) assert.equal(fs.readFileSync(path.join(tmp, f), "utf8"), `content of ${f}`);
    });
});

describe("resetRuntime（修復）", () => {
    it("ランタイムと、用意中・入れ替え待ちの分を消し、4 ファイルは残す", () => {
        const paths = pathsFor(tmp);
        for (const d of ["voicecord", "voicecord.next", "voicecord.tmp", "voicecord.old"]) {
            fs.mkdirSync(path.join(paths.dist, d), { recursive: true });
            fs.writeFileSync(path.join(paths.dist, d, "engine.mjs"), "x");
        }
        fs.writeFileSync(paths.patcher, "x");
        resetRuntime(paths);
        assert.deepEqual(fs.readdirSync(paths.dist), ["patcher.js"]);
    });

    it("開発用のリンクのときは、リポジトリの dist に触らない", () => {
        const repoDist = path.join(tmp, "repo-dist");
        fs.mkdirSync(path.join(repoDist, "voicecord"), { recursive: true });
        const paths = pathsFor(path.join(tmp, "local"));
        fs.mkdirSync(paths.root, { recursive: true });
        fs.symlinkSync(repoDist, paths.dist, "junction");
        resetRuntime(paths);
        assert.ok(fs.existsSync(path.join(repoDist, "voicecord")));
    });
});

describe("tui", () => {
    it("矢印キーで動き、端では反対側へ回る", () => {
        assert.equal(moveIndex(0, "up", 3), 2);
        assert.equal(moveIndex(2, "down", 3), 0);
        assert.equal(moveIndex(1, "down", 3), 2);
        assert.equal(moveIndex(1, "home", 3), 0);
        assert.equal(moveIndex(0, "end", 3), 2);
        assert.equal(moveIndex(0, "down", 0), 0);
    });

    it("選んでいる行に印を付ける", () => {
        // eslint-disable-next-line no-control-regex
        const plain = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
        const lines = renderSelect("何をしますか？", [{ label: "導入", value: 1 }, { label: "解除", value: 2, hint: "素に戻す" }], 1).map(plain);
        assert.match(lines[0], /何をしますか？/);
        assert.equal(lines[1], "  導入");
        assert.equal(lines[2], "❯ 解除 素に戻す");
    });
});

describe("取得先と修復の安全策", () => {
    it("GitHub のホスト（リダイレクト先を含む）だけを信じる", async () => {
        const { isTrustedHost } = await import("../src/release");
        for (const u of ["https://api.github.com/repos/a/b/releases/latest", "https://github.com/a/b/releases/download/v1/x", "https://objects.githubusercontent.com/x", "https://release-assets.githubusercontent.com/x"]) {
            assert.equal(isTrustedHost(u), true, u);
        }
        for (const u of ["http://github.com/x", "https://github.com.evil.example/x", "https://evil.example/github.com", "https://githubusercontent.com.evil.example/x"]) {
            assert.equal(isTrustedHost(u), false, u);
        }
    });

    it("修復は、ほかの Discord が起動していたら断り、ランタイムに触らない", async () => {
        const { installTo } = await import("../src/service");
        const paths = pathsFor(tmp);
        fs.mkdirSync(path.join(paths.dist, "voicecord"), { recursive: true });
        const install = { spec: { branch: "canary", exeName: "DiscordCanary.exe", label: "Discord Canary", dirName: "DiscordCanary" } } as never;
        const deps = {
            localAppData: tmp,
            listProcesses: (image: string) => image === "Discord.exe" ? `"Discord.exe","1234","Console","1","100 K"` : "情報: 指定された条件に一致するタスクは実行されていません。",
            killProcess: () => { throw new Error("終了させてはいけない"); },
            sleep: () => { },
            startDiscord: () => { }
        };
        const res = installTo(deps, install, { kind: "copy", dir: tmp }, true, { resetRuntime: true });
        assert.equal(res.ok, false);
        assert.match(res.message, /Discord Stable/);
        assert.ok(fs.existsSync(path.join(paths.dist, "voicecord")));
    });
});
