/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { showToast } from "@webpack/common";

import { createApi, type VoiceCordNative } from "./api";
import { mountFab, unmountFab } from "./components/Fab";
import { VoiceCordButton } from "./components/VoiceCordButton";
import { needApi, state } from "./state";
import style from "./style.css?managed";

const Native = VencordNative.pluginHelpers.VoiceCord as VoiceCordNative;
const logger = new Logger("VoiceCord");

// 緊急停止。main 側でも before-input-event で同じキーを受ける（renderer が固まっていても止められるように）
function onKeyDown(e: KeyboardEvent) {
    if (!(e.ctrlKey && e.altKey && e.shiftKey && e.code === "KeyX")) return;
    e.preventDefault();
    state.api?.stopAll()
        .then(() => showToast({ text: "VoiceCord: すべての再生を止めました", variant: "success" }))
        .catch(err => logger.error("緊急停止に失敗しました", err));
}

export default definePlugin({
    name: "VoiceCord",
    description: "ボイスチャンネルにサウンドを流し込みます（Windows の Discord デスクトップ版のみ）",
    // 作者一覧は src/utils/constants.ts の Devs からしか引けない。upstream と衝突しやすい Devs には足さず、空にしておく
    authors: [],
    enabledByDefault: true,
    managedStyle: style,

    patches: [
        {
            // 音声パネルのボタン列。純正サウンドボードボタン（最後の要素）の直後に差し込む
            find: /canGoLive:\i,enableActivities:/,
            replacement: {
                match: /\{channel:(\i),focusProps:\i\}\):null(?=\]\})/,
                replace: "$&,$self.renderPanelButton({channel:$1})"
            }
        }
    ],

    renderPanelButton: ErrorBoundary.wrap(VoiceCordButton, { noop: true }),

    async start() {
        state.api = createApi(Native);
        document.addEventListener("keydown", onKeyDown, true);
        mountFab();
        try {
            logger.info("起動しました", await Native.ensureStarted());
        } catch (e) {
            logger.error("起動できませんでした", e);
        }
    },

    async stop() {
        document.removeEventListener("keydown", onKeyDown, true);
        unmountFab();
        state.api?.close();
        state.api = null;
        try {
            await Native.shutdown();
        } catch (e) {
            logger.error("停止できませんでした", e);
        }
    },

    // DevTools からの確認用: Vencord.Plugins.plugins.VoiceCord.debug.play(0)
    debug: {
        status: () => needApi().getStatus(),
        list: () => needApi().scanFolder(""),
        async play(indexOrName: number | string, vol = 1) {
            const items = await needApi().scanFolder("");
            const item = typeof indexOrName === "number" ? items[indexOrName] : items.find(i => i.name === indexOrName);
            if (!item) throw new Error(`音源が見つかりません: ${indexOrName}`);
            return needApi().play({ srcId: item.id, path: item.path, fp: item.fp, vol });
        },
        stopAll: () => needApi().stopAll()
    }
});
