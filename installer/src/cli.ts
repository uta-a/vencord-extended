/*
 * Vencord Extended installer
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * インストーラ。引数なしで起動すると、Vencord 公式インストーラの CLI 版と同じく対話（TUI）で進む。
 * 引数を付けると対話せずに行う（pnpm inject / uninject もここを呼ぶ）。
 *
 *   --install                      最新のリリースを取ってきて導入する
 *   --repair                       最新のリリースを取り直し、VoiceCord のランタイムも取り直させる
 *   --uninstall                    素の Discord に戻す
 *   --list                         Discord の検出結果と導入状態を表示する
 *   --dev                          （--install と）リポジトリの dist へリンクを張る（開発用）
 *   --from <dir>                   （--install と）<dir> の成果物をコピーする
 *   --branch <stable|ptb|canary|development>  対象（省略時は 1 つだけならそれ、複数なら尋ねる）
 *   --force-close                  起動中の Discord を終了してから行い、終わったら再起動する
 *   --yes                          置き換えの確認を省く
 *   --repo <owner/name>            取得元のリポジトリ（既定は uta-a/vencord-extended）
 *   --version / --help
 */

import { execFileSync, spawn } from "child_process";
import fs from "fs";
import os from "os";
import { join } from "path";
import { parseArgs } from "util";

import { DEFAULT_REPO, downloadLatestDist } from "./release";
import { isRunning, taskkillCommand, tasklistCommand } from "./running";
import { type DiscordInstall, describeInstall, scanInstalls } from "./scan";
import { type DistSource, installTo, type OpResult, previewInstall, type ServiceDeps, uninstallFrom } from "./service";
import { Cancelled, color, confirm, fail, info, isInteractive, ok, select, waitEnter, warn } from "./tui";

declare const INSTALLER_VERSION: string | undefined;
const VERSION = typeof INSTALLER_VERSION === "string" ? INSTALLER_VERSION : "dev";

const SUPPORT = "うまくいかないときは docs/recovery.md（復旧手順）を見てください: https://github.com/uta-a/vencord-extended/blob/main/docs/recovery.md";

const HELP = `Vencord Extended インストーラ ${VERSION}

引数なしで起動すると、対話で進めます。

  --install            最新のリリースを取ってきて導入する
  --repair             最新のリリースを取り直し、VoiceCord のランタイムも取り直させる
  --uninstall          素の Discord に戻す
  --list               Discord の検出結果と導入状態を表示する
  --branch <名前>      対象の Discord（stable / ptb / canary / development）
  --force-close        起動中の Discord を終了してから行い、終わったら再起動する
  --yes                置き換えの確認を省く
  --dev                （--install と）リポジトリの dist へリンクを張る（開発用）
  --from <フォルダ>    （--install と）フォルダの成果物をコピーする
  --repo <owner/name>  取得元のリポジトリ（既定は ${DEFAULT_REPO}）
  --version            版を表示する
  --help               この説明を表示する`;

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

type Action = "install" | "repair" | "uninstall";

const ACTION_LABEL: Record<Action, string> = {
    install: "導入",
    repair: "修復",
    uninstall: "解除"
};

/**
 * interactive: 引数なしの対話。1 つしか無くても選ばせる（何に入れるかを見せる）。
 * canAsk: 引数付きでも端末なら、複数あるときは尋ねる（pnpm inject など）
 */
async function pickInstall(installs: DiscordInstall[], branch: string | undefined, action: Action, interactive: boolean, canAsk: boolean): Promise<DiscordInstall> {
    if (branch) {
        const found = installs.find(i => i.spec.branch === branch);
        if (!found) throw new Error(`${branch} の Discord が見つかりません`);
        return found;
    }
    if (installs.length === 0) throw new Error("Discord が見つかりません。Discord をインストールしてから、もう一度実行してください");
    if (installs.length === 1 && !interactive) return installs[0];
    if (!canAsk) throw new Error("Discord が複数あります。--branch で指定してください");
    return select(`${ACTION_LABEL[action]}する Discord を選んでください`, installs.map(i => ({
        label: `${i.spec.label} ${i.version}`,
        hint: `(${describeInstall(i)})`,
        value: i
    })));
}

/** 起動中なら、対話では終了してよいか尋ね、引数のときは --force-close に従う */
async function resolveForceClose(deps: ServiceDeps, install: DiscordInstall, forceClose: boolean, interactive: boolean): Promise<boolean> {
    if (forceClose || !interactive) return forceClose;
    if (!isRunning(deps.listProcesses, install.spec.exeName).running) return false;
    if (await confirm(`${install.spec.label} が起動しています。終了して続け、終わったら起動し直しますか？`)) return true;
    throw new Cancelled();
}

async function runInstall(deps: ServiceDeps, install: DiscordInstall, action: "install" | "repair", opts: {
    forceClose: boolean;
    yes: boolean;
    interactive: boolean;
    canAsk: boolean;
    dev: boolean;
    from: string | undefined;
    repo: string;
}): Promise<OpResult> {
    // 置き換えで外れるものを先に見せる（旧 VoiceCord や公式 Vencord を二重に載せない）
    const plan = previewInstall(deps, install);
    if (!plan.ok) return { ok: false, message: plan.reason };
    if (plan.replaces.length > 0) {
        warn(`${install.spec.label} から次のものを外して、Vencord Extended に置き換えます:`);
        for (const p of plan.replaces) console.log(`    - ${p}`);
        if (!opts.yes) {
            if (!opts.canAsk) throw new Error("置き換えの確認ができません。--yes を付けて実行してください");
            if (!await confirm("続けますか？")) throw new Cancelled();
        }
    }

    const forceClose = await resolveForceClose(deps, install, opts.forceClose, opts.interactive);

    let tmp: string | null = null;
    try {
        let source: DistSource;
        if (opts.dev) source = { kind: "link", dir: join(process.cwd(), "dist") };
        else if (opts.from) source = { kind: "copy", dir: opts.from };
        else {
            tmp = fs.mkdtempSync(join(os.tmpdir(), "vencord-extended-"));
            info(`最新のリリースを取得しています（${opts.repo}）…`);
            const release = await downloadLatestDist(opts.repo, tmp);
            info(`${release.name || release.tag_name} を取得しました`);
            source = { kind: "copy", dir: tmp };
        }
        const res = installTo(deps, install, source, forceClose, { resetRuntime: action === "repair" });
        // リリースの patcher.js は、ランタイムが無ければ起動時に取得する（開発用のリンクではリポジトリのものを使う）
        if (res.ok && tmp) res.message += "\nVoiceCord のランタイム（約 35 MB）は、Discord の次の起動時に自動で取得します";
        return res;
    } finally {
        // 取得に失敗したときも消す
        if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    }
}

function report(res: OpResult) {
    if (res.ok) {
        ok(color.green("完了しました"));
        console.log(res.message);
    } else {
        fail(color.red("失敗しました"));
        console.error(res.message);
        console.error(color.dim(SUPPORT));
        process.exitCode = 1;
    }
}

async function main(): Promise<void> {
    const { values } = parseArgs({
        options: {
            "list": { type: "boolean" },
            "install": { type: "boolean" },
            "repair": { type: "boolean" },
            "uninstall": { type: "boolean" },
            "dev": { type: "boolean" },
            "from": { type: "string" },
            "branch": { type: "string" },
            "force-close": { type: "boolean" },
            "yes": { type: "boolean" },
            "repo": { type: "string" },
            "version": { type: "boolean" },
            "help": { type: "boolean" }
        }
    });

    if (values.version) return void console.log(`Vencord Extended インストーラ ${VERSION}`);
    if (values.help) return void console.log(HELP);
    if (process.platform !== "win32") throw new Error("このインストーラは Windows 専用です");

    const deps = makeDeps();
    const installs = scanInstalls(deps.localAppData);

    if (values.list) {
        if (installs.length === 0) console.log("Discord が見つかりません");
        for (const i of installs) console.log(`${i.spec.label} ${i.version}: ${describeInstall(i)}`);
        return;
    }

    let action: Action | "quit" | null =
        values.install ? "install" : values.repair ? "repair" : values.uninstall ? "uninstall" : null;
    const interactive = action === null;
    if (interactive && !isInteractive()) throw new Error("対話できない環境です。--install などの引数を付けて実行してください（--help）");

    if (interactive) {
        console.log(color.bold(`Vencord Extended インストーラ ${VERSION}`));
        console.log(color.dim("Vencord の非公式 fork です。VoiceCord（VC にサウンドを流す機能）が入っています"));
        console.log();
        // 公式の CLI 版と同じく、操作名だけを並べる（説明は --help と手順書に書く）
        action = await select("何をしますか？（Enter で決定）", [
            { label: "Vencord Extended を導入", value: "install" as const },
            { label: "Vencord Extended を修復", value: "repair" as const },
            { label: "Vencord Extended を解除", value: "uninstall" as const },
            { label: "終了", value: "quit" as const }
        ]);
        if (action === "quit") return;
    }
    if (action === null) return;

    const canAsk = isInteractive();
    const install = await pickInstall(installs, values.branch, action, interactive, canAsk);
    if (action === "uninstall") {
        const forceClose = await resolveForceClose(deps, install, values["force-close"] === true, interactive);
        report(uninstallFrom(deps, install, forceClose));
        return;
    }
    report(await runInstall(deps, install, action, {
        forceClose: values["force-close"] === true,
        yes: values.yes === true,
        interactive,
        canAsk,
        dev: values.dev === true,
        from: values.from,
        repo: values.repo ?? DEFAULT_REPO
    }));
}

const interactiveLaunch = process.argv.length <= 2;

let cancelled = false;

main()
    .catch(e => {
        if (e instanceof Cancelled) {
            cancelled = true;
            warn("中止しました");
            return;
        }
        fail(color.red("失敗しました"));
        console.error(e instanceof Error ? e.message : String(e));
        console.error(color.dim(SUPPORT));
        process.exitCode = 1;
    })
    // ダブルクリックで開いたとき、結果を読む前に窓が閉じないようにする（公式の CLI 版と同じ）
    // 自分で中止したときは読むべき結果が無いので、待たずに閉じる
    .then(() => (interactiveLaunch && !cancelled && isInteractive() ? waitEnter() : undefined))
    .finally(() => process.exit());
