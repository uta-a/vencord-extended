/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// main から renderer への通知を long-poll で運ぶ。プラグインの native は invoke 専用なので、
// renderer の next(cursor) をイベントが来るまで保留して push の代わりにする。

export type NextResult<T> =
    | { cursor: number; events: T[]; }
    | { reset: true; cursor: number; };

export interface EventQueueOptions {
    /** 保持するイベント数。あふれた古いものは捨て、追いつけない cursor には reset を返す */
    max: number;
    /** 新しいイベントが来ないとき、空で返すまでの時間 */
    waitMs: number;
}

export function createEventQueue<T>({ max, waitMs }: EventQueueOptions) {
    const buffer: { seq: number; event: T; }[] = [];
    let seq = 0;
    const waiters = new Set<() => void>();

    const read = (cursor: number): NextResult<T> | null => {
        const oldest = buffer.length ? buffer[0].seq : seq + 1;
        if (cursor > seq || cursor < oldest - 1) return { reset: true, cursor: seq };
        if (cursor === seq) return null;
        return { cursor: seq, events: buffer.filter(b => b.seq > cursor).map(b => b.event) };
    };

    return {
        push(event: T) {
            buffer.push({ seq: ++seq, event });
            if (buffer.length > max) buffer.shift();
            for (const wake of [...waiters]) wake();
        },

        /**
         * cursor より新しいイベントを返す。無ければ来るまで（最長 waitMs）待つ。
         * onGone には、呼び出し元が消えたときに呼ぶ関数を登録する口を渡す（webContents の destroyed など）。
         * onGone が購読の解除関数を返せば、応答したときに呼んで外す
         */
        next(cursor: number | null, onGone?: (cb: () => void) => (() => void) | void): Promise<NextResult<T>> {
            if (typeof cursor !== "number" || !Number.isInteger(cursor)) return Promise.resolve({ reset: true, cursor: seq });
            const now = read(cursor);
            if (now) return Promise.resolve(now);

            return new Promise(resolve => {
                let done = false;
                // onGone が同期的に呼び返しても参照できるよう、解除関数は入れ物に持つ
                const sub: { off?: (() => void) | void; } = {};
                const finish = (r: NextResult<T>) => {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                    waiters.delete(wake);
                    sub.off?.();
                    resolve(r);
                };
                const wake = () => {
                    const r = read(cursor);
                    if (r) finish(r);
                };
                const timer = setTimeout(() => finish({ cursor, events: [] }), waitMs);
                waiters.add(wake);
                sub.off = onGone?.(() => finish({ cursor, events: [] }));
            });
        },

        cursor: () => seq,
        pending: () => waiters.size
    };
}
