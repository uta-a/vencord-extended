/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { ReactNode } from "react";

// lucide のアイコン（ISC License）。Vencord の @components/Icons に無いものだけを持つ
interface IconProps {
    className?: string;
    size?: number;
}

function Lucide({ className, size = 16, children }: IconProps & { children: ReactNode; }) {
    return (
        <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {children}
        </svg>
    );
}

// audio-lines
export const SoundIcon = (p: IconProps) => <Lucide size={20} {...p}><path d="M2 10v3" /><path d="M6 6v11" /><path d="M10 3v18" /><path d="M14 8v7" /><path d="M18 5v13" /><path d="M22 10v3" /></Lucide>;
export const PlayIcon = (p: IconProps) => <Lucide {...p}><polygon points="6 3 20 12 6 21 6 3" fill="currentColor" /></Lucide>;
export const StopIcon = (p: IconProps) => <Lucide {...p}><rect width="14" height="14" x="5" y="5" rx="2" /></Lucide>;
export const HeadphonesIcon = (p: IconProps) => <Lucide {...p}><path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3" /></Lucide>;
export const SlidersIcon = (p: IconProps) => <Lucide {...p}><path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4" /></Lucide>;
export const CheckIcon = (p: IconProps) => <Lucide {...p}><path d="M20 6 9 17l-5-5" /></Lucide>;
export const XIcon = (p: IconProps) => <Lucide {...p}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></Lucide>;
export const WarningIcon = (p: IconProps) => <Lucide {...p}><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" /></Lucide>;
export const BackIcon = (p: IconProps) => <Lucide {...p}><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></Lucide>;
export const GaugeIcon = (p: IconProps) => <Lucide {...p}><path d="m12 14 4-4" /><path d="M3.34 19a10 10 0 1 1 17.32 0" /></Lucide>;
export const VolumeIcon = (p: IconProps) => <Lucide {...p}><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /></Lucide>;
export const ArrowRightIcon = (p: IconProps) => <Lucide {...p}><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></Lucide>;
