/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { needApi } from "@plugins/voiceCord.discordDesktop/state";
import { classes } from "@utils/misc";
import { showToast, useEffect, useState } from "@webpack/common";

import type { VoiceCordStatus } from "../../../voicecord/shared/ipc";
import { DOT_LABEL, statusProblems } from "../../../voicecord/shared/status";
import type { SoundItem } from "../../../voicecord/shared/types";

const message = (e: unknown) => e instanceof Error ? e.message : String(e);

// M2 の最小のポップアウト。一覧・再生・全停止と、エンジンの状態だけを出す（音量や設定は M3）
export function SoundboardPopout() {
    const api = needApi();
    const [items, setItems] = useState<SoundItem[] | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [status, setStatus] = useState<VoiceCordStatus | null>(null);

    useEffect(() => {
        api.scanFolder("").then(setItems, e => setLoadError(message(e)));
        api.getStatus().then(setStatus, () => undefined);
        return api.onEvent(e => {
            if (e.ev === "status") setStatus(e.status);
        });
    }, [api]);

    const play = (item: SoundItem) => {
        api.play({ srcId: item.id, path: item.path, fp: item.fp, vol: 1 })
            .catch(e => showToast({ text: `再生できませんでした: ${message(e)}`, variant: "critical" }));
    };

    const stopAll = () => {
        api.stopAll().catch(e => showToast({ text: `停止できませんでした: ${message(e)}`, variant: "critical" }));
    };

    const problems = status ? statusProblems(status) : [];
    const playing = (status?.playing.length ?? 0) > 0;

    return (
        <div className="vc-voicecord-popout">
            <div className="vc-voicecord-header">
                <span className={classes("vc-voicecord-dot", status && `vc-voicecord-dot-${status.engine}`)} />
                <span className="vc-voicecord-title">VoiceCord</span>
                <span className="vc-voicecord-state">{status ? DOT_LABEL[status.engine] : "…"}</span>
                <button className="vc-voicecord-stop" onClick={stopAll} disabled={!playing}>全停止</button>
            </div>
            {problems.map(p => <div key={p} className="vc-voicecord-problem">{p}</div>)}
            {loadError && <div className="vc-voicecord-problem">{loadError}</div>}
            {items?.length === 0 && <div className="vc-voicecord-empty">音源フォルダに音声ファイルがありません</div>}
            <div className="vc-voicecord-grid">
                {items?.map(item => (
                    <button key={item.id} className="vc-voicecord-tile" onClick={() => play(item)} title={item.name}>
                        {item.name.replace(/\.[^.]+$/, "")}
                    </button>
                ))}
            </div>
        </div>
    );
}
