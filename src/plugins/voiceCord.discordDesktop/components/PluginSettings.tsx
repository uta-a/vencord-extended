/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEngineStatus } from "@plugins/voiceCord.discordDesktop/engineStatus";
import { state } from "@plugins/voiceCord.discordDesktop/state";
import { store } from "@plugins/voiceCord.discordDesktop/store";
import { showToast } from "@webpack/common";

import { DOT_LABEL, statusProblems } from "../../../voicecord/shared/status";
import { DiscordText } from "./discord";
import { Btn, Small } from "./ui";

// Vencord のプラグイン設定（プラグイン一覧から開くモーダル）に出す、状態と復旧の操作
export function PluginSettings() {
    const status = useEngineStatus();
    const problems = status ? statusProblems(status) : [];

    const reattach = async () => {
        if (!state.api) {
            showToast({ text: "VoiceCord が起動していません", variant: "critical" });
            return;
        }
        await state.api.attach("canary");
        showToast({ text: "エンジンの状態を確認しました（壊れていれば起こし直しています）" });
    };

    return (
        <div className="vc-voicecord-stack">
            <DiscordText variant="body-md/medium">
                エンジン: {status ? DOT_LABEL[status.engine] : "起動していません"}
                {status && ` ・ ${status.discordBuild} ${status.discordVersion}`}
            </DiscordText>
            {problems.length > 0 && <div className="vc-voicecord-problems">{problems.join("\n")}</div>}
            <Small>サウンドボードは、VC に入ると音声パネルの VoiceCord ボタン（純正サウンドボードの隣）から開けます。音量や入場サウンドはそのポップアウトの歯車から設定します。</Small>
            <Small>再生が止まらないときは Ctrl+Alt+Shift+X ですべて止まります。</Small>
            <div className="vc-voicecord-inline">
                <Btn size="sm" variant="secondary" onClick={() => void reattach()}>エンジンを確認・再起動</Btn>
                <Btn size="sm" variant="secondary" onClick={() => store.getState().setLevelOpen(true)}>音量調整を開く</Btn>
                <Btn size="sm" variant="danger" onClick={() => store.getState().stopAll()}>すべて停止</Btn>
            </div>
        </div>
    );
}
