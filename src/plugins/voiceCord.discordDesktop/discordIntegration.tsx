/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { findCssClassesLazy } from "@webpack";
import { Clickable, SelectedChannelStore, Tooltip } from "@webpack/common";
import type { MouseEvent } from "react";

import { isSoundboardSoundId } from "../../voicecord/shared/soundboard";
import { FilledStopIcon } from "./components/icons";
import { isTrustedInput } from "./lib/trusted";
import { playingSoundboardIds, store } from "./store";

// 純正サウンドボードと音声パネルとの連携（voicecord-module の preload の presence / cameraButton /
// lockedSounds / soundboardStop 由来）。DOM の接ぎ木と横取りをやめ、webpack パッチと CSS で行う。
// Discord の要素そのものには属性もスタイルも足さず、html の印と CSS だけで見た目を変える

const HeaderClasses = findCssClassesLazy("settingsClickArea", "settingsIcon", "soundRow");

const HIDE_CAMERA_ATTR = "data-voicecord-hide-camera";
const UNLOCK_ATTR = "data-voicecord-unlock-soundboard";
const STYLE_ID = "vc-voicecord-dynamic";

// ---- ほかのサーバーのサウンド ----

interface SoundboardSound {
    soundId: string;
    name: string;
}

/**
 * 純正サウンドボードのタイルのクリック（パッチから呼ぶ）。設定が ON でロックされたサウンドなら、
 * 純正の Nitro 勧誘へ渡さずに VoiceCord で鳴らして true を返す。VC へ音を流すので本物の入力だけで鳴らす
 */
export function onSoundClick(e: MouseEvent, sound: SoundboardSound | undefined, locked: boolean): boolean {
    try {
        if (!locked || !sound || !store.getState().settings.unlockSoundboard) return false;
        if (!isSoundboardSoundId(sound.soundId)) return false;
        e.preventDefault();
        e.stopPropagation();
        if (isTrustedInput(e)) void store.getState().playSoundboardSound(sound.soundId, String(sound.name ?? "").slice(0, 100));
        else console.warn("[VoiceCord] 本物の入力ではないため、ほかのサーバーのサウンドの再生を無視しました");
        return true;
    } catch (err) {
        console.error("[VoiceCord] ほかのサーバーのサウンドを鳴らせませんでした", err);
        return false;
    }
}

// ---- 純正サウンドボードのヘッダーの停止ボタン ----

function SoundboardStopButton() {
    return (
        <Tooltip text="VoiceCord の音をすべて停止">
            {p => (
                <Clickable
                    {...p}
                    tabIndex={0}
                    aria-label="VoiceCord の音をすべて停止"
                    className={HeaderClasses.settingsClickArea}
                    // 止める操作なので合成イベントでも効かせる
                    onClick={() => store.getState().stopAll()}
                >
                    <FilledStopIcon size={20} className={HeaderClasses.settingsIcon} />
                </Clickable>
            )}
        </Tooltip>
    );
}

const WrappedStopButton = ErrorBoundary.wrap(SoundboardStopButton, { noop: true });

/** 純正サウンドボードのヘッダーの右端（音量アイコン）の前に、停止ボタンを並べる（パッチから呼ぶ） */
export function renderHeaderAccessories(original: () => React.ReactNode) {
    return <><WrappedStopButton />{original()}</>;
}

// ---- 動的な CSS（カメラ・ロック・再生中の枠） ----

// ロックの鍵と Nitro の装飾・誘導を隠す。クラス名は短縮されているので「名前_」の部分一致で当てる
const UNLOCK_CSS = [
    "[class*=\"soundButton_\"] svg[class*=\"lockIcon_\"]{display:none !important}",
    "[class*=\"soundRowNitroLocked_\"]{background:none !important}",
    "[class*=\"sectionContainerNitroLockedBackground_\"]{background:var(--background-base-low) !important}",
    "[class^=\"nitroLocked_\"],[class*=\" nitroLocked_\"]{background:none !important}",
    "[class*=\"nitroTopDividerContainer_\"]{display:none !important}",
    "[role=\"dialog\"] [class*=\"upsellContainerFloating_\"]{display:none !important}",
    "[class*=\"categoryItemLockIconContainer_\"]{display:none !important}"
].map(rule => `html[${UNLOCK_ATTR}] ${rule.replace(/,/g, `,html[${UNLOCK_ATTR}] `)}`).join("");

// ビデオボタンを隠す。VoiceCord のボタンがある列の先頭の子（純正の並びではカメラ）だけに効かせる
const CAMERA_CSS = `html[${HIDE_CAMERA_ATTR}] [class*="actionButtons_"]:has(> .vc-voicecord-panel-slot) > :first-child:not(.vc-voicecord-panel-slot){display:none !important}`;

// VoiceCord で鳴らしている純正サウンドボードのサウンドに、純正の再生中と同じ緑の枠を付ける
function playingCss(ids: readonly string[]) {
    const safe = ids.filter(isSoundboardSoundId);
    if (safe.length === 0) return "";
    return `${safe.map(id => `[role="dialog"] [class*="soundButton_"]:has(> [id="sound-${id}"])`).join(",")}{border-color:var(--status-positive-background, hsl(151.4 100% 25.1%)) !important}`;
}

/** 設定と再生状態に合わせて、html の印と CSS を更新し続ける。戻り値で後始末する */
export function watchSoundboardStyles() {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.appendChild(style);
    const root = document.documentElement;
    let lastCss = "";

    const apply = () => {
        const s = store.getState();
        root.toggleAttribute(HIDE_CAMERA_ATTR, s.settings.hideCameraButton);
        root.toggleAttribute(UNLOCK_ATTR, s.settings.unlockSoundboard);
        const css = CAMERA_CSS + UNLOCK_CSS + playingCss(playingSoundboardIds(s.voices));
        if (css !== lastCss) style.textContent = lastCss = css;
    };
    apply();
    const off = store.subscribe(apply);
    return () => {
        off();
        style.remove();
        root.removeAttribute(HIDE_CAMERA_ATTR);
        root.removeAttribute(UNLOCK_ATTR);
    };
}

// ---- VC 在席 ----

/** Discord の画面上で VC に居るかを store へ渡す（Krisp の案内の判定に使う）。戻り値で後始末する */
export function watchVoiceChannel() {
    const update = () => store.getState().setDiscordInVc(SelectedChannelStore.getVoiceChannelId() != null);
    update();
    SelectedChannelStore.addChangeListener(update);
    return () => SelectedChannelStore.removeChangeListener(update);
}
