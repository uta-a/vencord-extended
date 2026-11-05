/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React } from "@webpack/common";

import { store } from "./store";

type State = ReturnType<typeof store.getState>;

// store を Discord の React で購読する。zustand の React 版を束ねると React が 2 つになるので、
// zustand/vanilla の store を useSyncExternalStore で包む
export function useVoiceCord<T>(selector: (s: State) => T): T {
    return React.useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}
