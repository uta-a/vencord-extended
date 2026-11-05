/*
 * Vencord Extended installer
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// 対話の部品。Vencord 公式インストーラの CLI 版（promptui）と同じく、矢印キーで選んで Enter で決める。
// 依存を増やさず、readline のキー入力と ANSI エスケープだけで描く（単一の exe に束ねるため）。

import readline from "readline";

const ESC = "\x1b[";
export const color = {
    cyan: (s: string) => `${ESC}36m${s}${ESC}39m`,
    green: (s: string) => `${ESC}92m${s}${ESC}39m`,
    red: (s: string) => `${ESC}91m${s}${ESC}39m`,
    yellow: (s: string) => `${ESC}93m${s}${ESC}39m`,
    dim: (s: string) => `${ESC}2m${s}${ESC}22m`,
    bold: (s: string) => `${ESC}1m${s}${ESC}22m`
};

export interface Choice<T> {
    label: string;
    value: T;
    /** 選択肢の右に薄く添える説明 */
    hint?: string;
}

export type SelectKey = "up" | "down" | "home" | "end";

/** キーで選択位置を動かす。端では反対側へ回る（promptui と同じ） */
export function moveIndex(index: number, key: SelectKey, length: number): number {
    if (length <= 0) return 0;
    switch (key) {
        case "up": return (index - 1 + length) % length;
        case "down": return (index + 1) % length;
        case "home": return 0;
        case "end": return length - 1;
    }
}

/** 選択肢の描画（行の配列）。選ばれている行に印を付ける */
export function renderSelect<T>(label: string, choices: readonly Choice<T>[], index: number): string[] {
    return [
        `${color.cyan("?")} ${color.bold(label)} ${color.dim("（↑↓ で選び、Enter で決定）")}`,
        ...choices.map((c, i) => {
            const hint = c.hint ? ` ${color.dim(c.hint)}` : "";
            return i === index ? `${color.cyan("❯ " + c.label)}${hint}` : `  ${c.label}${hint}`;
        })
    ];
}

export class Cancelled extends Error {
    constructor() {
        super("中止しました");
    }
}

export function isInteractive(): boolean {
    return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

/** 矢印キーで 1 つ選ぶ。Ctrl+C と Esc は Cancelled を投げる */
export function select<T>(label: string, choices: readonly Choice<T>[]): Promise<T> {
    if (choices.length === 0) return Promise.reject(new Error("選べるものがありません"));
    const { stdin, stdout } = process;
    let index = 0;
    let drawn = 0;

    const draw = () => {
        // 前回描いた分だけ上へ戻って消してから描き直す
        if (drawn > 0) stdout.write(`${ESC}${drawn}F${ESC}J`);
        const lines = renderSelect(label, choices, index);
        stdout.write(lines.join("\n") + "\n");
        drawn = lines.length;
    };

    return new Promise<T>((resolve, reject) => {
        readline.emitKeypressEvents(stdin);
        const wasRaw = stdin.isRaw;
        stdin.setRawMode(true);
        stdin.resume();
        stdout.write(`${ESC}?25l`); // カーソルを隠す

        const finish = (done: () => void) => {
            stdin.off("keypress", onKey);
            stdin.setRawMode(wasRaw);
            stdin.pause();
            stdout.write(`${ESC}?25h`);
            done();
        };
        const onKey = (_: string, key: readline.Key) => {
            if ((key.ctrl && key.name === "c") || key.name === "escape") {
                finish(() => reject(new Cancelled()));
                return;
            }
            if (key.name === "return" || key.name === "enter") {
                // 決めた後は、選んだものだけを 1 行で残す（promptui と同じ）
                stdout.write(`${ESC}${drawn}F${ESC}J${color.green("✔")} ${label} ${color.cyan(choices[index].label)}\n`);
                finish(() => resolve(choices[index].value));
                return;
            }
            const map: Record<string, SelectKey> = { up: "up", k: "up", down: "down", j: "down", home: "home", end: "end" };
            const move = key.name ? map[key.name] : undefined;
            if (!move) return;
            index = moveIndex(index, move, choices.length);
            draw();
        };
        stdin.on("keypress", onKey);
        draw();
    });
}

/** はい／いいえ。既定は「いいえ」（誤って Enter を押しても進まない） */
export async function confirm(label: string): Promise<boolean> {
    return select(label, [
        { label: "いいえ", value: false },
        { label: "はい", value: true }
    ]);
}

/** Enter を待つ（ダブルクリックで開いたとき、結果を読む前に窓が閉じないように） */
export function waitEnter(message = "Enter キーで終了します"): Promise<void> {
    return new Promise(resolve => {
        process.stdout.write(color.dim(message));
        const rl = readline.createInterface({ input: process.stdin });
        rl.once("line", () => {
            rl.close();
            resolve();
        });
        rl.once("close", () => resolve());
    });
}

export const ok = (msg: string) => console.log(`${color.green("✔")} ${msg}`);
export const fail = (msg: string) => console.error(`${color.red("❌")} ${msg}`);
export const info = (msg: string) => console.log(`${color.cyan("i")} ${msg}`);
export const warn = (msg: string) => console.log(`${color.yellow("!")} ${msg}`);
