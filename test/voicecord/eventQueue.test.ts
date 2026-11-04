/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEventQueue } from "../../src/plugins/voiceCord.discordDesktop/native/eventQueue";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const queue = (max = 3) => createEventQueue<string>({ max, waitMs: 1000 });

describe("eventQueue", () => {
    it("最初の呼び出し（cursor なし）は reset と今の cursor を返す", async () => {
        const q = queue();
        q.push("a");
        await expect(q.next(null)).resolves.toEqual({ reset: true, cursor: 1 });
    });

    it("cursor より新しいイベントがあれば即座に返す", async () => {
        const q = queue();
        q.push("a");
        q.push("b");
        await expect(q.next(1)).resolves.toEqual({ cursor: 2, events: ["b"] });
    });

    it("新しいイベントが無ければ、来るまで待つ", async () => {
        const q = queue();
        const p = q.next(0);
        q.push("a");
        await expect(p).resolves.toEqual({ cursor: 1, events: ["a"] });
    });

    it("待っている要求が複数あれば全部に配る", async () => {
        const q = queue();
        const p1 = q.next(0);
        const p2 = q.next(0);
        q.push("a");
        await expect(p1).resolves.toEqual({ cursor: 1, events: ["a"] });
        await expect(p2).resolves.toEqual({ cursor: 1, events: ["a"] });
    });

    it("待ち時間を過ぎたら空で返し、永久に保留しない", async () => {
        const q = queue();
        const p = q.next(0);
        vi.advanceTimersByTime(1000);
        await expect(p).resolves.toEqual({ cursor: 0, events: [] });
        expect(q.pending()).toBe(0);
    });

    it("cursor がバッファからあふれていたら reset を返す", async () => {
        const q = queue(3);
        for (const e of ["a", "b", "c", "d", "e"]) q.push(e);
        // 残っているのは c, d, e（連番 3〜5）。2 以降が欲しい要求には応えられない
        await expect(q.next(1)).resolves.toEqual({ reset: true, cursor: 5 });
        await expect(q.next(2)).resolves.toEqual({ cursor: 5, events: ["c", "d", "e"] });
    });

    it("cursor が未来を指していたら（main の再起動後など）reset を返す", async () => {
        const q = queue();
        q.push("a");
        await expect(q.next(10)).resolves.toEqual({ reset: true, cursor: 1 });
    });

    it("相手が消えたら待ちを解いて片付ける", async () => {
        const q = queue();
        let gone: () => void = () => { };
        const p = q.next(0, cb => { gone = cb; });
        expect(q.pending()).toBe(1);
        gone();
        await expect(p).resolves.toEqual({ cursor: 0, events: [] });
        expect(q.pending()).toBe(0);
    });

    it("cursor が数値でなければ最初の呼び出しとして扱う", async () => {
        const q = queue();
        await expect(q.next("x" as unknown as number)).resolves.toEqual({ reset: true, cursor: 0 });
    });
});
