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

import { applyInstall, type PatchTarget, planInstall, sha256, targetFor, uninstall } from "../src/apply";
import { buildFlatAsar, classifyAppAsar } from "../src/asar";
import { LEGACY_CHAIN_MARKER, SHIM_PACKAGE_JSON } from "../src/shim";

const win = (s: string) => s.split("/").join("\\");
const EXTENDED = win("C:/Users/u/AppData/Local/VencordExtended/dist/patcher.js");
const VENCORD = win("C:/Users/u/AppData/Roaming/Vencord/dist/patcher.js");
const VOICECORD = win("C:/Users/u/AppData/Local/VoiceCord/dist/patcher.js");
const OTHER = win("C:/Users/u/AppData/Roaming/OtherMod/index.js");

function plainAsar(marker = "original") {
    return buildFlatAsar({
        "bundle.js": `console.log(${JSON.stringify(marker)});` + "x".repeat(200),
        "package.json": '{"name":"discord","main":"bundle.js"}'
    });
}

function foreignShim(...requires: string[]) {
    return buildFlatAsar({
        "index.js": requires.map(r => `require(${JSON.stringify(r)})`).join(";"),
        "package.json": SHIM_PACKAGE_JSON
    });
}

function legacyChainShim(chain: string[]) {
    return buildFlatAsar({
        "index.js": `// ${LEGACY_CHAIN_MARKER}\nvar CHAIN = ${JSON.stringify(chain)};\n`,
        "package.json": SHIM_PACKAGE_JSON
    });
}

let dir: string;
let t: PatchTarget;

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "vx-apply-"));
    t = targetFor(dir);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function install() {
    const plan = planInstall(t, EXTENDED);
    if (!plan.ok) throw new Error(plan.reason);
    return { plan, res: applyInstall(t, plan) };
}

describe("planInstall — 弾くべきケース", () => {
    it("app.asar が無ければ弾く", () => {
        const plan = planInstall(t, EXTENDED);
        assert.equal(plan.ok, false);
    });

    it("asar として読めないファイルは弾く", () => {
        fs.writeFileSync(t.appAsar, Buffer.alloc(64, 0xff));
        const plan = planInstall(t, EXTENDED);
        assert.ok(!plan.ok && plan.reason.includes("想定外"));
    });

    it("shim なのに _app.asar が無ければ弾く", () => {
        fs.writeFileSync(t.appAsar, foreignShim(VENCORD));
        const plan = planInstall(t, EXTENDED);
        assert.ok(!plan.ok && plan.reason.includes("所在が不明"));
    });

    it("正体の分からない mod の shim は置き換えない", () => {
        fs.writeFileSync(t.backupAsar, plainAsar());
        fs.writeFileSync(t.appAsar, foreignShim(VENCORD, OTHER));
        const plan = planInstall(t, EXTENDED);
        assert.ok(!plan.ok && plan.reason.includes("正体の分からない"));
    });
});

describe("素の Discord への適用", () => {
    beforeEach(() => fs.writeFileSync(t.appAsar, plainAsar()));

    it("_app.asar を作り、app.asar を patcher 1 つの shim にする", () => {
        const { plan, res } = install();
        assert.equal(plan.needsBackup, true);
        assert.deepEqual(plan.replaces, []);
        assert.equal(res.backedUp, true);
        const after = classifyAppAsar(t.appAsar);
        assert.equal(after.kind, "extended");
        if (after.kind === "extended") assert.equal(after.patcher, EXTENDED);
        assert.equal(classifyAppAsar(t.backupAsar).kind, "plain");
        assert.equal(fs.existsSync(t.tmpFile), false);
    });

    it("shim は Vencord と同じく patcher を require するだけ", () => {
        install();
        const view = fs.readFileSync(t.appAsar).toString("utf8");
        assert.ok(view.includes(`require(${JSON.stringify(EXTENDED)})`));
    });

    it("再適用は何も置き換えず冪等", () => {
        install();
        const { plan } = install();
        assert.deepEqual(plan.replaces, []);
        assert.equal(classifyAppAsar(t.appAsar).kind, "extended");
    });
});

describe("既存 mod からの置き換え", () => {
    let original: Buffer;
    beforeEach(() => {
        original = plainAsar();
        fs.writeFileSync(t.backupAsar, original);
    });

    it("公式 Vencord の shim を置き換え、_app.asar は上書きしない", () => {
        fs.writeFileSync(t.appAsar, foreignShim(VENCORD));
        const { plan } = install();
        assert.deepEqual(plan.replaces, [VENCORD]);
        assert.equal(plan.needsBackup, false);
        assert.equal(sha256(fs.readFileSync(t.backupAsar)), sha256(original));
        const after = classifyAppAsar(t.appAsar);
        assert.ok(after.kind === "extended" && after.patcher === EXTENDED);
    });

    it("旧 VoiceCord の連鎖 shim を丸ごと置き換え、二重に載せない", () => {
        fs.writeFileSync(t.appAsar, legacyChainShim([VOICECORD, VENCORD]));
        const { plan } = install();
        assert.deepEqual(plan.replaces, [VOICECORD, VENCORD]);
        const text = fs.readFileSync(t.appAsar).toString("utf8");
        assert.ok(!text.includes("VoiceCord\\\\dist") && !text.includes("Roaming\\\\Vencord"));
    });

    it("別の場所を指す vencord-extended の shim は置き換え対象として示す", () => {
        fs.writeFileSync(t.appAsar, original);
        install();
        const other = win("D:/dev/vencord-extended/dist/patcher.js");
        const plan = planInstall(t, other);
        assert.ok(plan.ok && plan.replaces[0] === EXTENDED);
    });

    it("区切り文字や大文字小文字が違うだけなら同じ patcher と見なす", () => {
        fs.writeFileSync(t.appAsar, original);
        install();
        const plan = planInstall(t, EXTENDED.toUpperCase().replaceAll("\\", "/"));
        assert.ok(plan.ok && plan.replaces.length === 0);
    });
});

describe("applyInstall — 計画後の変化", () => {
    it("計画時から app.asar が変わっていたら拒み、触らない", () => {
        fs.writeFileSync(t.appAsar, plainAsar());
        const plan = planInstall(t, EXTENDED);
        if (!plan.ok) throw new Error(plan.reason);
        fs.writeFileSync(t.backupAsar, plainAsar());
        const changed = foreignShim(VENCORD);
        fs.writeFileSync(t.appAsar, changed);
        assert.throws(() => applyInstall(t, plan), /app.asar が計画時から変わっています/);
        assert.deepEqual(fs.readFileSync(t.appAsar), changed);
    });

    it("既存 _app.asar が計画後に変わったら拒む", () => {
        fs.writeFileSync(t.backupAsar, plainAsar());
        fs.writeFileSync(t.appAsar, foreignShim(VENCORD));
        const plan = planInstall(t, EXTENDED);
        if (!plan.ok) throw new Error(plan.reason);
        fs.writeFileSync(t.backupAsar, plainAsar("changed"));
        assert.throws(() => applyInstall(t, plan), /_app.asar が計画時から変わっています/);
    });
});

describe("uninstall", () => {
    let original: Buffer;
    beforeEach(() => {
        original = plainAsar();
        fs.writeFileSync(t.appAsar, original);
    });

    it("素の Discord にバイト単位で戻し、_app.asar を消す", () => {
        install();
        assert.equal(uninstall(t).restored, true);
        assert.equal(sha256(fs.readFileSync(t.appAsar)), sha256(original));
        assert.equal(fs.existsSync(t.backupAsar), false);
    });

    it("既に素なら何もしない", () => {
        assert.equal(uninstall(t).restored, false);
    });

    it("他の mod の shim は外さない", () => {
        fs.copyFileSync(t.appAsar, t.backupAsar);
        fs.writeFileSync(t.appAsar, foreignShim(VENCORD));
        assert.throws(() => uninstall(t), /vencord-extended の shim ではありません/);
    });

    it("_app.asar が壊れていたら拒む", () => {
        install();
        fs.writeFileSync(t.backupAsar, Buffer.alloc(32, 0));
        assert.throws(() => uninstall(t), /Discord 本体ではありません/);
    });

    it("適用と解除を 3 往復してもバイト単位で元に戻る", () => {
        for (let i = 0; i < 3; i++) {
            install();
            uninstall(t);
            assert.equal(sha256(fs.readFileSync(t.appAsar)), sha256(original));
        }
    });
});
