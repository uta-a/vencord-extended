/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { onButtonSeen, state } from "@plugins/voiceCord.discordDesktop/state";
import { createRoot, Popout, SelectedChannelStore, Tooltip, useEffect, useRef, useState, useStateFromStores } from "@webpack/common";
import type { Root } from "react-dom/client";

import { DiscordButton } from "./discord";
import { SoundIcon } from "./icons";
import { SoundboardPopout } from "./SoundboardPopout";

// VC に入ってからこの時間、パネルのボタンが一度も描画されなければパッチが外れたと見なす
const BUTTON_GRACE_MS = 5000;

const BROKEN_TEXT = "音声パネルにボタンを差し込めませんでした（Discord の更新でパッチが外れた可能性があります）。代わりにここから使えます";

function Fab() {
    const inVc = useStateFromStores([SelectedChannelStore], () => SelectedChannelStore.getVoiceChannelId() != null);
    const [seen, setSeen] = useState(state.buttonSeen);
    const [graceOver, setGraceOver] = useState(false);
    const [show, setShow] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => onButtonSeen(() => setSeen(true)), []);

    useEffect(() => {
        setGraceOver(false);
        if (!inVc) return;
        const timer = setTimeout(() => setGraceOver(true), BUTTON_GRACE_MS);
        return () => clearTimeout(timer);
    }, [inVc]);

    if (!inVc || seen || !graceOver) return null;

    return (
        <Popout
            position="top"
            align="right"
            shouldShow={show}
            onRequestClose={() => setShow(false)}
            targetElementRef={ref}
            renderPopout={() => <SoundboardPopout />}
        >
            {() => (
                <div ref={ref} className="vc-voicecord-fab-wrapper">
                    <Tooltip text={BROKEN_TEXT} shouldShow={!show}>
                        {tooltipProps => (
                            <DiscordButton
                                {...tooltipProps}
                                aria-label="VoiceCord"
                                className="vc-voicecord-fab"
                                size={DiscordButton.Sizes.ICON}
                                color={DiscordButton.Colors.BRAND}
                                onClick={() => setShow(v => !v)}
                            >
                                <SoundIcon size={24} />
                            </DiscordButton>
                        )}
                    </Tooltip>
                </div>
            )}
        </Popout>
    );
}

const WrappedFab = ErrorBoundary.wrap(Fab, { noop: true });

let root: Root | null = null;
let host: HTMLDivElement | null = null;

export function mountFab() {
    if (root) return;
    host = document.body.appendChild(document.createElement("div"));
    host.id = "vc-voicecord-fab-root";
    root = createRoot(host);
    root.render(<WrappedFab />);
}

export function unmountFab() {
    root?.unmount();
    host?.remove();
    root = null;
    host = null;
}
