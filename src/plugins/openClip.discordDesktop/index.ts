/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { findByCodeLazy } from "@webpack";
import { FluxDispatcher, showToast } from "@webpack/common";

import type * as NativeTypes from "./native";

const Native = VencordNative.pluginHelpers.OpenClip as PluginNative<typeof NativeTypes>;

const logger = new Logger("OpenClip");

const settings = definePluginSettings({
    forceEnable: {
        type: OptionType.BOOLEAN,
        description: "Turn the Clips setting on at startup (Discord would otherwise only allow this for Nitro users)",
        default: true,
        restartNeeded: false
    },
    clipAnyone: {
        type: OptionType.BOOLEAN,
        description: "Allow taking clips of other users' streams even when they don't have Nitro",
        default: false,
        restartNeeded: false
    },
    compressOnShare: {
        type: OptionType.BOOLEAN,
        description: "When sharing a clip that exceeds the channel's upload limit, re-encode it with ffmpeg to fit",
        default: true,
        restartNeeded: false
    },
    sendAsPlainVideo: {
        type: OptionType.BOOLEAN,
        description: "Send shared clips as plain video attachments. Discord's server rejects clip-typed uploads without Nitro (error \"invalid clip\")",
        default: true,
        restartNeeded: false
    },
    ffmpegPath: {
        type: OptionType.STRING,
        description: "Path to the ffmpeg binary used to compress shared clips",
        default: "ffmpeg",
        restartNeeded: false
    }
});

// Module computing the per-guild/per-user max upload size (getUserMaxFileSize + guild feature limits)
const UploadUtils = findByCodeLazy("getUserMaxFileSize", "uploadSumTooLarge");
const DEFAULT_LIMIT_BYTES = 10 * 1024 * 1024;

function getMaxUploadBytes(guildId: string | null) {
    try {
        for (const key of Object.keys(UploadUtils)) {
            const fn = (UploadUtils as Record<string, unknown>)[key];
            if (typeof fn === "function" && fn.toString().includes("getUserMaxFileSize")) {
                const limit = (fn as (guildId: string | null) => number)(guildId);
                if (typeof limit === "number" && limit > 0) return limit;
            }
        }
    } catch (err) {
        logger.error("Failed to resolve upload limit", err);
    }
    return DEFAULT_LIMIT_BYTES;
}

function enableClips() {
    if (!settings.store.forceEnable) return;
    FluxDispatcher.dispatch({
        type: "CLIPS_SETTINGS_UPDATE",
        settings: { clipsEnabled: true }
    });
}

export default definePlugin({
    name: "OpenClip",
    description: "Unlocks Discord's Clips (game clip recording) without Nitro, and compresses shared clips to fit the upload limit",
    authors: [],
    settings,

    patches: [
        {
            // Clips eligibility gate module: isPremiumAtLeast(premiumType, TIER_2) is the
            // Nitro check behind every Clips gate (useClipsEligibility, canUseClips, ...)
            find: /clips_ignore_platform_requirement.{0,300}?isPremiumAtLeast/,
            replacement: {
                match: /\i\.\i\.isPremiumAtLeast\(\i\?\.premiumType,\i\.PremiumTypes\.TIER_2\)/,
                replace: "!0"
            }
        },
        {
            // ClipsSettingsStore: isClipsEnabledForUser reports other users' Nitro flags
            // received via RTC_CONNECTION_FLAGS; force it so any stream can be clipped
            find: /isVoiceRecordingAllowedForUser\(e\)\{return \i\[e\]\?\.allowVoiceRecording\?\?!1\}/,
            predicate: () => settings.store.clipAnyone,
            replacement: {
                match: /isClipsEnabledForUser\(e\)\{return \i\[e\]\?\.clipsEnabled\?\?!1\}/,
                replace: "isClipsEnabledForUser(e){return!0}"
            }
        },
        {
            // Clip share flow: files are handed to the upload handler together with the
            // target channel and clip metadata; intercept to compress oversized clips
            // and strip clip metadata the server would reject
            find: 'origin:"unknown:clip_share"',
            predicate: () => settings.store.compressOnShare || settings.store.sendAsPlainVideo,
            replacement: {
                match: /\(0,(\i)\.R\)\((\i),(\i),(\i)\.C\.ChannelMessage,\{filesMetadata:(\i),origin:"unknown:clip_share"\}\)/,
                replace: '(0,$1.R)(await $self.compressClips($2,$3,$5),$3,$4.C.ChannelMessage,{filesMetadata:$5,origin:"unknown:clip_share"})'
            }
        }
    ],

    // filesMetadata is mutated in place: entries of stripped/compressed clips are
    // replaced before the share call reads it
    async compressClips(files: File[], channel: { guild_id?: string; } | null, filesMetadata?: unknown[]) {
        if (settings.store.sendAsPlainVideo && filesMetadata) {
            for (let i = 0; i < files.length; i++) {
                if (files[i].type.startsWith("video/") && (filesMetadata[i] as { clip?: unknown; } | undefined)?.clip != null) {
                    filesMetadata[i] = {};
                }
            }
        }

        if (!settings.store.compressOnShare) return files;
        const target = Math.floor(getMaxUploadBytes(channel?.guild_id ?? null) * 0.9);

        return Promise.all(files.map(async file => {
            if (!file.type.startsWith("video/") || file.size <= target) return file;

            showToast({
                text: `OpenClip: compressing ${file.name} (${(file.size / 1048576).toFixed(1)} MB) to fit the ${Math.floor(target / 1048576)} MB upload limit...`
            });
            try {
                const compressed = await Native.compressVideo(settings.store.ffmpegPath, await file.arrayBuffer(), target);
                if (compressed.byteLength > 0 && compressed.byteLength < file.size) {
                    showToast({
                        text: `OpenClip: clip compressed to ${(compressed.byteLength / 1048576).toFixed(1)} MB`,
                        variant: "success"
                    });
                    return new File([compressed], file.name, { type: "video/mp4" });
                }
            } catch (err) {
                logger.error("Failed to compress clip", err);
                showToast({
                    text: `OpenClip: compression failed (${err instanceof Error ? err.message : String(err)}). Sending the original clip.`,
                    variant: "critical"
                });
            }
            return file;
        }));
    },

    start() {
        enableClips();
    },

    flux: {
        CONNECTION_OPEN: enableClips,
        CLIPS_APPLY_DEFAULT_SETTINGS: enableClips
    }
});
