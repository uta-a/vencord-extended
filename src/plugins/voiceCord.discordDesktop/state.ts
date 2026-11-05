/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { VoiceCordApi } from "./api";

// プラグインの start() で作り、stop() で捨てる。部品はここから api を受け取る
export const state = {
    api: null as VoiceCordApi | null,
    // 純正サウンドボードにタブを差し込むパッチが当たったか。外れていたら予備のボタンを出す
    tabsPatched: false,
    // 純正サウンドボードの VoiceCord タブが一度でも描画されたか。状態の表示に使う
    tabsSeen: false
};

export function needApi() {
    if (!state.api) throw new Error("VoiceCord が起動していません");
    return state.api;
}

export function markTabsPatched() {
    state.tabsPatched = true;
}

export function markTabsSeen() {
    state.tabsSeen = true;
}
