/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * VoiceCord の main 側（旧 voicecord-module の src/patcher/index.ts と ipc.ts）。
 *
 * Vencord の ipcPlugins がこのファイルの export を `VencordPluginNative_VoiceCord_<name>` として
 * ipcMain.handle に登録し、renderer からは VencordNative.pluginHelpers.VoiceCord.<name>() で呼べる。
 *
 * このモジュールは patcher.js に束ねられ、プラグインが無効でも Discord の起動直後に読み込まれる。
 * そのためトップレベルでは何も起動せず、条件がそろったときだけ app.whenReady() の後に起こす。
 * どのサブシステムが落ちても、Discord と Vencord の起動は止めない。
 *
 * frida はここには載せない。エンジンは utilityProcess の子として起こす。
 */

import { RendererSettings } from "@main/settings";
import { DATA_DIR, IS_VANILLA } from "@main/utils/constants";
import { app, BrowserWindow, dialog, type IpcMainInvokeEvent, utilityProcess } from "electron";
import fs from "fs";
import path from "path";

import { type ConfigStore, createConfigStore, defaultConfig, defaultSoundsFolder } from "../../../voicecord/shared/config";
import type { VoiceCordEvent, VoiceCordStatus } from "../../../voicecord/shared/ipc";
import { voiceCordPaths } from "../../../voicecord/shared/paths";
import { isSoundboardSoundId } from "../../../voicecord/shared/soundboard";
import type { AppConfig, InjectPlayReq, LoadedConfig, SoundItem } from "../../../voicecord/shared/types";
import { createEngineHost, type EngineHost, type EngineProcessLike } from "./engineHost";
import { createEventQueue, type NextResult } from "./eventQueue";
import { guessBranch, locateInstall } from "./locate";
import { createSoundboardCache, resolveReadableSoundPath, type SoundboardCache } from "./soundboardCache";
import { scanFolder, type SoundsFs } from "./soundsFs";
import { runSubsystems, type Subsystem, type SubsystemLog, summarize } from "./subsystems";
import { nextPlaying, nextVcActive, vcActiveForState } from "./vcStatus";

const PLUGIN_NAME = "VoiceCord";

const log: SubsystemLog = {
    info: msg => console.log(`[VoiceCord] ${msg}`),
    error: (msg, err) => console.error(`[VoiceCord] ${msg}`, err)
};

/** soundsFs へ渡す node の fs。統計は ns 精度のものを別口で取る */
const soundsFs: SoundsFs = {
    existsSync: p => fs.existsSync(p),
    statSync: p => fs.statSync(p),
    statSyncBig: p => {
        const st = fs.statSync(p, { bigint: true });
        return { mtimeNs: st.mtimeNs, size: st.size };
    },
    readdirSync: p => fs.readdirSync(p),
    realpathSync: p => fs.realpathSync(p)
};

/**
 * VoiceCord を動かしてよい環境か。
 * native は Vesktop 向けの vencordDesktopMain.js にも束ねられるので、ここで必ず弾く。
 */
function isSupportedEnvironment(): boolean {
    return IS_DISCORD_DESKTOP && process.platform === "win32" && !IS_VANILLA;
}

/** enabledByDefault なので、設定に項目がまだ無いときも有効として扱う */
function isPluginEnabled(): boolean {
    return RendererSettings.store.plugins?.[PLUGIN_NAME]?.enabled !== false;
}

const install = locateInstall(require.main?.path);

const status: VoiceCordStatus = {
    engine: "starting",
    attachedPid: null,
    enginePid: null,
    sampleRate: null,
    frameSamples: null,
    discordBuild: install ? guessBranch(install.resourcesDir) : "unknown",
    discordVersion: install?.version ?? "unknown",
    lastError: null,
    degraded: [],
    vcActive: false,
    playing: []
};

// main から renderer への通知。renderer は nextEvents(cursor) で取りに来る
const events = createEventQueue<VoiceCordEvent>({ max: 500, waitMs: 25_000 });

function pushStatus() {
    events.push({ ev: "status", status: { ...status, degraded: [...status.degraded], playing: [...status.playing] } });
}

let started = false;
let config: ConfigStore | null = null;
let engine: EngineHost | null = null;
let soundboard: SoundboardCache | null = null;

/** サブシステムが落ちていたら、その旨を UI へ返す（無言で undefined を返さない） */
function needConfig(): ConfigStore {
    if (config === null) throw new Error(started ? "設定を読み込めていません" : "VoiceCord が起動していません");
    return config;
}
function needEngine(): EngineHost {
    if (engine === null) throw new Error(started ? "エンジンが起動していません" : "VoiceCord が起動していません");
    return engine;
}

function start() {
    if (started) return;
    started = true;
    status.degraded = [];

    const paths = voiceCordPaths({
        // patcher.js に束ねられているので __dirname は dist
        distDir: __dirname,
        dataDir: DATA_DIR,
        localAppData: process.env.LOCALAPPDATA ?? app.getPath("appData")
    }, path.join);

    const subsystems: Subsystem[] = [
        {
            name: "config",
            run: () => {
                const dfltFolder = defaultSoundsFolder(process.env.USERPROFILE ?? app.getPath("home"), path.join);
                config = createConfigStore(fs, paths, defaultConfig(dfltFolder), path.dirname);
                // 既定のフォルダだけは自動で作る。利用者が指定したフォルダは勝手に作らない（打ち間違いを隠さない）
                if (config.get().folder === dfltFolder && !fs.existsSync(dfltFolder)) {
                    fs.mkdirSync(dfltFolder, { recursive: true });
                }
            }
        },
        {
            // frida はこの子の中だけ。ネイティブが落ちても Discord は生き残る
            name: "engine",
            run: () => {
                if (!fs.existsSync(paths.engine)) throw new Error(`エンジンが見つかりません: ${paths.engine}`);
                const host = createEngineHost({
                    fork: () => utilityProcess.fork(paths.engine, [], {
                        stdio: "pipe",
                        serviceName: "VoiceCord engine"
                    }) as unknown as EngineProcessLike,
                    emit: e => {
                        // vc は変化したときしか来ない。UI を再読み込みしても在席と再生中を返せるよう覚えておく
                        const vcActive = nextVcActive(status.vcActive, e);
                        const playing = nextPlaying(status.playing, e);
                        if (e.ev === "log") log.info(`engine ${e.level}: ${e.message}`);
                        events.push(e);
                        if (vcActive !== status.vcActive || playing !== status.playing) {
                            status.vcActive = vcActive;
                            status.playing = playing;
                            pushStatus();
                        }
                    },
                    onState: (state, attachedPid, error, rate) => {
                        status.engine = state;
                        status.vcActive = vcActiveForState(state, status.vcActive);
                        status.attachedPid = attachedPid;
                        // 注入レートは Discord 側の都合で変わる。決め打ちにせず実測値を運ぶ
                        status.sampleRate = rate.sampleRate;
                        status.frameSamples = rate.frameSamples;
                        status.enginePid = host.pid();
                        status.lastError = error;
                        pushStatus();
                    },
                    setTimer: (fn, ms) => setTimeout(fn, ms),
                    clearTimer: h => clearTimeout(h as NodeJS.Timeout),
                    now: () => Date.now()
                });
                engine = host;
                host.start();
            }
        },
        {
            // ほかのサーバーのサウンドの置き場（%TEMP%\VoiceCord\soundboard）。フォルダは初回の取得で作る
            name: "soundboard",
            run: () => {
                soundboard = createSoundboardCache();
            }
        }
    ];

    const { failures } = summarize(runSubsystems(subsystems, log));
    registerStopKey();
    status.degraded = failures;
    // エンジンが起動できなかったときだけ engine を failed にする。他の失敗は degraded で伝える
    const engineFailure = failures.find(f => f.name === "engine");
    if (engineFailure) {
        status.engine = "failed";
        status.lastError = engineFailure.error;
    }
    pushStatus();
}

function stopEverything() {
    if (!started) return;
    started = false;
    // 子側は parentPort の close でもゲートを戻す（ゲート復帰の 1 層目）
    engine?.stop();
    engine = null;
    config = null;
    soundboard = null;
    status.engine = "starting";
    status.attachedPid = null;
    status.enginePid = null;
    status.vcActive = false;
    status.playing = [];
    pushStatus();
}

// 緊急停止（Ctrl+Alt+Shift+X）。renderer が固まっていても止められるよう、main でもキーを受ける
let stopKeyRegistered = false;
function registerStopKey() {
    if (stopKeyRegistered) return;
    stopKeyRegistered = true;
    const watch = (wc: Electron.WebContents) => wc.on("before-input-event", (_, input) => {
        if (!started || input.type !== "keyDown" || !(input.control && input.alt && input.shift && input.code === "KeyX")) return;
        engine?.request("voicecord:stopAll", [])
            .then(() => {
                status.playing = [];
                pushStatus();
            })
            .catch(e => log.error("緊急停止に失敗しました", e));
    });
    for (const w of BrowserWindow.getAllWindows()) watch(w.webContents);
    app.on("browser-window-created", (_, w) => watch(w.webContents));
}

/** 起動時の自動開始。トップレベルでは何も起こさない */
function boot() {
    if (!isSupportedEnvironment() || !isPluginEnabled()) return;
    // エンジンは VC 参加前から待機させる（設計書: 常駐。M5 で見直す）
    app.whenReady().then(() => {
        try {
            start();
        } catch (e) {
            log.error("起動に失敗しました。Discord は通常どおり続行します", e);
        }
    });
}

try {
    if (isSupportedEnvironment()) app.on("before-quit", () => stopEverything());
    boot();
} catch (e) {
    log.error("初期化に失敗しました。Discord は通常どおり続行します", e);
}

// ---------------------------------------------------------------------------
// 引数の検証。native は他のプラグインからも呼べるので、renderer 側の検証とは独立に行う

function str(v: unknown, what: string): string {
    if (typeof v !== "string") throw new Error(`${what}の指定が不正です`);
    return v;
}

function finite(v: unknown, what: string, min: number, max: number): number {
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw new Error(`${what}の指定が不正です`);
    return v;
}

function engineRequest(ch: string, args: unknown[]) {
    // utilityProcess の postMessage は MessagePort しか transfer できないので、PCM は複製で送る
    return needEngine().request(ch, args);
}

// ---------------------------------------------------------------------------
// renderer から呼ぶ関数。第 1 引数は Vencord が渡す IpcMainInvokeEvent

/** プラグインの start() から呼ぶ。実行中に有効にした場合の入口で、冪等 */
export function ensureStarted(_: IpcMainInvokeEvent): VoiceCordStatus {
    if (!isSupportedEnvironment()) throw new Error("VoiceCord は Windows の Discord デスクトップ版でだけ動きます");
    start();
    return status;
}

/** プラグインの stop() から呼ぶ。全停止してエンジンを終了する */
export function shutdown(_: IpcMainInvokeEvent) {
    stopEverything();
}

export function getStatus(_: IpcMainInvokeEvent): VoiceCordStatus {
    return status;
}

/** main からの通知を long-poll で受け取る。cursor が null か古すぎれば reset を返すので、getStatus で取り直す */
export function nextEvents(e: IpcMainInvokeEvent, cursor: unknown): Promise<NextResult<VoiceCordEvent>> {
    return events.next(typeof cursor === "number" ? cursor : null, gone => {
        e.sender.once("destroyed", gone);
        return () => e.sender.removeListener("destroyed", gone);
    });
}

function setPlaying(playing: string[]) {
    status.playing = playing;
    pushStatus();
}

export function getConfig(_: IpcMainInvokeEvent): LoadedConfig {
    const c = needConfig();
    // 読めなかった理由や旧設定からの移行は、UI で一度だけ知らせる
    return { ...c.get(), loadWarning: c.loadWarning };
}

export function saveConfig(_: IpcMainInvokeEvent, partial: unknown) {
    if (typeof partial !== "object" || partial === null || Array.isArray(partial)) {
        throw new Error("設定の形が想定と違います");
    }
    const r = needConfig().save(partial as Partial<AppConfig>);
    // 保存できなかったことを黙らせない。値は反映されているが次の起動で消える
    if (!r.ok) throw new Error(`設定を保存できませんでした: ${r.error}`);
}

export function scanSoundFolder(_: IpcMainInvokeEvent, folder?: unknown): SoundItem[] {
    const target = typeof folder === "string" && folder !== "" ? folder : needConfig().get().folder;
    return scanFolder(soundsFs, target);
}

export async function chooseFolder(_: IpcMainInvokeEvent): Promise<string | null> {
    // Discord の窓を親にする。親を付けないとダイアログが後ろへ回り込む
    const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const opts = { properties: ["openDirectory" as const] };
    const r = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
    return r.canceled ? null : (r.filePaths[0] ?? null);
}

/** 音源フォルダ配下と、サウンドボードのキャッシュの決まった名前だけを読む */
export function readSoundFile(_: IpcMainInvokeEvent, requested: unknown): ArrayBuffer {
    const c = needConfig().get();
    if (soundboard === null) throw new Error("VoiceCord が起動していません");
    const target = resolveReadableSoundPath({
        soundboard,
        unlocked: c.unlockSoundboard === true,
        soundsFs,
        folder: c.folder,
        requested: str(requested, "パス")
    });
    const buf = fs.readFileSync(target);
    // Buffer の backing store をそのまま渡すと隣接する別データまで見せてしまう。切り出してから渡す
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

export async function fetchSoundboardSound(_: IpcMainInvokeEvent, id: unknown) {
    // ID は URL とファイル名にそのまま入る。数字だけに閉じる
    if (!isSoundboardSoundId(id)) throw new Error("サウンド ID の形が想定と違います");
    // 外部への通信とファイルの書き込みなので、main でも設定を確かめる
    if (needConfig().get().unlockSoundboard !== true) throw new Error("ほかのサーバーのサウンドを鳴らす設定がオフです");
    if (soundboard === null) throw new Error("VoiceCord が起動していません");
    const soundPath = await soundboard.fetchSoundboardSound(id);
    // 同じ ID の音声は差し替わらないので、ID をそのまま指紋にする
    return { path: soundPath, fp: `sb-${id}` };
}

/** renderer でデコードした PCM（mono f32）を engine へ渡す。sampleRate は PCM 自身のレート */
export function preloadPcm(_: IpcMainInvokeEvent, srcId: unknown, fp: unknown, sampleRate: unknown, pcm: unknown) {
    if (!(pcm instanceof ArrayBuffer)) throw new Error("PCM が届いていません");
    return engineRequest(
        "voicecord:preload",
        [str(srcId, "音源"), str(fp, "指紋"), finite(sampleRate, "注入レート", 8000, 192000), pcm]
    );
}

export async function play(_: IpcMainInvokeEvent, req: unknown) {
    if (typeof req !== "object" || req === null) throw new Error("再生要求の形が想定と違います");
    const r = req as Record<string, unknown>;
    const clean: InjectPlayReq = {
        srcId: str(r.srcId, "音源"),
        path: str(r.path, "パス"),
        fp: str(r.fp, "指紋"),
        // hook 側の num() でも丸めるが、ここでも範囲外を弾く（音源別は最大 1.5）
        vol: finite(r.vol, "音量", 0, 1.5),
        sampleRate: finite(r.sampleRate, "注入レート", 8000, 192000)
    };
    const voiceId = await engineRequest("voicecord:play", [clean]);
    if (typeof voiceId === "string") setPlaying([...status.playing, voiceId]);
    return voiceId;
}

export async function stop(_: IpcMainInvokeEvent, voiceId: unknown) {
    const id = str(voiceId, "再生 ID");
    await engineRequest("voicecord:stop", [id]);
    setPlaying(status.playing.filter(v => v !== id));
}

export async function stopAll(_: IpcMainInvokeEvent) {
    await engineRequest("voicecord:stopAll", []);
    setPlaying([]);
}

export function setVoiceVolume(_: IpcMainInvokeEvent, voiceId: unknown, vol: unknown) {
    return engineRequest("voicecord:setVoiceVolume", [str(voiceId, "再生 ID"), finite(vol, "音量", 0, 1.5)]);
}

export function setMaster(_: IpcMainInvokeEvent, v: unknown) {
    return engineRequest("voicecord:setMaster", [finite(v, "送信音量", 0, 4)]);
}

export function openGate(_: IpcMainInvokeEvent, guardMs: unknown) {
    return engineRequest("voicecord:openGate", [finite(guardMs, "待ち時間", 0, 10_000)]);
}

export function calibStart(_: IpcMainInvokeEvent, tag: unknown, frames: unknown) {
    return engineRequest("voicecord:calibStart", [str(tag, "計測タグ"), finite(frames, "フレーム数", 1, 100_000)]);
}

export function calibStop(_: IpcMainInvokeEvent) {
    return engineRequest("voicecord:calibStop", []);
}

/** 手動リトライ。engine への転送ではなくプロセスの起こし直し */
export function reattach(_: IpcMainInvokeEvent): VoiceCordStatus {
    needEngine().restart();
    // 古い子の exit は無視されるので engineLost は来ない。hook ごと消えた再生はここで外す
    setPlaying([]);
    return status;
}

export async function detach(_: IpcMainInvokeEvent) {
    await engineRequest("voicecord:detach", []);
    // 手動の detach では detached が来ない
    setPlaying([]);
}
