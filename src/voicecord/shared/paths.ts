/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * VoiceCord のランタイム配置（vencord-extended 版）。
 *
 * - エンジンと hook は patcher.js と同じ dist の下の voicecord/ に置く。
 *   dist は %LOCALAPPDATA%\VencordExtended\dist（開発中はリポジトリの dist へのジャンクション）
 * - 設定は Vencord のデータディレクトリ（%APPDATA%\Vencord）の下の voicecord/ に置く
 * - 現行 voicecord-module の設定（%LOCALAPPDATA%\VoiceCord\config.json）を初回に一度だけ読んで移行する。元は消さない
 */

export interface PathEnv {
    /** patcher.js が置かれているディレクトリ */
    distDir: string;
    /** Vencord のデータディレクトリ（DATA_DIR） */
    dataDir: string;
    /** %LOCALAPPDATA%。旧設定の移行元を探すためだけに使う */
    localAppData: string;
}

export interface VoiceCordPaths {
    /** engine.mjs と hook.js の置き場 */
    runtimeDir: string;
    /** utilityProcess の子として起動するエンジン */
    engine: string;
    /** frida エージェント。エンジンが自分と同じディレクトリから読む */
    hook: string;
    config: string;
    /** voicecord-module の設定。移行元として一度だけ読む */
    legacyConfig: string;
}

export function voiceCordPaths(env: PathEnv, join: (...p: string[]) => string): VoiceCordPaths {
    const runtimeDir = join(env.distDir, "voicecord");
    return {
        runtimeDir,
        engine: join(runtimeDir, "engine.mjs"),
        hook: join(runtimeDir, "hook.js"),
        config: join(env.dataDir, "voicecord", "config.json"),
        legacyConfig: join(env.localAppData, "VoiceCord", "config.json")
    };
}
