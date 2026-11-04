/*
 * Vencord Extended installer
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// VoiceCord Manager（voicecord-module/src/manager/patch/scan.ts）由来。
// 判定は必ず app.asar の実物を読んで行う。

import fs from "fs";
import { join } from "path";

import { type AppAsarKind, classifyAppAsar } from "./asar";

export type Branch = "stable" | "ptb" | "canary" | "development";

export interface BranchSpec {
    branch: Branch;
    /** %LOCALAPPDATA% 直下のディレクトリ名 */
    dirName: string;
    /** 実行ファイル名（起動中かどうかの判定に使う） */
    exeName: string;
    label: string;
}

export const BRANCHES: readonly BranchSpec[] = [
    { branch: "stable", dirName: "Discord", exeName: "Discord.exe", label: "Discord Stable" },
    { branch: "ptb", dirName: "DiscordPTB", exeName: "DiscordPTB.exe", label: "Discord PTB" },
    { branch: "canary", dirName: "DiscordCanary", exeName: "DiscordCanary.exe", label: "Discord Canary" },
    { branch: "development", dirName: "DiscordDevelopment", exeName: "DiscordDevelopment.exe", label: "Discord Development" }
];

export interface DiscordInstall {
    spec: BranchSpec;
    /** 例: 1.0.9256 */
    version: string;
    /** <...>/app-1.0.9256 */
    appDir: string;
    resourcesDir: string;
    status: AppAsarKind;
    hasBackup: boolean;
}

/** 数値で比較する。辞書順だと app-1.0.999 が app-1.0.1099 より新しいと判定されてしまう */
export function compareVersions(a: string, b: string): number {
    const pa = a.split(".");
    const pb = b.split(".");
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const na = Number(pa[i] ?? 0);
        const nb = Number(pb[i] ?? 0);
        if (Number.isNaN(na) || Number.isNaN(nb)) {
            const sa = pa[i] ?? "";
            const sb = pb[i] ?? "";
            if (sa !== sb) return sa < sb ? -1 : 1;
            continue;
        }
        if (na !== nb) return na - nb;
    }
    return 0;
}

/** 指定ブランチの最新 app-<version> を返す。無ければ null */
export function newestAppDir(branchDir: string): { version: string; name: string; } | null {
    if (!fs.existsSync(branchDir)) return null;
    let best: { version: string; name: string; } | null = null;
    for (const name of fs.readdirSync(branchDir)) {
        if (!name.startsWith("app-") || name.length <= 4) continue;
        const version = name.slice(4);
        if (best === null || compareVersions(version, best.version) > 0) best = { version, name };
    }
    return best;
}

/** 全ブランチを走査する。インストールされていないブランチは結果に出ない */
export function scanInstalls(localAppData: string): DiscordInstall[] {
    const out: DiscordInstall[] = [];
    for (const spec of BRANCHES) {
        const branchDir = join(localAppData, spec.dirName);
        const newest = newestAppDir(branchDir);
        if (newest === null) continue;
        const appDir = join(branchDir, newest.name);
        const resourcesDir = join(appDir, "resources");
        if (!fs.existsSync(resourcesDir)) continue;
        out.push({
            spec,
            version: newest.version,
            appDir,
            resourcesDir,
            status: classifyAppAsar(join(resourcesDir, "app.asar")),
            hasBackup: fs.existsSync(join(resourcesDir, "_app.asar"))
        });
    }
    return out;
}

/** 走査結果を表示用の 1 行に落とす */
export function describeInstall(i: DiscordInstall): string {
    const s = i.status;
    switch (s.kind) {
        case "plain":
            return i.hasBackup ? "要確認: app.asar は素ですが _app.asar が残っています" : "未導入";
        case "extended":
            return `vencord-extended 導入済み（${s.patcher}）`;
        case "legacyChain":
            return `${s.owner}（${s.chain.join(" → ")}）`;
        case "foreignShim":
            return `他の mod（${s.requires.join(", ") || "不明"}）`;
        case "missing":
            return "要確認: app.asar がありません";
        case "unknown":
            return `要確認: ${s.reason}`;
    }
}
