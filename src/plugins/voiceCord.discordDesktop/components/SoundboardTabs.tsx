/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { markTabsSeen } from "@plugins/voiceCord.discordDesktop/state";
import { classes } from "@utils/misc";
import { Clickable, useEffect, useState } from "@webpack/common";
import type { ReactNode } from "react";

import { PickerClasses, TabClasses } from "./discord";
import { SoundboardPopout } from "./SoundboardPopout";

type Tab = "discord" | "voicecord";

const TABS: { id: Tab; label: string; }[] = [
    { id: "discord", label: "サウンドボード" },
    { id: "voicecord", label: "VoiceCord" }
];

// 最後に開いていたタブ。ポップアウトは閉じるたびに作り直されるので、ここで持ち越す（Discord の再起動では戻る）
let lastTab: Tab = "discord";

function SoundboardTabs({ original }: { original: ReactNode; }) {
    const [tab, setTab] = useState<Tab>(lastTab);

    useEffect(markTabsSeen, []);

    const select = (t: Tab) => {
        lastTab = t;
        setTab(t);
    };

    // 純正のサウンドボードと同じ大きさの枠に、絵文字ピッカーと同じ見た目のタブを載せる
    return (
        <div className={classes(PickerClasses.picker, "vc-voicecord-tabs")}>
            <nav className={classes(TabClasses.nav, "vc-voicecord-tabs-nav")}>
                <div className={TabClasses.navList} role="tablist" aria-label="サウンドボード">
                    {TABS.map(({ id, label }) => (
                        <Clickable
                            key={id}
                            role="tab"
                            tabIndex={0}
                            aria-selected={tab === id}
                            aria-current={tab === id ? "page" : undefined}
                            className={classes(TabClasses.navItem, TabClasses.navButton, tab === id && TabClasses.navButtonActive)}
                            onClick={() => select(id)}
                        >
                            {label}
                        </Clickable>
                    ))}
                </div>
            </nav>
            <div className="vc-voicecord-tabs-body" role="tabpanel">
                {tab === "discord" ? original : <SoundboardPopout embedded />}
            </div>
        </div>
    );
}

// 描画に失敗したら純正の中身だけを返し、サウンドボード自体は使えるままにする
const WrappedTabs = ErrorBoundary.wrap(SoundboardTabs, {
    fallback: ({ wrappedProps }) => <>{wrappedProps.original}</>
});

/** 音声パネルのサウンドボードのポップアウト（パッチから呼ぶ）。純正の中身をタブの片方に入れる */
export function renderSoundboardTabs(original: ReactNode) {
    return <WrappedTabs original={original} />;
}
