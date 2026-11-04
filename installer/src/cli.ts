/*
 * Vencord Extended installer
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * インストーラの CLI。pnpm inject / uninject から呼ばれる。
 *
 *   --list                         Discord の検出結果と導入状態を表示する
 *   --install --dev                リポジトリの dist へリンクを張って適用する（開発用）
 *   --install --from <dir>         <dir> の成果物をコピーして適用する（配布用）
 *   --uninstall                    素の Discord に戻す
 *   --branch <stable|ptb|canary|development>  対象（省略時は 1 つだけならそれ、複数なら尋ねる）
 *   --force-close                  起動中の Discord を終了してから行い、終わったら再起動する
 *   --yes                          置き換えの確認を省く
 */

import { execFileSync, spawn } from "child_process";
import { join } from "path";
import { createInterface } from "readline/promises";
import { parseArgs } from "util";

import { taskkillCommand, tasklistCommand } from "./running";
import { type DiscordInstall, describeInstall, scanInstalls } from "./scan";
import { type DistSource, installTo, previewInstall, type ServiceDeps, uninstallFrom } from "./service";

function makeDeps(): ServiceDeps {
    const localAppData = process.env.LOCALAPPDATA;
    if (!localAppData) throw new Error("LOCALAPPDATA が設定されていません");
    return {
        localAppData,
        // シェルを介さない。引数は固定のイメージ名だけ
        listProcesses: imageName => {
            const [cmd, ...args] = tasklistCommand(imageName);
            return execFileSync(cmd, args, { encoding: "utf8", windowsHide: true });
        },
        killProcess: imageName => {
            const [cmd, ...args] = taskkillCommand(imageName);
            execFileSync(cmd, args, { stdio: "ignore", windowsHide: true });
        },
        sleep: ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
        startDiscord: (rootDir, exeName) => {
            const child = spawn(join(rootDir, "Update.exe"), ["--processStart", exeName], { detached: true, stdio: "ignore", shell: false });
            child.on("error", () => { });
            child.unref();
        }
    };
}

async function ask(question: string): Promise<string> {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
        return (await rl.question(question)).trim();
    } finally {
        rl.close();
    }
}

async function pickInstall(installs: DiscordInstall[], branch: string | undefined): Promise<DiscordInstall> {
    if (branch) {
        const found = installs.find(i => i.spec.branch === branch);
        if (!found) throw new Error(`${branch} の Discord が見つかりません`);
        return found;
    }
    if (installs.length === 0) throw new Error("Discord が見つかりません");
    if (installs.length === 1) return installs[0];
    if (!process.stdin.isTTY) throw new Error("Discord が複数あります。--branch で指定してください");

    installs.forEach((i, n) => console.log(`  ${n + 1}. ${i.spec.label} ${i.version} — ${describeInstall(i)}`));
    const answer = Number(await ask("対象の番号: "));
    const picked = installs[answer - 1];
    if (!picked) throw new Error("番号が正しくありません");
    return picked;
}

async function main() {
    if (process.platform !== "win32") throw new Error("このインストーラは Windows 専用です");

    const { values } = parseArgs({
        options: {
            "list": { type: "boolean" },
            "install": { type: "boolean" },
            "uninstall": { type: "boolean" },
            "dev": { type: "boolean" },
            "from": { type: "string" },
            "branch": { type: "string" },
            "force-close": { type: "boolean" },
            "yes": { type: "boolean" }
        }
    });

    const deps = makeDeps();
    const installs = scanInstalls(deps.localAppData);

    if (values.list || (!values.install && !values.uninstall)) {
        if (installs.length === 0) console.log("Discord が見つかりません");
        for (const i of installs) console.log(`${i.spec.label} ${i.version}: ${describeInstall(i)}`);
        return;
    }

    const install = await pickInstall(installs, values.branch);
    const forceClose = values["force-close"] === true;

    if (values.uninstall) {
        report(uninstallFrom(deps, install, forceClose));
        return;
    }

    let source: DistSource;
    if (values.dev) source = { kind: "link", dir: join(process.cwd(), "dist") };
    else if (values.from) source = { kind: "copy", dir: values.from };
    else throw new Error("--dev か --from <dir> で、配置する成果物を指定してください");

    // 置き換えで外れるものを先に見せる（旧 VoiceCord や公式 Vencord を二重に載せない）
    const plan = previewInstall(deps, install);
    if (!plan.ok) {
        report({ ok: false, message: plan.reason });
        return;
    }
    if (plan.replaces.length > 0) {
        console.log(`${install.spec.label} から次のものを外して、vencord-extended に置き換えます:`);
        for (const p of plan.replaces) console.log(`  - ${p}`);
        if (!values.yes) {
            if (!process.stdin.isTTY) throw new Error("置き換えの確認ができません。--yes を付けて実行してください");
            if (!/^y(es)?$/i.test(await ask("続けますか？ [y/N] "))) {
                console.log("中止しました");
                return;
            }
        }
    }
    report(installTo(deps, install, source, forceClose));
}

function report(res: { ok: boolean; message: string; }) {
    (res.ok ? console.log : console.error)(res.message);
    if (!res.ok) process.exitCode = 1;
}

main().catch(e => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
});
