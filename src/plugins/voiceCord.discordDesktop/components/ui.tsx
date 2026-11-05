/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Switch } from "@components/Switch";
import { meterRatio } from "@plugins/voiceCord.discordDesktop/lib/db";
import { classes } from "@utils/misc";
import { Slider as DiscordSlider, useRef } from "@webpack/common";
import type { MouseEvent, ReactNode } from "react";

import { DiscordButton, DiscordText } from "./discord";
import { CheckIcon, WarningIcon, XIcon } from "./icons";

// 移植元の shadcn / Radix の部品を、Discord の部品で置き換えるための薄い包み

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "sm" | "md" | "icon";

export function Btn({ variant = "primary", size = "md", className, children, disabled, onClick, label, grow }: {
    variant?: Variant;
    size?: Size;
    className?: string;
    children?: ReactNode;
    disabled?: boolean;
    onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
    label?: string;
    grow?: boolean;
}) {
    const color = variant === "danger" ? DiscordButton.Colors.RED : variant === "primary" ? DiscordButton.Colors.BRAND : variant === "ghost" ? DiscordButton.Colors.TRANSPARENT : DiscordButton.Colors.PRIMARY;
    return (
        <DiscordButton
            color={color}
            look={variant === "ghost" ? DiscordButton.Looks.BLANK : DiscordButton.Looks.FILLED}
            size={size === "sm" ? DiscordButton.Sizes.SMALL : size === "icon" ? DiscordButton.Sizes.ICON : DiscordButton.Sizes.MEDIUM}
            className={className}
            innerClassName="vc-voicecord-btn-inner"
            disabled={disabled}
            onClick={onClick}
            aria-label={label}
            fullWidth={grow}
            grow={grow}
        >
            {children}
        </DiscordButton>
    );
}

// Discord の Slider は内部で値を持つ。外から値が変わったとき（ドラッグ以外の操作）だけ作り直して追従させる
export function VSlider({ value, min, max, step = 1, onChange, onCommit, label, render, markers, className, compact }: {
    value: number;
    min: number;
    max: number;
    step?: number;
    onChange?: (v: number) => void;
    onCommit?: (v: number) => void;
    label: string;
    render?: (v: number) => string;
    markers?: number[];
    className?: string;
    // 目盛りの数字を出さず、高さを詰める（目盛りの線は残す）。狭い帯に置くとき用
    compact?: boolean;
}) {
    const last = useRef(value);
    const generation = useRef(0);
    // dB と線形の変換を往復すると微小な誤差が出る（0.5 → 0.5000000000000004）。それを外からの更新と取り違えると、
    // ドラッグ中に作り直されて掴んだつまみが外れるので、刻みより十分小さい差は同じ値と見なす
    if (Math.abs(value - last.current) > step / 1000) {
        generation.current++;
        last.current = value;
    }
    const snap = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step));
    const format = (v: number) => render ? render(snap(v)) : String(snap(v));
    // Discord の Slider は markers の両端を範囲として描くので、下限と上限を必ず含める
    const allMarkers = [...new Set([min, ...(markers ?? []), max])].sort((a, b) => a - b);
    return (
        <div className={classes("vc-voicecord-slider", compact && "vc-voicecord-slider-compact", className)} aria-label={label}>
            <DiscordSlider
                key={generation.current}
                initialValue={value}
                minValue={min}
                maxValue={max}
                markers={allMarkers}
                onMarkerRender={format}
                stickToMarkers={false}
                onValueRender={format}
                asValueChanges={v => {
                    last.current = snap(v);
                    onChange?.(snap(v));
                }}
                onValueChange={v => {
                    last.current = snap(v);
                    (onCommit ?? onChange)?.(snap(v));
                }}
            />
        </div>
    );
}

export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; }) {
    return <Switch checked={checked} onChange={onChange} disabled={disabled} />;
}

// 設定の 1 行。左に名前と説明、右に操作。横幅が要る操作（スライダー）は children として下段に置く
export function Row({ label, description, control, children }: {
    label: ReactNode;
    description?: ReactNode;
    control?: ReactNode;
    children?: ReactNode;
}) {
    return (
        <div className="vc-voicecord-row">
            <div className="vc-voicecord-row-main">
                <div className="vc-voicecord-row-text">
                    <DiscordText variant="body-md/medium">{label}</DiscordText>
                    {description && <DiscordText variant="body-sm/normal" className="vc-voicecord-muted">{description}</DiscordText>}
                </div>
                {control && <div className="vc-voicecord-row-control">{control}</div>}
            </div>
            {children && <div className="vc-voicecord-row-extra">{children}</div>}
        </div>
    );
}

export function SectionTitle({ children }: { children: ReactNode; }) {
    return <DiscordText variant="body-xs/semibold" tag="h3" className="vc-voicecord-section-title">{children}</DiscordText>;
}

export function Card({ children, className }: { children: ReactNode; className?: string; }) {
    return <div className={classes("vc-voicecord-card", className)}>{children}</div>;
}

export function Notice({ tone, children }: { tone: "warning" | "danger"; children: ReactNode; }) {
    return (
        <div className={classes("vc-voicecord-notice", `vc-voicecord-notice-${tone}`)}>
            <WarningIcon className="vc-voicecord-notice-icon" />
            <DiscordText variant="body-sm/normal">{children}</DiscordText>
        </div>
    );
}

export function Small({ children, className }: { children: ReactNode; className?: string; }) {
    return <DiscordText variant="body-xs/normal" className={classes("vc-voicecord-muted", className)}>{children}</DiscordText>;
}

export function Mono({ children, className }: { children: ReactNode; className?: string; }) {
    return <span className={classes("vc-voicecord-mono", className)}>{children}</span>;
}

// 読み取り専用のレベルメーター。-60..0 dBFS を 0..100% に線形で写す
export function LevelMeter({ value, label, hot, format }: { value: number; label: string; hot?: boolean; format: (v: number) => string; }) {
    return (
        <div>
            <div className="vc-voicecord-spread">
                <Small>{label}</Small>
                <Small><Mono>{format(value)}</Mono></Small>
            </div>
            <div className="vc-voicecord-meter">
                <div className={classes("vc-voicecord-meter-fill", hot && "vc-voicecord-meter-hot")} style={{ width: `${meterRatio(value) * 100}%` }} />
            </div>
        </div>
    );
}

export function Progress({ ratio }: { ratio: number; }) {
    return (
        <div className="vc-voicecord-meter vc-voicecord-meter-thin">
            <div className="vc-voicecord-meter-fill" style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%` }} />
        </div>
    );
}

export function CheckRow({ ok, children }: { ok: boolean; children: ReactNode; }) {
    return (
        <div className="vc-voicecord-check">
            {ok ? <CheckIcon className="vc-voicecord-ok" /> : <XIcon className="vc-voicecord-ng" />}
            <DiscordText variant="body-sm/normal" className={ok ? undefined : "vc-voicecord-muted"}>{children}</DiscordText>
        </div>
    );
}
