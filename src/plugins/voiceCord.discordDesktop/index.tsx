/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import definePlugin, { type PluginNative } from "@utils/types";

import type { SoundItem } from "../../voicecord/shared/types";
import { createOfflineDecoder, decodeToMono, PREVIEW_SAMPLE_RATE } from "./audio/decode";

const Native = VencordNative.pluginHelpers.VoiceCord as PluginNative<typeof import("./native")>;
const logger = new Logger("VoiceCord");

/**
 * 音源をデコードしてエンジンへ送り、再生する。
 *
 * PCM は注入先の実測レート（hook が測った sampleRate）へ先に変換する。
 * まだ測れていなければ 48kHz で作り、そのレートを添えて送る（hook が実フレームへ変換する）。
 */
async function decodeAndPlay(item: SoundItem, vol = 1) {
    const status = await Native.getStatus();
    const sampleRate = status.sampleRate ?? PREVIEW_SAMPLE_RATE;
    const bytes = await Native.readSoundFile(item.path);
    const pcm = await decodeToMono(bytes, item.name, createOfflineDecoder(sampleRate));
    // Float32Array の buffer がちょうどこの PCM だけを指すように切り出して送る
    const buf = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer;
    await Native.preloadPcm(item.id, item.fp, sampleRate, buf);
    return Native.play({ srcId: item.id, path: item.path, fp: item.fp, vol, sampleRate });
}

export default definePlugin({
    name: "VoiceCord",
    description: "ボイスチャンネルにサウンドを流し込みます（Windows の Discord デスクトップ版のみ）",
    // 作者一覧は src/utils/constants.ts の Devs からしか引けない。upstream と衝突しやすい Devs には足さず、空にしておく
    authors: [],
    enabledByDefault: true,

    async start() {
        try {
            const status = await Native.ensureStarted();
            logger.info("起動しました", status);
        } catch (e) {
            logger.error("起動できませんでした", e);
        }
    },

    async stop() {
        try {
            await Native.shutdown();
        } catch (e) {
            logger.error("停止できませんでした", e);
        }
    },

    /**
     * M1 の確認用。UI ができるまでは DevTools から呼ぶ:
     *   const vc = Vencord.Plugins.plugins.VoiceCord
     *   await vc.debug.status()
     *   await vc.debug.list()
     *   await vc.debug.play(0)
     *   await vc.debug.stopAll()
     */
    debug: {
        status: () => Native.getStatus(),
        list: () => Native.scanSoundFolder(),
        async play(indexOrName: number | string, vol = 1) {
            const items = await Native.scanSoundFolder();
            const item = typeof indexOrName === "number"
                ? items[indexOrName]
                : items.find(i => i.name === indexOrName);
            if (!item) throw new Error(`音源が見つかりません: ${indexOrName}（debug.list() で一覧を確認してください）`);
            return decodeAndPlay(item, vol);
        },
        stopAll: () => Native.stopAll()
    }
});
