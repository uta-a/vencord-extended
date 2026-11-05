/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PlusIcon } from "@components/Icons";
import { classes } from "@utils/misc";
import { Clickable, Tooltip, useEffect, useState } from "@webpack/common";
import type { KeyboardEvent, ReactNode, RefObject } from "react";

import { CategoryClasses, DiscordText, GuildIconClasses, PillClasses, SectionClasses } from "./discord";

// サウンドフォルダを、純正サウンドボードのサーバーと同じ見た目で並べる部品。
// 左のバー（頭文字のアイコン・選択中の印・末尾の追加）と、セクションの見出し（頭文字・名前・畳む矢印）

export const folderName = (folder: string) => folder.split(/[\\/]/).filter(s => s !== "").pop() ?? folder;

// 純正のアイコンの無いサーバーと同じく、語の頭文字を並べる（空白で区切った語、最大 3 文字）
export function folderAcronym(folder: string) {
    return folderName(folder).split(/\s+/).filter(Boolean).map(w => [...w][0]).join("").slice(0, 3).toUpperCase();
}

// 純正と同じ角の丸い四角（Discord が文書に置いている svg-mask-squircle で切り抜く）
function FolderIcon({ folder, size }: { folder: string; size: number; }) {
    return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={GuildIconClasses.mask} aria-hidden="true">
            <foreignObject x={0} y={0} width={size} height={size} overflow="visible" mask="url(#svg-mask-squircle)">
                <div className={classes(GuildIconClasses.guildIcon, GuildIconClasses.guildIconWithoutImage)}>
                    <div className={GuildIconClasses.guildAcronym}>{folderAcronym(folder)}</div>
                </div>
            </foreignObject>
        </svg>
    );
}

const ChevronDown = () => <svg className={SectionClasses.headerIcon} aria-hidden="true" width="24" height="24" fill="none" viewBox="0 0 24 24"><path fill="currentColor" d="M5.3 9.3a1 1 0 0 1 1.4 0l5.3 5.29 5.3-5.3a1 1 0 1 1 1.4 1.42l-6 6a1 1 0 0 1-1.4 0l-6-6a1 1 0 0 1 0-1.42Z" /></svg>;
const ChevronRight = () => <svg className={SectionClasses.headerIcon} aria-hidden="true" width="24" height="24" fill="none" viewBox="0 0 24 24"><path fill="currentColor" d="M9.3 5.3a1 1 0 0 0 0 1.4l5.29 5.3-5.3 5.3a1 1 0 1 0 1.42 1.4l6-6a1 1 0 0 0 0-1.4l-6-6a1 1 0 0 0-1.42 0Z" /></svg>;

const onEnterOrSpace = (fn: () => void) => (e: KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    fn();
};

/** セクションの見出し。押すと畳む・開く（純正と同じ） */
export function FolderHeader({ folder, collapsed, onToggle, accessory }: {
    folder: string;
    collapsed: boolean;
    onToggle: () => void;
    accessory?: ReactNode;
}) {
    return (
        <div className={SectionClasses.sectionContainer}>
            <div
                className={classes(SectionClasses.sectionHeader, "vc-voicecord-section-header")}
                role="button"
                tabIndex={0}
                aria-expanded={!collapsed}
                title={folder}
                onClick={onToggle}
                onKeyDown={onEnterOrSpace(onToggle)}
            >
                <div className={SectionClasses.sectionHeaderContent}>
                    <FolderIcon folder={folder} size={16} />
                    <DiscordText variant="body-sm/semibold" tag="h1" className={SectionClasses.sectionTitle}>{folderName(folder)}</DiscordText>
                    {collapsed ? <ChevronRight /> : <ChevronDown />}
                </div>
                <span className="vc-voicecord-grow" />
                {accessory}
            </div>
        </div>
    );
}

function Pill({ selected }: { selected: boolean; }) {
    return (
        <div className={CategoryClasses.categoryPill}>
            <div className={classes(PillClasses.wrapper, PillClasses.small)} aria-hidden="true">
                <span className={classes(PillClasses.item, selected && PillClasses.visible, selected && PillClasses.selected)} />
            </div>
        </div>
    );
}

/** 左のバー。フォルダの頭文字を並べ、押すとそのセクションへ移る。末尾の「＋」でフォルダを足す */
export function FolderBar({ folders, active, onJump, onAdd }: {
    folders: string[];
    active: string | null;
    onJump: (folder: string) => void;
    onAdd: () => void;
}) {
    return (
        <nav className="vc-voicecord-folderbar" aria-label="サウンドフォルダ">
            <div role="list" className="vc-voicecord-folderbar-list">
                {folders.map(folder => (
                    <Tooltip key={folder} text={folderName(folder)} position="right">
                        {p => (
                            <Clickable
                                {...p}
                                role="listitem"
                                tabIndex={0}
                                aria-label={folderName(folder)}
                                aria-current={active === folder ? "true" : undefined}
                                className={CategoryClasses.category}
                                onClick={() => onJump(folder)}
                            >
                                <Pill selected={active === folder} />
                                <FolderIcon folder={folder} size={32} />
                            </Clickable>
                        )}
                    </Tooltip>
                ))}
                <Tooltip text="サウンドフォルダを追加" position="right">
                    {p => (
                        <Clickable
                            {...p}
                            role="listitem"
                            tabIndex={0}
                            aria-label="サウンドフォルダを追加"
                            className={classes(CategoryClasses.categoryIcon, CategoryClasses.category)}
                            onClick={onAdd}
                        >
                            <PlusIcon className={CategoryClasses.categoryIconIcon} />
                        </Clickable>
                    )}
                </Tooltip>
            </div>
        </nav>
    );
}

// 縦にスクロールする最も近い祖先。ScrollerThin は中で要素を重ねるので、DOM から探す
function scrollParent(el: HTMLElement | null): HTMLElement | null {
    for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
        const { overflowY } = getComputedStyle(p);
        if (overflowY === "auto" || overflowY === "scroll") return p;
    }
    return null;
}

/**
 * 一覧のスクロールに合わせて、いま見えているセクション（上端を過ぎた最後のもの）を返す。
 * jump はそのセクションの先頭へスクロールする。sections は data-folder 属性を持つ要素
 */
export function useFolderScroll(contentRef: RefObject<HTMLElement | null>, folders: string[]) {
    const [active, setActive] = useState<string | null>(folders[0] ?? null);

    const sectionEls = () => [...(contentRef.current?.querySelectorAll<HTMLElement>("[data-folder]") ?? [])];

    useEffect(() => {
        const scroller = scrollParent(contentRef.current);
        if (!scroller) return;
        const update = () => {
            const { top } = scroller.getBoundingClientRect();
            let current: string | null = folders[0] ?? null;
            for (const el of sectionEls()) {
                if (el.getBoundingClientRect().top - top <= 4) current = el.dataset.folder ?? current;
            }
            setActive(current);
        };
        update();
        scroller.addEventListener("scroll", update, { passive: true });
        return () => scroller.removeEventListener("scroll", update);
    }, [folders.join("\0")]);

    const jump = (folder: string) => {
        const scroller = scrollParent(contentRef.current);
        const el = sectionEls().find(e => e.dataset.folder === folder);
        if (!scroller || !el) return;
        scroller.scrollTo({ top: el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop });
        setActive(folder);
    };

    return { active, jump };
}
