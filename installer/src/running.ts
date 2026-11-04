/*
 * Vencord Extended installer
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// VoiceCord Manager（voicecord-module/src/manager/patch/running.ts）由来。
// 起動中に app.asar を差し替えるとロックで失敗し、中途半端な状態になりうるので、適用の前に必ず確かめる。

/** tasklist の出力を返す関数（テストで差し替える） */
export type ProcessLister = (imageName: string) => string;

/**
 * tasklist の CSV 出力から、そのイメージ名のプロセスの PID を拾う。
 * 該当なしのときの 1 行（「情報: ...」/ "INFO: ..."）は CSV 行かどうかで見分けるので、ロケールに依存しない。
 */
export function parseTasklist(output: string, imageName: string): number[] {
    const pids: number[] = [];
    for (const line of output.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('"')) continue;
        const cells = trimmed.split('","').map(c => c.replace(/^"|"$/g, ""));
        const pid = Number(cells[1]);
        if (cells[0]?.toLowerCase() !== imageName.toLowerCase() || !Number.isInteger(pid)) continue;
        pids.push(pid);
    }
    return pids;
}

export interface RunningCheck {
    running: boolean;
    pids: number[];
}

export function isRunning(list: ProcessLister, imageName: string): RunningCheck {
    let output: string;
    try {
        output = list(imageName);
    } catch {
        // 判定できないときは「起動している」と見なす。分からないまま差し替えに進むより安全
        return { running: true, pids: [] };
    }
    const pids = parseTasklist(output, imageName);
    return { running: pids.length > 0, pids };
}

export function tasklistCommand(imageName: string): string[] {
    return ["tasklist", "/FI", `IMAGENAME eq ${imageName}`, "/FO", "CSV", "/NH"];
}

/** /T で子プロセスごと落とす。イメージ名は BRANCHES の固定値だけを渡す */
export function taskkillCommand(imageName: string): string[] {
    return ["taskkill", "/F", "/T", "/IM", imageName];
}
