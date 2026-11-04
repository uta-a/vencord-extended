/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";

import { nextPlaying, nextVcActive } from "../../src/plugins/voiceCord.discordDesktop/native/vcStatus";
import type { VoiceCordEvent } from "../../src/voicecord/shared/ipc";

const engine = (payload: Record<string, unknown>) => ({ ev: "engine", payload }) as VoiceCordEvent;

describe("nextPlaying", () => {
    it("再生が終わった・断られた音は一覧から外す", () => {
        expect(nextPlaying(["a", "b"], engine({ ev: "voiceEnded", voiceId: "a" }))).toEqual(["b"]);
        expect(nextPlaying(["a", "b"], engine({ ev: "playRejected", voiceId: "b" }))).toEqual(["a"]);
    });

    it("hook が消えたら全部外す（voiceEnded は二度と来ない）", () => {
        expect(nextPlaying(["a"], engine({ ev: "detached" }))).toEqual([]);
        expect(nextPlaying(["a"], engine({ ev: "engineLost" }))).toEqual([]);
    });

    it("関係の無いイベントでは変えない（同じ配列を返す）", () => {
        const prev = ["a"];
        expect(nextPlaying(prev, engine({ ev: "vc", active: true }))).toBe(prev);
        expect(nextPlaying(prev, { ev: "log", level: "info", message: "x" })).toBe(prev);
    });
});

describe("nextVcActive", () => {
    it("vc の通知で在席を更新し、hook が消えたら外す", () => {
        expect(nextVcActive(false, engine({ ev: "vc", active: true }))).toBe(true);
        expect(nextVcActive(true, engine({ ev: "detached" }))).toBe(false);
    });
});
