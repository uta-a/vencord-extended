/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React } from "@webpack/common";

import type { VoiceCordStatus } from "../../voicecord/shared/ipc";

// main の status（エンジンの生死・注入レート・サブシステムの失敗）。api の通知ループから受け取る
let current: VoiceCordStatus | null = null;
const listeners = new Set<() => void>();

export function setEngineStatus(s: VoiceCordStatus | null) {
    current = s;
    for (const cb of listeners) cb();
}

function subscribe(cb: () => void) {
    listeners.add(cb);
    return () => void listeners.delete(cb);
}

export function useEngineStatus() {
    return React.useSyncExternalStore(subscribe, () => current);
}
