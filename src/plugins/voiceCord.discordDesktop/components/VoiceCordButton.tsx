/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { markButtonSeen } from "@plugins/voiceCord.discordDesktop/state";
import { classes } from "@utils/misc";
import { Popout, Tooltip, useEffect, useRef, useState } from "@webpack/common";

import { DiscordButton, PanelClasses } from "./discord";
import { SoundIcon } from "./icons";
import { SoundboardPopout } from "./SoundboardPopout";

// 純正サウンドボードボタンの隣に差し込むボタン。純正と同じ Button と props で描く
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
                // カメラボタンを隠す CSS の目印（discordIntegration.tsx）
                <div ref={ref} className="vc-voicecord-panel-slot">
                    <Tooltip text="VoiceCord" shouldShow={!show}>
                        {tooltipProps => (
                            <DiscordButton
                                {...tooltipProps}
                                aria-label="VoiceCord"
                                aria-expanded={show}
                                className={classes(PanelClasses.button, PanelClasses.buttonColor, show && PanelClasses.greyButtonActive)}
                                wrapperClassName={PanelClasses.button}
                                innerClassName={PanelClasses.buttonContents}
                                fullWidth
                                size={DiscordButton.Sizes.MEDIUM}
                                onClick={() => setShow(v => !v)}
                            >
                                <SoundIcon className={PanelClasses.buttonIcon} size={20} />
                            </DiscordButton>
                        )}
                    </Tooltip>
                </div>
            )}
        </Popout>
    );
}
