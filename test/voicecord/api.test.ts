/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it, vi } from "vitest";

import { createApi, type VoiceCordNative } from "../../src/plugins/voiceCord.discordDesktop/api";
import type { VoiceCordEvent, VoiceCordStatus } from "../../src/voicecord/shared/ipc";

const status = (over: Partial<VoiceCordStatus> = {}) => ({ engine: "searching", sampleRate: null, frameSamples: null, enginePid: 1, playing: [], ...over }) as VoiceCordStatus;

// nextEvents の応答を順番に返す偽の native。並べた応答を返し切ったら、それ以降は返さない（待ち続ける）
function fakeNative(responses: unknown[], current = status()) {
    const calls: (number | null)[] = [];
    const native = {
        getStatus: vi.fn(async () => current),
        setMaster: vi.fn(async () => undefined),
        nextEvents: vi.fn((cursor: number | null) => {
            calls.push(cursor);
            const r = responses.shift();
            return r === undefined ? new Promise(() => { }) : r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
        })
    };
    return { native: native as unknown as VoiceCordNative, raw: native, calls };
}

const flush = () => new Promise(r => setTimeout(r, 0));

describe("createApi の通知ループ", () => {
    it("reset を受けたら状態を取り直して status として流し、返された cursor から続ける", async () => {
        const { native, raw, calls } = fakeNative([{ reset: true, cursor: 7 }]);
        const api = createApi(native);
        const got: VoiceCordEvent[] = [];
        api.onEvent(e => got.push(e));
        await flush();
        expect(raw.getStatus).toHaveBeenCalled();
        expect(got).toEqual([{ ev: "status", status: status() }]);
        expect(calls).toEqual([null, 7]);
        api.close();
    });

    it("届いたイベントを順に流し、最後の cursor で次を取りに行く", async () => {
        const events = [{ ev: "log", level: "info", message: "a" }, { ev: "engine", payload: { ev: "vc", active: true } }];
        const { native, calls } = fakeNative([{ reset: true, cursor: 0 }, { cursor: 2, events }]);
        const api = createApi(native);
        const got: VoiceCordEvent[] = [];
        const engine: unknown[] = [];
        api.onEvent(e => got.push(e));
        api.onEngineEvent(p => engine.push(p));
        await flush();
        expect(got.slice(1)).toEqual(events);
        expect(engine).toEqual([{ ev: "vc", active: true }]);
        expect(calls).toEqual([null, 0, 2]);
        api.close();
    });

    it("エンジンが起き直したら、直前の送信マスター音量を戻す", async () => {
        const { native, raw } = fakeNative([
            { reset: true, cursor: 0 },
            { cursor: 1, events: [{ ev: "status", status: status({ engine: "attached", enginePid: 2 }) }] }
        ]);
        const api = createApi(native);
        await api.setMaster(2.5);
        raw.setMaster.mockClear();
        await flush();
        expect(raw.setMaster).toHaveBeenCalledWith(2.5);
        api.close();
    });

    it("reset の後の取り直しに失敗したら、成功するまで reset からやり直す", async () => {
        vi.useFakeTimers();
        try {
            const { native, raw, calls } = fakeNative([{ reset: true, cursor: 7 }, { reset: true, cursor: 7 }]);
            raw.getStatus.mockRejectedValueOnce(new Error("一時的な失敗"));
            const api = createApi(native);
            const got: VoiceCordEvent[] = [];
            api.onEvent(e => got.push(e));
            await vi.advanceTimersByTimeAsync(1000);
            expect(raw.getStatus).toHaveBeenCalledTimes(2);
            expect(got).toEqual([{ ev: "status", status: status() }]);
            // 失敗した回は cursor を進めないので、次も null から取りに行く
            expect(calls).toEqual([null, null, 7]);
            api.close();
        } finally {
            vi.useRealTimers();
        }
    });

    it("状態の取り直しを待つ間に close したら、音量の復元もイベントも起こさない", async () => {
        let resolveStatus: (s: VoiceCordStatus) => void = () => { };
        const { native, raw } = fakeNative([{ reset: true, cursor: 0 }]);
        raw.getStatus.mockImplementationOnce(() => new Promise(r => { resolveStatus = r; }));
        const api = createApi(native);
        await api.setMaster(2);
        raw.setMaster.mockClear();
        const got: VoiceCordEvent[] = [];
        api.onEvent(e => got.push(e));
        await flush();
        api.close();
        resolveStatus(status({ engine: "attached", enginePid: 9 }));
        await flush();
        expect(raw.setMaster).not.toHaveBeenCalled();
        expect(got).toEqual([]);
    });

    it("close の後はイベントを流さない", async () => {
        let resolve: (v: unknown) => void = () => { };
        const native = {
            getStatus: async () => status(),
            nextEvents: vi.fn(() => new Promise(r => { resolve = r; }))
        } as unknown as VoiceCordNative;
        const api = createApi(native);
        const got: VoiceCordEvent[] = [];
        api.onEvent(e => got.push(e));
        api.close();
        resolve({ cursor: 1, events: [{ ev: "log", level: "info", message: "x" }] });
        await flush();
        expect(got).toEqual([]);
    });
});
