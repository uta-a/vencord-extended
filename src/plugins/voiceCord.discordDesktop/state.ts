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

const tabsPatchedListeners = new Set<() => void>();

export function markTabsPatched() {
    state.tabsPatched = true;
    for (const cb of tabsPatchedListeners) cb();
}

/** パッチが（遅れて）当たったことを受け取る。予備のボタンを引っ込めるのに使う */
export function onTabsPatched(cb: () => void) {
    tabsPatchedListeners.add(cb);
    return () => void tabsPatchedListeners.delete(cb);
}

export function markTabsSeen() {
    state.tabsSeen = true;
}
