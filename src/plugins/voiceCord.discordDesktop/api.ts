/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// voicecord-module の src/preload/api.ts 由来。IPC のチャンネルの代わりに native の関数を呼び、
// main からの通知は nextEvents の long-poll で受け取る。
//
// デコードはここで行う。main から生ファイルを受け取り、Web Audio で mono / f32 にする。
// 試聴とラウドネス計測は 48kHz。注入用の PCM は既知の出力レートへ先に変換するが、
// 送るのは PCM 自身のレートで、hook が実際の 10ms フレームへ変換する。

import type { PluginNative } from "@utils/types";

import type { VoiceCordEvent, VoiceCordStatus } from "../../voicecord/shared/ipc";
import { measureSamples } from "../../voicecord/shared/loudness";
import type { Api, AttachResult, BuildKey, EngineEvent, InjectPlayReq, PlayReq, SourceStats } from "../../voicecord/shared/types";
import { type AudioDecoder, createOfflineDecoder, decodeToMono, isRawF32, PREVIEW_SAMPLE_RATE } from "./audio/decode";

export type VoiceCordNative = PluginNative<typeof import("./native")>;

// attach の結果が落ち着くまで待つ回数と間隔（合計 3 秒）
const ATTACH_SETTLE_TRIES = 20;
const ATTACH_SETTLE_INTERVAL_MS = 150;
// nextEvents が失敗したとき（エンジンの再起動中など）に間を空ける
const RETRY_MS = 1000;

export interface VoiceCordApi extends Api {
    getStatus(): Promise<VoiceCordStatus>;
    /** 戻り値を呼ぶと購読を解除する */
    onEvent(cb: (e: VoiceCordEvent) => void): () => void;
    /** 通知のループを止める。プラグインの stop() で呼ぶ */
    close(): void;
}

const rateFromFrame = (frameSamples: number | null | undefined) => {
    if (typeof frameSamples !== "number" || !Number.isInteger(frameSamples)) return null;
    const inferred = frameSamples * 100;
    return inferred >= 8000 && inferred <= 192000 ? inferred : null;
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export function createApi(native: VoiceCordNative, makeDecoder: (sampleRate: number) => AudioDecoder = createOfflineDecoder): VoiceCordApi {
    const listeners = new Set<(e: VoiceCordEvent) => void>();
    const dispatch = (e: VoiceCordEvent) => {
        for (const cb of listeners) {
            try {
                cb(e);
            } catch (err) {
                console.error("[VoiceCord] イベントの処理に失敗しました", err);
            }
        }
    };

    // 実測された注入レート。状態が届くまでは分からない
    let injectRate: number | null = null;
    // エンジンの再起動後に戻す、直前の送信マスター音量
    let master: number | null = null;
    let masterEnginePid: number | null = null;

    const onStatus = (s: VoiceCordStatus) => {
        injectRate = s.sampleRate ?? rateFromFrame(s.frameSamples);
        if (s.engine === "attached" && s.enginePid !== null && s.enginePid !== masterEnginePid) {
            masterEnginePid = s.enginePid;
            if (master !== null) native.setMaster(master).catch(() => undefined);
        }
    };

    let closed = false;
    (async () => {
        let cursor: number | null = null;
        while (!closed) {
            try {
                const r = await native.nextEvents(cursor);
                if (closed) break;
                if ("reset" in r) {
                    cursor = r.cursor;
                    // 取りこぼした分は状態ごと取り直す（ログは欠けてよい）
                    const status = await native.getStatus();
                    onStatus(status);
                    dispatch({ ev: "status", status });
                    continue;
                }
                cursor = r.cursor;
                for (const e of r.events) {
                    if (e.ev === "status") onStatus(e.status);
                    dispatch(e);
                }
            } catch {
                await sleep(RETRY_MS);
            }
        }
    })();

    // デコードする PCM のレート。未計測なら 48kHz の音源として送る（hook が実フレームへ変換する）
    const rateForInject = async () => {
        if (injectRate !== null) return injectRate;
        const s = await native.getStatus();
        return s.sampleRate ?? rateFromFrame(s.frameSamples) ?? PREVIEW_SAMPLE_RATE;
    };

    const pcmAt = async (soundPath: string, sampleRate: number) =>
        decodeToMono(await native.readSoundFile(soundPath), soundPath, makeDecoder(sampleRate));

    const pcmOf = (soundPath: string) => pcmAt(soundPath, PREVIEW_SAMPLE_RATE);

    const onEvent = (cb: (e: VoiceCordEvent) => void) => {
        listeners.add(cb);
        return () => void listeners.delete(cb);
    };

    return {
        getStatus: () => native.getStatus(),
        onEvent,
        close: () => {
            closed = true;
            listeners.clear();
        },

        getConfig: () => native.getConfig(),
        saveConfig: partial => native.saveConfig(partial),

        // 自分がどのビルドで動いているかは自明なので、今のビルドだけを返す
        listBuilds: async () => [(await native.getStatus()).discordBuild as BuildKey],

        // attach は自動。ここでは今の状態を読み、壊れているときだけ起こし直す
        // （無条件に再起動すると Ctrl+R のたびにエンジンが起き直し、数秒鳴らせなくなる）
        attach: async (): Promise<AttachResult> => {
            let s = await native.getStatus();
            if (s.engine === "failed") s = await native.reattach();
            for (let i = 0; i < ATTACH_SETTLE_TRIES && s.engine === "starting"; i++) {
                await sleep(ATTACH_SETTLE_INTERVAL_MS);
                s = await native.getStatus();
            }
            return {
                ok: s.engine !== "failed",
                pid: s.attachedPid,
                label: `${s.discordBuild} ${s.discordVersion}`,
                vcActive: s.engine === "attached" && s.vcActive === true
            };
        },
        detach: async () => void await native.detach(),

        scanFolder: folder => native.scanSoundFolder(folder),
        chooseFolder: () => native.chooseFolder(),
        fetchSoundboardSound: id => native.fetchSoundboardSound(id),

        getPcm: async soundPath => (await pcmOf(soundPath)).buffer as ArrayBuffer,

        play: async (req: PlayReq) => {
            // 生の .f32 は 48kHz mono で、デコーダを通らないのでレートのラベルも変えない
            const sampleRate = isRawF32(req.path) ? PREVIEW_SAMPLE_RATE : await rateForInject();
            const pcm = await pcmAt(req.path, sampleRate);
            // fp は更新日時とサイズなので、別フォルダの同名音源と衝突しないようパスも含める
            const fp = JSON.stringify([req.path, req.fp]);
            await native.preloadPcm(req.srcId, fp, sampleRate, pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer);
            const injectReq: InjectPlayReq = { ...req, fp, sampleRate };
            const voiceId = await native.play(injectReq);
            return typeof voiceId === "string" ? voiceId : null;
        },
        stop: vid => native.stop(vid),
        stopAll: () => native.stopAll(),
        setVoiceVolume: async (vid, vol) => void await native.setVoiceVolume(vid, vol),
        setMaster: async v => {
            master = v;
            await native.setMaster(v);
        },
        openGate: async guardMs => void await native.openGate(guardMs),

        calibStart: async (tag, frames) => void await native.calibStart(tag, frames),
        calibStop: async () => void await native.calibStop(),

        // 音源のラウドネス。声の計測と同じゲーティングで数える
        sourceStats: async (soundPath): Promise<SourceStats> => {
            const pcm = await pcmOf(soundPath);
            const m = measureSamples(pcm);
            const activeRatio = m.totalBlocks === 0 ? 0 : m.activeBlocks / m.totalBlocks;
            return { rms: m.rms, peak: m.peak, samples: pcm.length, activeRatio };
        },

        onEngineEvent: (cb: (p: EngineEvent) => void) => onEvent(e => {
            if (e.ev === "engine") cb(e.payload);
        })
    };
}
