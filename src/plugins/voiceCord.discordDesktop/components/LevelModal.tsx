/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { currentTargetDb, medianDbfs, recommendedTargetBand, recommendMasterDb, recommendSourceVolume, targetRange, voiceMatchDb } from "@plugins/voiceCord.discordDesktop/lib/calibration";
import { fmtDb, fmtDbfs, MASTER_MAX_DB, TARGET_MAX_DB, TARGET_MIN_DB, toDb, toLinear } from "@plugins/voiceCord.discordDesktop/lib/db";
import { clearSourceStatsCache, scanSources } from "@plugins/voiceCord.discordDesktop/lib/sourceScan";
import { guardTrusted } from "@plugins/voiceCord.discordDesktop/lib/trusted";
import { needApi } from "@plugins/voiceCord.discordDesktop/state";
import { humanizeEngineMessage, store } from "@plugins/voiceCord.discordDesktop/store";
import { useVoiceCord } from "@plugins/voiceCord.discordDesktop/useVoiceCord";
import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { closeModal, Modal, openModal, ScrollerThin, useEffect, useMemo, useRef, useState } from "@webpack/common";

import { clampRefDbfs } from "../../../voicecord/shared/loudness";
import type { SoundItem, SourceStats } from "../../../voicecord/shared/types";
import { DiscordText } from "./discord";
import { ArrowRightIcon, CheckIcon, GaugeIcon } from "./icons";
import { Btn, Card, CheckRow, LevelMeter, Mono, Notice, Progress, Small, VSlider } from "./ui";

// 音量調整（voicecord-module の LevelDialog 由来）。文言と手順の順序、各所の判断はそのまま移している

// 「あー」と出し続けてもらう前提の長さ。長くすると息が続かず途中で切れ、発話フレームが減って測定が不安定になる
const MEASURE_SECONDS = 3;

// 全音源のラウドネスを測って、基準レベルへ揃える音量を自動で書き込む。基準は「測定値の中央値」
function useNormalizeScan(sounds: SoundItem[]) {
    const [stats, setStats] = useState<Record<string, SourceStats>>({});
    const [scanning, setScanning] = useState(false);
    // 一度でも走らせたか。未スキャンと「スキャンしたが 0 件」は見せるべきものが違う
    const [started, setStarted] = useState(false);
    const [done, setDone] = useState(0);
    const [failed, setFailed] = useState(0);
    const [error, setError] = useState("");
    // 進行中のスキャンを識別する世代トークン。新しい run が始まった時点で古い run だけが無効になる
    const genRef = useRef(0);
    // 追い越された / アンマウントされた run を次の音源へ進ませない
    const abortRef = useRef<AbortController | null>(null);

    const run = async () => {
        const gen = ++genRef.current;
        const alive = () => genRef.current === gen;
        setStarted(true);
        let api;
        try {
            api = needApi();
        } catch {
            setError("エンジンに接続されていません");
            return;
        }
        if (sounds.length === 0) return;
        setScanning(true);
        setDone(0);
        setFailed(0);
        setError("");
        abortRef.current?.abort();
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        const r = await scanSources(sounds, api, p => {
            if (!alive()) return;
            if (p.stats) {
                const st = p.stats;
                setStats(prev => ({ ...prev, [p.sound.id]: st }));
            }
            setDone(p.done);
        }, ctrl.signal);
        if (!alive()) return;
        const got: Record<string, SourceStats> = {};
        for (const s of sounds) {
            const st = r.stats.get(s.fp);
            if (st) got[s.id] = st;
        }
        setFailed(r.failed);
        setError(r.firstError ? `${r.firstError.id}: ${humanizeEngineMessage(r.firstError.message)}` : "");
        setScanning(false);
        const ref = medianDbfs(Object.values(got).map(s => s.rms));
        if (ref === null) return;
        // 保存側と同じ範囲へ先に収める（保存時に黙って矯正されると、再起動の前後で推奨音量が変わる）
        const rounded = clampRefDbfs(Math.round(ref * 10) / 10);
        const st0 = store.getState();
        const before = st0.settings;
        const prevRef = before.normalizeRefDbfs;
        st0.patchSettings({ normalizeRefDbfs: rounded });

        // 基準が動くと、送信音量を触っていなくても「声との差」が変わる。今の実際の差が保たれるよう送信音量を計算し直す。
        // ただし既に音量がある音源は旧基準のまま残るので、取り残される音源があるうちは master を動かさない
        const known = store.getState().sourceVolumes;
        const stale = Object.entries(got).filter(([id, st]) => {
            const v = known[id];
            if (v === undefined) return false;
            return Math.abs(recommendSourceVolume(st.rms, st.peak, rounded).vol - v) >= 0.005;
        }).length;

        const cal = before.calibration;
        const prevMatch = cal ? voiceMatchDb(cal.voiceRms, prevRef) : null;
        const curTarget = prevMatch === null ? null : currentTargetDb(toDb(before.master), prevMatch);
        const refMoved = Math.abs(rounded - prevRef) >= 0.05;
        const retuned = cal !== null && curTarget !== null && Number.isFinite(curTarget) && refMoved && stale === 0;
        let clampedAt: "min" | "max" | undefined;
        if (cal && retuned && curTarget !== null) {
            const next = recommendMasterDb(cal.voiceRms, rounded, curTarget);
            clampedAt = next.clampedAt;
            store.getState().setMaster(toLinear(next.db));
        }

        // 自動で音量を書き込むのは「まだ音量が決まっていない音源」だけ（個別に決めた音量を開いただけで捨てない）
        let applied = 0;
        for (const [id, st] of Object.entries(got)) {
            if (known[id] !== undefined) continue;
            store.getState().setSourceVolume(id, recommendSourceVolume(st.rms, st.peak, rounded).vol);
            applied++;
        }
        const notes: string[] = [];
        if (applied > 0) notes.push(`${applied} 件のサウンドの音量を自動で揃えました`);
        if (retuned) {
            notes.push(clampedAt === undefined
                ? "基準が変わったため、送信音量を「声との差」が保たれる値に直しました"
                : `基準が変わりましたが、送信音量が${clampedAt === "max" ? "上限" : "下限"}に達したため「声との差」を保てませんでした`);
        } else if (refMoved && stale > 0) {
            notes.push(`基準が変わりました。${stale} 件の音源が古い基準のままなので、「すべての音源に音量を適用」で揃えてください`);
        }
        if (notes.length > 0) store.getState().setStatus(notes.join("。"));
    };

    // 開いただけでは走らせない（重い処理なので開始はボタンに委ねる）。閉じたら進行中の run を捨てる
    useEffect(() => () => {
        genRef.current++;
        abortRef.current?.abort();
    }, []);

    const refDbfs = useMemo(() => {
        const m = medianDbfs(Object.values(stats).map(s => s.rms));
        return m === null ? null : clampRefDbfs(Math.round(m * 10) / 10);
    }, [stats]);

    return {
        stats, scanning, started, done, failed, error, refDbfs,
        scan: () => void run(),
        rescan: () => {
            clearSourceStatsCache();
            setStats({});
            void run();
        }
    };
}

function LevelBody() {
    const attached = useVoiceCord(s => s.attached);
    const connection = useVoiceCord(s => s.connection);
    const voices = useVoiceCord(s => s.voices);
    const sounds = useVoiceCord(s => s.sounds);
    const settings = useVoiceCord(s => s.settings);
    const sourceVolumes = useVoiceCord(s => s.sourceVolumes);
    const calib = useVoiceCord(s => s.calib);
    const { setSourceVolume, startVoiceCalib, cancelCalib, applyMasterDb, saveCalibration, stopAll } = store.getState();

    const norm = useNormalizeScan(sounds);
    const saved = settings.calibration;
    // 初期値は「今この瞬間の実際の差」（保存済みの目標値だとフェーダーと違う値を指す）
    const [targetDb, setTargetDb] = useState<number>(() => {
        const m = settings.calibration ? voiceMatchDb(settings.calibration.voiceRms, settings.normalizeRefDbfs) : null;
        if (m === null) return settings.calibration?.targetDb ?? 0;
        const d = currentTargetDb(toDb(settings.master), m);
        return Number.isFinite(d) ? Math.round(d * 2) / 2 : 0;
    });
    // 「声を出す準備ができた」状態。押す前に声を出し始められるよう、説明を読む段と開始する段を分ける
    const [ready, setReady] = useState(false);
    const touchedRef = useRef(false);
    const playingNow = voices.some(v => v.kind === "vc");
    const canMeasure = attached && connection === "connected" && !playingNow;

    const source = calib.phase === "done" && calib.last
        ? { rms: calib.last.vRms, peak: calib.last.vPeak, fresh: true }
        : saved ? { rms: saved.voiceRms, peak: saved.voicePeak, fresh: false } : null;

    const rec = source ? recommendMasterDb(source.rms, settings.normalizeRefDbfs, targetDb) : null;
    const currentDb = toDb(settings.master);
    const matchDb = source ? voiceMatchDb(source.rms, settings.normalizeRefDbfs) : null;
    const range = matchDb !== null ? targetRange(matchDb) : null;
    const targetMin = range ? range.min : TARGET_MIN_DB;
    const targetMax = range ? range.max : TARGET_MAX_DB;
    const currentTarget = matchDb !== null ? currentTargetDb(currentDb, matchDb) : null;
    const band = recommendedTargetBand(targetMin, targetMax);

    // 初めて測定値が手に入った瞬間だけ、スライダーを「今の実際の差」に合わせる。
    // 測り直しでは絶対に動かさない（targetDb はユーザーの意図なので、測定値が変わっても保持する）
    const seededTarget = useRef(matchDb !== null);
    useEffect(() => {
        if (matchDb === null || seededTarget.current) return;
        seededTarget.current = true;
        if (touchedRef.current) return;
        const d = currentTargetDb(currentDb, matchDb);
        if (Number.isFinite(d)) setTargetDb(Math.round(d * 2) / 2);
    }, [matchDb, currentDb]);
    const sfxRms = source ? source.rms * Math.pow(10, targetDb / 20) : 0;

    const apply = () => {
        if (!rec || !source) return;
        applyMasterDb(rec.db, targetDb);
        const m = calib.last;
        // at は「いつ声を測ったか」。今回測っていないなら元の at を持ち越す
        saveCalibration({
            at: source.fresh ? Date.now() : (saved?.at ?? Date.now()),
            voiceRms: source.rms,
            voicePeak: source.peak,
            activeRatio: source.fresh && m && m.total > 0 ? m.vN / m.total : (saved?.activeRatio ?? 1),
            targetDb
        });
    };

    const measuredRows = sounds
        .map(s => {
            const st = norm.stats[s.id];
            if (!st) return null;
            return { sound: s, st, rec: recommendSourceVolume(st.rms, st.peak, settings.normalizeRefDbfs), applied: sourceVolumes[s.id] ?? 1 };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);
    const clampedMax = measuredRows.filter(r => r.rec.clampedAt === "max").length;
    const clampedPeak = measuredRows.filter(r => r.rec.clampedAt === "peak").length;
    const outOfSync = measuredRows.filter(r => Math.abs(r.rec.vol - r.applied) >= 0.005);

    // 手順 3 の予測が成り立つ前提は「全音源が基準へ揃っていること」。崩れている理由をすべて断る
    const predictNotes: string[] = [];
    if (measuredRows.length === 0) {
        predictNotes.push("まだ音源の音量を揃えていません。上の「1. 音源の音量を揃える」を実行するまでは、ここの予測と実際に鳴る音量がズレます。");
    } else {
        if (outOfSync.length > 0) predictNotes.push(`${outOfSync.length} 件の音源が推奨と違う音量のままです。上の「すべての音源に音量を適用」で揃えるまで、その音源にはここの予測が当てはまりません。`);
        if (clampedMax + clampedPeak > 0) predictNotes.push(`${clampedMax + clampedPeak} 件は上限やピークの制約で基準に届いていません。その音源はここの表示より小さく届きます。`);
    }

    const measureBlockReason = !attached ? "Discord に接続してください"
        : connection !== "connected" ? "VC で通話を始めてください"
            : playingNow ? "再生中のサウンドがあります" : "";

    const applyAllSourceVolumes = () => {
        for (const r of measuredRows) setSourceVolume(r.sound.id, r.rec.vol);
    };

    // ---- 声を出す準備（開始タイミングはユーザーが決める） ----
    if (ready) {
        return (
            <div className="vc-voicecord-stack">
                <Card className="vc-voicecord-center">
                    <DiscordText variant="body-md/medium"><span className="vc-voicecord-accent">「あー」</span>と声を出しながら<br />下のボタンを押してください</DiscordText>
                    <Small>いつもの声の大きさ・いつものマイクの距離で。<br />押したあと {MEASURE_SECONDS} 秒間、途切れさせずに出し続けてください。</Small>
                    {/* 測定の開始は送信系の操作として扱う（ユーザーの決定）。合成クリックでは始めない */}
                    <Btn grow onClick={guardTrusted("音量調整の測定開始", () => {
                        setReady(false);
                        startVoiceCalib(MEASURE_SECONDS);
                    })}>
                        測定を開始（{MEASURE_SECONDS} 秒）
                    </Btn>
                </Card>
                <Btn variant="secondary" grow onClick={() => setReady(false)}>やめる</Btn>
            </div>
        );
    }

    // ---- 計測中 ----
    if (calib.phase === "measuring") {
        return (
            <div className="vc-voicecord-stack">
                <Card>
                    <DiscordText variant="body-md/medium">今すぐ<span className="vc-voicecord-accent">「あー」</span>と声を出してください</DiscordText>
                    <Small>下のバーが動いていれば声を拾えています。途切れさせずに出し続けてください。</Small>
                    <LevelMeter value={calib.vNow} label="あなたの声（相手に送られている音）" hot={calib.vNow >= 0.9} format={fmtDbfs} />
                    <div className="vc-voicecord-spread">
                        <Small>測定の進み具合</Small>
                        <Small><Mono>{calib.frames} / {calib.budget} フレーム</Mono></Small>
                    </div>
                    <Progress ratio={calib.budget > 0 ? calib.frames / calib.budget : 0} />
                    <Small>経過時間ではなく実際に処理されたマイクのフレーム数です。進まない場合はマイクがミュートになっています。</Small>
                </Card>
                <Btn variant="secondary" grow onClick={cancelCalib}>中断する</Btn>
            </div>
        );
    }

    // 音源の均一化は声の測定より前に置く（基準レベルを確定させ、送信音量の推奨はその基準を使うため）
    const normalizeSection = (
        <Card>
            <div className="vc-voicecord-spread">
                <DiscordText variant="body-sm/semibold">1. 音源の音量を揃える</DiscordText>
                {!norm.scanning && measuredRows.length > 0 && <Small><Mono>基準 {norm.refDbfs?.toFixed(1)} dBFS</Mono></Small>}
            </div>
            <Small>サウンドごとの音量差をならします。まだ音量を決めていないものは測定後に自動で揃え、個別に設定した音量はそのまま残します。次の「声を測る」はこの結果を基準にするので、先にこちらを済ませてください。</Small>

            {norm.scanning ? (
                <>
                    <div className="vc-voicecord-spread">
                        <Small>初回は音声の変換が走るため時間がかかります</Small>
                        <Small><Mono>{norm.done} / {sounds.length}</Mono></Small>
                    </div>
                    <Progress ratio={sounds.length ? norm.done / sounds.length : 0} />
                </>
            ) : measuredRows.length > 0 ? (
                <>
                    <ScrollerThin className="vc-voicecord-table-scroller">
                        <table className="vc-voicecord-table">
                            <thead>
                                <tr><th>音源</th><th>測定</th><th>推奨</th><th>現在</th></tr>
                            </thead>
                            <tbody>
                                {measuredRows.map(r => {
                                    const note = r.rec.clampedAt === "max"
                                        ? "元の録音が小さすぎるため、上限の 150% でも基準に届きません"
                                        : r.rec.clampedAt === "peak" ? "ピークが高い音源のため、音割れを避けて基準より控えめにしています" : undefined;
                                    const differs = Math.abs(r.rec.vol - r.applied) >= 0.005;
                                    return (
                                        <tr key={r.sound.id}>
                                            <td title={r.sound.name}>{r.sound.id}</td>
                                            <td>{fmtDbfs(r.st.rms)}</td>
                                            <td className={r.rec.clampedAt ? "vc-voicecord-warn" : undefined} title={note}>{Math.round(r.rec.vol * 100)}%{r.rec.clampedAt && " ⚠"}</td>
                                            <td className={differs ? "vc-voicecord-accent" : undefined}>{Math.round(r.applied * 100)}%</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </ScrollerThin>
                    {clampedMax > 0 && <Small className="vc-voicecord-warn">⚠ の {clampedMax} 件は上限（150%）で頭打ちです。元の録音が小さすぎます。</Small>}
                    {clampedPeak > 0 && <Small className="vc-voicecord-warn">⚠ の {clampedPeak} 件はピークが高いため、音割れを避けて基準より控えめにしています。</Small>}
                    {norm.failed > 0 && <Small className="vc-voicecord-warn">{norm.failed} 件を測定できませんでした。{norm.error}</Small>}
                    {outOfSync.length > 0
                        ? <Btn grow onClick={applyAllSourceVolumes}><CheckIcon size={14} />すべての音源に音量を適用（{outOfSync.length} 件を変更）</Btn>
                        : <Small className="vc-voicecord-center"><CheckIcon size={12} className="vc-voicecord-ok" /> すべて推奨値どおりです</Small>}
                    <Btn variant="secondary" grow onClick={norm.rescan}>測り直す</Btn>
                </>
            ) : norm.started || sounds.length === 0 ? (
                <>
                    <Small className="vc-voicecord-warn">{sounds.length === 0 ? "サウンドフォルダに音源がありません。" : `測定できませんでした。${norm.error}`}</Small>
                    {/* 全件失敗しても回復操作を必ず残す（失敗は一過性でも起きる） */}
                    {sounds.length > 0 && <Btn variant="secondary" grow onClick={norm.rescan}><GaugeIcon size={14} />もう一度測る</Btn>}
                </>
            ) : (
                <>
                    <Btn grow onClick={norm.scan}><GaugeIcon size={14} />{sounds.length} 件のサウンドを測る</Btn>
                    <Small>初回は音声の変換が走るため時間がかかります。VC へは何も送られません。</Small>
                </>
            )}
        </Card>
    );

    return (
        <div className="vc-voicecord-stack">
            {calib.phase === "failed" && <Notice tone="danger">{calib.message || "測定に失敗しました"}</Notice>}
            {calib.phase === "done" && calib.message && <Notice tone="warning">{calib.message}</Notice>}

            {normalizeSection}

            {/* 手順 2: 声を測る。測定値がある間は 1 行に畳む（手順 3 の適用ボタンが画面外に落ちないように） */}
            {source ? (
                <Card className="vc-voicecord-spread">
                    <DiscordText variant="body-sm/medium">
                        <CheckIcon size={14} className="vc-voicecord-ok" /> <span className="vc-voicecord-muted">2. </span>{source.fresh ? "声を測りました" : "測定ずみの声"} <Mono className="vc-voicecord-muted">{fmtDbfs(source.rms)}</Mono>
                    </DiscordText>
                    <div className="vc-voicecord-inline">
                        {measureBlockReason && <Small>{measureBlockReason}</Small>}
                        {playingNow && <Btn size="sm" variant="secondary" onClick={stopAll}>停止して続行</Btn>}
                        <Btn size="sm" variant="secondary" disabled={!canMeasure} onClick={() => setReady(true)}>測り直す</Btn>
                    </div>
                </Card>
            ) : (
                <Card>
                    <DiscordText variant="body-sm/semibold">2. 自分の声を測る</DiscordText>
                    <CheckRow ok={attached}>Discord に接続している</CheckRow>
                    <CheckRow ok={connection === "connected"}>VC で通話中である</CheckRow>
                    <CheckRow ok={!playingNow}>再生中のサウンドがない</CheckRow>
                    <Small>「あー」と {MEASURE_SECONDS} 秒間、声を切らさずに出し続けてもらいます。開始のタイミングは次の画面で自分で決められます。測定中に VC へ音が送られることはありません。送信ゲートにも触れません。</Small>
                    <div className="vc-voicecord-inline">
                        <Btn grow disabled={!canMeasure} onClick={() => setReady(true)}>「あー」と {MEASURE_SECONDS} 秒間、声を出す</Btn>
                        {playingNow && <Btn variant="secondary" onClick={stopAll}>停止して続行</Btn>}
                    </div>
                </Card>
            )}

            {/* 手順 3: 効果音をどれくらいで届けるか */}
            {source && rec && (
                <Card>
                    <div className="vc-voicecord-spread">
                        <DiscordText variant="body-sm/semibold">3. 効果音の大きさを決める</DiscordText>
                        {!source.fresh && saved && <Small>{new Date(saved.at).toLocaleString()} の測定値</Small>}
                    </div>
                    <Small>測った声を基準に、効果音を相手へどのくらいの大きさで届けるかを選びます。</Small>

                    <div className="vc-voicecord-subcard">
                        <DiscordText variant="body-sm/medium">相手にはこう届きます</DiscordText>
                        {predictNotes.map(note => <Notice key={note} tone="warning">{note}</Notice>)}
                        <LevelMeter value={source.rms} label="あなたの声" format={fmtDbfs} />
                        <LevelMeter value={sfxRms} label="効果音" hot={targetDb > 0} format={fmtDbfs} />
                        <Small>
                            {targetDb === 0 ? "効果音は自分の声と同じ大きさで届きます。"
                                : targetDb < 0 ? `効果音は自分の声より ${(-targetDb).toFixed(1)} dB 小さく届きます。`
                                    : `効果音は自分の声より ${targetDb.toFixed(1)} dB 大きく届きます。`}
                        </Small>
                    </div>

                    <div className="vc-voicecord-spread">
                        <DiscordText variant="body-sm/medium">声との差</DiscordText>
                        <Small><Mono>{fmtDb(targetDb)}</Mono></Small>
                    </div>
                    <VSlider
                        label="効果音と声の音量差"
                        value={Math.min(targetMax, Math.max(targetMin, targetDb))}
                        min={targetMin}
                        max={targetMax}
                        step={0.5}
                        markers={[0]}
                        render={fmtDb}
                        onChange={v => {
                            touchedRef.current = true;
                            setTargetDb(v);
                        }}
                    />
                    <div className="vc-voicecord-spread"><Small>控えめ</Small><Small>目立たせる</Small></div>
                    {band && (
                        <div className="vc-voicecord-subcard">
                            <div className="vc-voicecord-spread">
                                <Small><span className="vc-voicecord-ok">●</span> おすすめ {fmtDb(band.min)} 〜 {fmtDb(band.max)}</Small>
                                {Math.abs(targetDb - band.center) >= 0.5 && (
                                    <Btn size="sm" variant="secondary" onClick={() => {
                                        touchedRef.current = true;
                                        setTargetDb(band.center);
                                    }}>{fmtDb(band.center)} にする</Btn>
                                )}
                            </div>
                            {/* なぜ 0 dB が推奨でないのかを書く（「声と同じ」が最も無難に見えて、実際には最も大きい設定になる） */}
                            <Small>±0 dB は「声と同じ音量」ではなく「声と同じ RMS」です。声は絶えず途切れるのに効果音は鳴り続けるため、同じ RMS だと効果音のほうがはっきり大きく聞こえます。</Small>
                        </div>
                    )}

                    {/* 変更の前後を「声との差」で見せる（生の送信ゲインは UI のどこにも出ていない内部量） */}
                    <div className={classes("vc-voicecord-subcard", "vc-voicecord-spread")}>
                        <DiscordText variant="body-sm/normal">声との差</DiscordText>
                        <span className="vc-voicecord-inline">
                            <Mono className="vc-voicecord-muted">{currentTarget !== null ? fmtDb(currentTarget) : fmtDb(currentDb)}</Mono>
                            <ArrowRightIcon size={14} className="vc-voicecord-muted" />
                            <Mono className="vc-voicecord-accent">{fmtDb(targetDb)}</Mono>
                        </span>
                    </div>
                    {rec.clampedAt === "max" && <Small className="vc-voicecord-warn">上限（{MASTER_MAX_DB} dB）に達しました。マイク入力が大きいため、これ以上は効果音を持ち上げられません。Discord の入力音量を下げてください。</Small>}
                    {rec.clampedAt === "min" && <Small className="vc-voicecord-warn">下限に達しました。</Small>}

                    {/* 基準レベルはスキャン完了時に確定する。それより前に適用すると古い基準で計算した送信音量が入る */}
                    <Btn grow onClick={apply} disabled={norm.scanning}>{norm.scanning ? "サウンドの測定を待っています…" : "この設定にする"}</Btn>

                    <dl className="vc-voicecord-dl">
                        <dt>測った声（RMS）</dt><dd><Mono>{fmtDbfs(source.rms)}</Mono></dd>
                        <dt>同（ピーク）</dt><dd><Mono>{fmtDbfs(source.peak)}</Mono></dd>
                        {source.fresh && calib.last && calib.last.clip > 0 && <><dt>クリップ（音割れ）</dt><dd className="vc-voicecord-warn"><Mono>{calib.last.clip} サンプル</Mono></dd></>}
                    </dl>
                    <Small>測定できるのは「あなたの PC から出ていく時点」の声と効果音の比です。相手側の受信音量設定までは分かりません。</Small>
                </Card>
            )}
        </div>
    );
}

function LevelModal({ modalProps }: { modalProps: RenderModalProps; }) {
    return (
        <Modal
            {...modalProps}
            size="lg"
            title="音量調整"
            subtitle="相手に送られている音を実測して、この環境に合った音量を決めます。"
            actions={[{ text: "閉じる", variant: "secondary", onClick: modalProps.onClose }]}
        >
            <LevelBody />
        </Modal>
    );
}

// store の levelOpen に合わせて開閉する（フェーダー横と設定画面の両方から開くので、実体は 1 つ）
let modalKey: string | null = null;

export function syncLevelModal(open: boolean) {
    if (open && modalKey === null) {
        modalKey = openModal(props => <LevelModal modalProps={props} />, {
            onCloseCallback: () => {
                modalKey = null;
                // 閉じたら計測を止める（setLevelOpen(false) が cancelCalib まで面倒を見る）
                store.getState().setLevelOpen(false);
            }
        });
    } else if (!open && modalKey !== null) {
        const key = modalKey;
        modalKey = null;
        closeModal(key);
    }
}
