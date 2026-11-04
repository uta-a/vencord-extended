/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { markButtonSeen } from "@plugins/voiceCord.discordDesktop/state";
import { classes } from "@utils/misc";
import { findCssClassesLazy } from "@webpack";
import { Popout, Tooltip, useEffect, useRef, useState } from "@webpack/common";

import { SoundIcon } from "./icons";
import { SoundboardPopout } from "./SoundboardPopout";

// 音声パネルのボタン列の CSS。キーは短縮されているので、クラス名の接頭辞で引く
const PanelClasses = findCssClassesLazy("voiceUsers", "actionButtons", "button", "buttonColor", "buttonContents", "buttonIcon", "greyButtonActive");

// 純正サウンドボードボタンの隣に差し込むボタン。押すとポップアウトを開く
export function VoiceCordButton() {
    const ref = useRef<HTMLDivElement>(null);
    const [show, setShow] = useState(false);

    useEffect(markButtonSeen, []);

    return (
        <Popout
            position="top"
            align="center"
            shouldShow={show}
            onRequestClose={() => setShow(false)}
            targetElementRef={ref}
            renderPopout={() => <SoundboardPopout />}
        >
            {() => (
                <div ref={ref} className="vc-voicecord-panel-wrapper">
                    <Tooltip text="VoiceCord" shouldShow={!show}>
                        {tooltipProps => (
                            <button
                                {...tooltipProps}
                                aria-label="VoiceCord"
                                className={classes(PanelClasses.button, PanelClasses.buttonColor, show && PanelClasses.greyButtonActive, "vc-voicecord-panel-button")}
                                onClick={() => setShow(v => !v)}
                            >
                                <div className={PanelClasses.buttonContents}>
                                    <SoundIcon className={PanelClasses.buttonIcon} />
                                </div>
                            </button>
                        )}
                    </Tooltip>
                </div>
            )}
        </Popout>
    );
}
