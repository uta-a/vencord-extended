/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { showToast } from "@webpack/common";

import { createApi, type VoiceCordNative } from "./api";
import { mountFab, unmountFab } from "./components/Fab";
import { syncLevelModal } from "./components/LevelModal";
import { PluginSettings } from "./components/PluginSettings";
import { renderSoundboardTabs } from "./components/SoundboardTabs";
import { onSoundClick, renderHeaderAccessories, watchSoundboardStyles, watchVoiceChannel } from "./discordIntegration";
import { setEngineStatus } from "./engineStatus";
import { markTabsPatched, needApi, state } from "./state";
import { bindApi, resetStore, store } from "./store";
import style from "./style.css?managed";

const Native = VencordNative.pluginHelpers.VoiceCord as VoiceCordNative;
const logger = new Logger("VoiceCord");

// 緊急停止。main 側でも before-input-event で同じキーを受ける（renderer が固まっていても止められるように）
function onKeyDown(e: KeyboardEvent) {
    if (!(e.ctrlKey && e.altKey && e.shiftKey && e.code === "KeyX")) return;
    e.preventDefault();
    // 試聴とモニターも止めるため、エンジンへの全停止に加えて store の全停止を使う
    store.getState().stopAll();
    showToast({ text: "VoiceCord: すべての再生を止めました", variant: "success" });
}

let cleanups: (() => void)[] = [];

export default definePlugin({
    name: "VoiceCord",
    description: "ボイスチャンネルにサウンドを流し込みます（Windows の Discord デスクトップ版のみ）",
    // 作者一覧は src/utils/constants.ts の Devs からしか引けない。upstream と衝突しやすい Devs には足さず、空にしておく
    authors: [],
    enabledByDefault: true,
    managedStyle: style,
    settingsAboutComponent: () => <PluginSettings />,

    patches: [
        {
            // 音声パネルのサウンドボードのポップアウト。純正の中身を包み、「サウンドボード / VoiceCord」のタブを付ける
            find: "CUSTOM_CALL_SOUNDS_PICKER_UPSELL&&",
            replacement: {
                match: /\(0,\i\.jsx\)\(\i\.\i,\{guildId:\i,channel:\i,onClose:\i,gridNotice:.{0,150}?analyticsSource:"rtc panel"\}\)/,
                // 当たったことを記録する（外れていたら予備のボタンを出す）。パッチ済みのソースは開発ビルドでしか残らないので、ここで印を付ける
                replace: m => {
                    markTabsPatched();
                    return `$self.renderSoundboardTabs(${m})`;
                }
            }
        },
        {
            // 純正サウンドボードのタイル。ロックされた（ほかのサーバーの）サウンドのクリックを、設定が ON なら VoiceCord で鳴らす。
            // 後読みでロックの判定（!canUseSound(...)）とサウンドの変数を拾い、onClick の先頭で分岐させる
            find: /showLockForDisabledSound:\i=!0/,
            replacement: {
                match: /(?<=(\i)=!\(0,\i\.\i\)\(\i,(\i),\i\)&&!\i,.{0,2500}?)onClick:(\i)=>\{/,
                replace: "onClick:$3=>{if($self.onSoundClick($3,$2,$1))return;"
            }
        },
        {
            // 純正サウンドボードのヘッダー。右端（音量アイコン）の前に、VoiceCord の停止ボタンを並べる
            find: '"SoundboardSoundGrid"',
            replacement: {
                match: /renderHeaderAccessories:(\i),(?=rowHeight:48)/,
                replace: "renderHeaderAccessories:()=>$self.renderHeaderAccessories($1),"
            }
        }
    ],

    renderSoundboardTabs,
    onSoundClick,
    renderHeaderAccessories,

    async start() {
        const api = createApi(Native);
        state.api = api;
        bindApi(api);

        // store の通知（status）は連番付きなので、同じ文言が続いても毎回出す
        let lastNotice = store.getState().notice.seq;
        cleanups = [
            api.onEvent(e => {
                if (e.ev === "status") setEngineStatus(e.status);
            }),
            store.subscribe(s => {
                if (s.notice.seq !== lastNotice) {
                    lastNotice = s.notice.seq;
                    if (s.notice.msg) showToast({ text: s.notice.msg });
                }
                syncLevelModal(s.levelOpen);
            }),
            watchSoundboardStyles(),
            watchVoiceChannel()
        ];
        document.addEventListener("keydown", onKeyDown, true);
        mountFab();

        try {
            const status = await Native.ensureStarted();
            setEngineStatus(status);
            logger.info("起動しました", status);
        } catch (e) {
            logger.error("起動できませんでした", e);
        }
        await store.getState().init();
    },

    async stop() {
        document.removeEventListener("keydown", onKeyDown, true);
        for (const off of cleanups) off();
        cleanups = [];
        unmountFab();
        syncLevelModal(false);
        resetStore();
        setEngineStatus(null);
        state.api?.close();
        state.api = null;
        try {
            await Native.shutdown();
        } catch (e) {
            logger.error("停止できませんでした", e);
        }
    },

    // DevTools からの確認用: Vencord.Plugins.plugins.VoiceCord.debug.status()
    debug: {
        status: () => needApi().getStatus(),
        store: () => store.getState(),
        // 表示の確認用。setState で保存せずに状態を差し替えられる
        storeApi: () => store,
        tabsPatched: () => state.tabsPatched
    }
});
