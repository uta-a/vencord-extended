/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { needApi } from "@plugins/voiceCord.discordDesktop/state";
import { classes } from "@utils/misc";
import { ScrollerThin, showToast, useEffect, useState } from "@webpack/common";
import type { KeyboardEvent } from "react";

import type { VoiceCordStatus } from "../../../voicecord/shared/ipc";
import { DOT_LABEL, statusProblems } from "../../../voicecord/shared/status";
import type { SoundItem } from "../../../voicecord/shared/types";
import { DiscordButton, DiscordText, PickerClasses, SectionClasses, SoundClasses } from "./discord";

const message = (e: unknown) => e instanceof Error ? e.message : String(e);
const soundName = (item: SoundItem) => item.name.replace(/\.[^.]+$/, "");

// 純正サウンドボードと同じく、1 行に 3 つずつ並べる
const SOUNDS_PER_ROW = 3;
const rowsOf = (items: SoundItem[]) =>
    Array.from({ length: Math.ceil(items.length / SOUNDS_PER_ROW) }, (_, i) => items.slice(i * SOUNDS_PER_ROW, (i + 1) * SOUNDS_PER_ROW));

// M2 の最小のポップアウト。一覧・再生・全停止と、エンジンの状態だけを出す（音量や設定は M3）。
// 器・見出し・タイルは純正サウンドボードのクラスと Discord の Text / Button で組む
export function SoundboardPopout() {
    const api = needApi();
    const [items, setItems] = useState<SoundItem[] | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [status, setStatus] = useState<VoiceCordStatus | null>(null);
    // 再生中の voiceId → 音源。タイルの「再生中」の表示に使う
    const [voices, setVoices] = useState<Record<string, string>>({});

    useEffect(() => {
        api.scanFolder("").then(setItems, e => setLoadError(message(e)));
        api.getStatus().then(setStatus, () => undefined);
        return api.onEvent(e => {
            if (e.ev === "status") setStatus(e.status);
        });
    }, [api]);

    const playing = status?.playing ?? [];
    const playingSources = new Set(Object.entries(voices).filter(([vid]) => playing.includes(vid)).map(([, src]) => src));

    const play = (item: SoundItem) => {
        api.play({ srcId: item.id, path: item.path, fp: item.fp, vol: 1 })
            .then(vid => vid && setVoices(v => ({ ...v, [vid]: item.id })))
            .catch(e => showToast({ text: `再生できませんでした: ${message(e)}`, variant: "critical" }));
    };

    const stopAll = () => {
        api.stopAll().catch(e => showToast({ text: `停止できませんでした: ${message(e)}`, variant: "critical" }));
    };

    const onTileKey = (e: KeyboardEvent, item: SoundItem) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        play(item);
    };

    const problems = [...(status ? statusProblems(status) : []), ...(loadError ? [loadError] : [])];

    return (
        <div className={classes(PickerClasses.picker, "vc-voicecord-picker")} role="dialog" aria-label="VoiceCord">
            <div className="vc-voicecord-header">
                <span className={classes("vc-voicecord-dot", status && `vc-voicecord-dot-${status.engine}`)} />
                <DiscordText variant="body-md/semibold" tag="h2">VoiceCord</DiscordText>
                <DiscordText variant="body-xs/medium" className="vc-voicecord-state">
                    {status ? DOT_LABEL[status.engine] : "…"}
                </DiscordText>
                <DiscordButton size={DiscordButton.Sizes.SMALL} color={DiscordButton.Colors.RED} disabled={playing.length === 0} onClick={stopAll}>
                    全停止
                </DiscordButton>
            </div>
            {problems.map(p => (
                <DiscordText key={p} variant="body-sm/medium" className="vc-voicecord-problem">{p}</DiscordText>
            ))}
            <ScrollerThin className="vc-voicecord-scroller">
                <div className={SectionClasses.sectionContainer}>
                    <div className={SectionClasses.sectionHeader}>
                        <div className={SectionClasses.sectionHeaderContent}>
                            <DiscordText variant="body-sm/semibold" tag="h1" className={SectionClasses.sectionTitle}>音源フォルダ</DiscordText>
                        </div>
                    </div>
                </div>
                {items?.length === 0 && (
                    <DiscordText variant="body-sm/medium" className="vc-voicecord-empty">音源フォルダに音声ファイルがありません</DiscordText>
                )}
                {rowsOf(items ?? []).map(row => (
                    <ul key={row[0].id} className={SectionClasses.soundRow}>
                        {row.map(item => (
                            <li key={item.id} className={SoundClasses.soundButtonWrapper}>
                                <div
                                    role="button"
                                    tabIndex={0}
                                    aria-label={`${soundName(item)}を再生する`}
                                    className={classes(SoundClasses.soundButton, SoundClasses.soundButtonInteractive, playingSources.has(item.id) && SoundClasses.playing)}
                                    onClick={() => play(item)}
                                    onKeyDown={e => onTileKey(e, item)}
                                >
                                    <div className={SoundClasses.soundInfo}>
                                        <DiscordText variant="body-xs/medium" className={SoundClasses.soundName} lineClamp={1}>{soundName(item)}</DiscordText>
                                    </div>
                                </div>
                            </li>
                        ))}
                    </ul>
                ))}
            </ScrollerThin>
        </div>
    );
}
