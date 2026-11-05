/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findComponentByCodeLazy, findCssClassesLazy, findLazy } from "@webpack";
import type { ComponentType, ReactNode } from "react";

// Discord 自身の部品。見た目を純正の音声パネルとサウンドボードにそろえるため、自前の部品は作らない

type DiscordButtonProps = Record<string, unknown> & { children?: ReactNode; };
type DiscordButtonType = ComponentType<DiscordButtonProps> & {
    Sizes: Record<"NONE" | "TINY" | "SMALL" | "MEDIUM" | "LARGE" | "ICON", string>;
    Colors: Record<"BRAND" | "RED" | "GREEN" | "PRIMARY" | "TRANSPARENT", string>;
    Looks: Record<"FILLED" | "OUTLINED" | "LINK" | "BLANK", string>;
};

// 純正の音声パネルのボタンが使っている Button（Looks / Colors / Sizes を持つもの）
export const DiscordButton: DiscordButtonType = findLazy(m => m?.Looks?.FILLED && m?.Sizes?.MEDIUM && m?.Colors?.BRAND);

export const DiscordText: ComponentType<{
    variant: string;
    tag?: string;
    className?: string;
    lineClamp?: number;
    children?: ReactNode;
}> = findComponentByCodeLazy("tabularNumbers:", "selectable:");

// 純正サウンドボードの検索欄と同じ SearchBar（虫眼鏡付き。onClear を渡すとクリアボタンが出る）
export const DiscordSearchBar: ComponentType<{
    query: string;
    onChange: (query: string) => void;
    onClear?: () => void;
    placeholder?: string;
    autoFocus?: boolean;
    size?: "sm" | "md";
    "aria-label"?: string;
}> = findComponentByCodeLazy('role:"searchbox"', "clearable:null!=");

// CSS モジュールは書き出しのキーが短縮されているので、クラス名の接頭辞で引く
export const PanelClasses = findCssClassesLazy("voiceUsers", "actionButtons", "button", "buttonColor", "buttonContents", "buttonIcon", "greyButtonActive");
export const PickerClasses = findCssClassesLazy("picker", "inExpressionPicker");
// 絵文字ピッカー（GIF・スタンプ・絵文字・サウンドボード）のタブ
export const TabClasses = findCssClassesLazy("nav", "navList", "navItem", "navButton", "navButtonActive", "soundboardContainer");
export const SectionClasses = findCssClassesLazy("sectionContainer", "sectionHeader", "sectionHeaderContent", "sectionTitle", "soundRow", "headerIcon");
// 純正サウンドボードの左のバー（サーバーごとのカテゴリ）。バーの項目、選択中の印（ピル）、サーバーのアイコン（頭文字）
export const CategoryClasses = findCssClassesLazy("categoryList", "category", "categoryPill", "categoryIcon", "categoryIconIcon", "selected");
export const PillClasses = findCssClassesLazy("wrapper", "small", "item", "visible", "selected", "hovered");
export const GuildIconClasses = findCssClassesLazy("guildIcon", "guildIconWithoutImage", "guildAcronym", "mask");
export const SoundClasses = findCssClassesLazy(
    "soundButtonWrapper", "soundButton", "soundButtonInteractive", "playing", "soundInfo", "soundName",
    "buttonOverlay", "buttonOverlayBackground", "buttonOverlayActions", "secondaryButton", "secondaryIcon", "primaryIcon"
);
