/*
 * Vencord Extended installer
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// 対話の部品。Vencord 公式インストーラの CLI 版（promptui）と同じ見た目と操作にする。
// 依存を増やさず、readline のキー入力と ANSI エスケープだけで描く（単一の exe に束ねるため）。

import readline from "readline";

const ESC = "\x1b[";
export const color = {
    cyan: (s: string) => `${ESC}36m${s}${ESC}39m`,
    blue: (s: string) => `${ESC}94m${s}${ESC}39m`,
    green: (s: string) => `${ESC}92m${s}${ESC}39m`,
    red: (s: string) => `${ESC}91m${s}${ESC}39m`,
    yellow: (s: string) => `${ESC}93m${s}${ESC}39m`,
    dim: (s: string) => `${ESC}2m${s}${ESC}22m`,
    bold: (s: string) => `${ESC}1m${s}${ESC}22m`,
    underline: (s: string) => `${ESC}4m${s}${ESC}24m`
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

/** 操作の案内。promptui の「Use the arrow keys to navigate: ↓ ↑ → ←」にあたる */
export const SELECT_HELP = "矢印キーで選んでください: ↓ ↑";

/**
 * 選択肢の描画（行の配列）。promptui の既定と同じ形にする:
 * 案内、「? 質問:」、選んでいる行は「▸」と下線、ほかは字下げだけ
 */
export function renderSelect<T>(label: string, choices: readonly Choice<T>[], index: number): string[] {
    return [
        color.dim(SELECT_HELP),
        `${color.blue("?")} ${label}:`,
        ...choices.map((c, i) => {
            const hint = c.hint ? ` ${color.dim(c.hint)}` : "";
            return i === index ? `  ${color.bold("▸")} ${color.underline(c.label)}${hint}` : `    ${c.label}${hint}`;
        })
    ];
}

/** 決めた後に残す 1 行（promptui と同じく、選んだものを薄く）。質問も残すときは前に置く */
export function renderSelected(choice: string, question?: string): string {
    return `${color.green("✔")} ${question ? `${question} ` : ""}${color.dim(choice)}`;
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;

/** 全角（東アジアの幅の広い文字・絵文字）か。端末では 2 桁を占める */
function isWide(cp: number): boolean {
    return cp >= 0x1100 && (
        cp <= 0x115f || cp === 0x2329 || cp === 0x232a ||
        (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
        (cp >= 0xac00 && cp <= 0xd7a3) ||
        (cp >= 0xf900 && cp <= 0xfaff) ||
        (cp >= 0xfe30 && cp <= 0xfe4f) ||
        (cp >= 0xff00 && cp <= 0xff60) ||
        (cp >= 0xffe0 && cp <= 0xffe6) ||
        (cp >= 0x1f300 && cp <= 0x1faff) ||
        (cp >= 0x20000 && cp <= 0x3fffd)
    );
}

/** 端末で表示したときの桁数（色の指定は数えない） */
export function displayWidth(s: string): number {
    let w = 0;
    for (const ch of s.replace(ANSI_RE, "")) w += isWide(ch.codePointAt(0)!) ? 2 : 1;
    return w;
}

/**
 * 行を描いたとき、画面の何行を占めるか。幅を超えた行は折り返されるので、
 * 描き直すときは論理行の数ではなくこの数だけ戻らないと、古い行が残る
 */
export function screenRows(lines: readonly string[], columns: number): number {
    const cols = Math.max(1, columns);
    return lines.reduce((n, line) => n + Math.max(1, Math.ceil(displayWidth(line) / cols)), 0);
}

export class Cancelled extends Error {
    constructor() {
        super("中止しました");
    }
}

export function isInteractive(): boolean {
    return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

/**
 * 矢印キーで 1 つ選ぶ。Ctrl+C と Esc は Cancelled を投げる。
 * keepQuestion なら、決めた後に質問も残す（はい／いいえだけでは何に答えたか分からないので）
 */
export function select<T>(label: string, choices: readonly Choice<T>[], keepQuestion = false): Promise<T> {
    if (choices.length === 0) return Promise.reject(new Error("選べるものがありません"));
    const { stdin, stdout } = process;
    let index = 0;
    let drawn = 0;

    // 前回描いた分（折り返しを含む画面の行数）だけ上へ戻って消す
    const erase = () => {
        if (drawn > 0) stdout.write(`${ESC}${drawn}F${ESC}J`);
        drawn = 0;
    };
    const draw = () => {
        erase();
        const lines = renderSelect(label, choices, index);
        stdout.write(lines.join("\n") + "\n");
        drawn = screenRows(lines, stdout.columns || 80);
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
                erase();
                finish(() => reject(new Cancelled()));
                return;
            }
            if (key.name === "return" || key.name === "enter") {
                // 決めた後は、選んだものだけを 1 行で残す（promptui と同じ）
                erase();
                stdout.write(renderSelected(choices[index].label, keepQuestion ? label : undefined) + "\n");
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

/** はい／いいえ。既定は「いいえ」（誤って Enter を押しても進まない）。決めた後は「質問 答え」を残す */
export function confirm(label: string): Promise<boolean> {
    return select(label, [
        { label: "いいえ", value: false },
        { label: "はい", value: true }
    ], true);
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
