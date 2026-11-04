/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { VoiceCordApi } from "./api";

const buttonSeenListeners = new Set<() => void>();

// プラグインの start() で作り、stop() で捨てる。部品はここから api を受け取る
export const state = {
    api: null as VoiceCordApi | null,
    // 音声パネルのボタンが一度でも描画されたか。パッチが当たっていない（予備の FAB が要る）ことの判定に使う
    buttonSeen: false
};

export function needApi() {
    if (!state.api) throw new Error("VoiceCord が起動していません");
    return state.api;
}

export function markButtonSeen() {
    if (state.buttonSeen) return;
    state.buttonSeen = true;
    for (const cb of buttonSeenListeners) cb();
}

export function onButtonSeen(cb: () => void) {
    buttonSeenListeners.add(cb);
    return () => void buttonSeenListeners.delete(cb);
}
