/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { FormSwitch } from "@components/FormSwitch";
import { CogWheel, FolderIcon, RestartIcon } from "@components/Icons";
import { useEngineStatus } from "@plugins/voiceCord.discordDesktop/engineStatus";
import { guardTrusted } from "@plugins/voiceCord.discordDesktop/lib/trusted";
import { state } from "@plugins/voiceCord.discordDesktop/state";
import { KRISP_HINT, store } from "@plugins/voiceCord.discordDesktop/store";
import { useVoiceCord } from "@plugins/voiceCord.discordDesktop/useVoiceCord";
import { classes } from "@utils/misc";
import { Popout, React, ScrollerThin, Tooltip, useEffect, useMemo, useRef, useState } from "@webpack/common";
import type { MouseEvent, ReactNode } from "react";

import { DOT_LABEL, statusProblems } from "../../../voicecord/shared/status";
import type { ConnState, SoundItem } from "../../../voicecord/shared/types";
import { DiscordSearchBar, DiscordText, PickerClasses, SectionClasses, SoundClasses } from "./discord";
import { openEntrySoundModal } from "./EntrySoundModal";
import { BackIcon, HeadphonesIcon, PlayIcon, SlidersIcon, SoundIcon, StopIcon, WarningIcon } from "./icons";
import { MasterFader } from "./MasterFader";
import { MonitorSection, VolumeSection } from "./SettingsSections";
import { Btn, Mono, Row, SectionTitle, Small, VSlider } from "./ui";

// 純正サウンドボードと同じ組み方のポップアウト（voicecord-module の SoundboardPopout 由来）。
// 器・見出し・行・タイルは純正のクラスで、純正に無い機能（全体音量・揃える・全停止・設定）は下端と設定画面に置く

const CONNECTION: Record<ConnState, string> = {
    connected: "VC接続済",
    waiting: "VC待機中",
    switching: "切替中",
    disconnected: "未接続"
};

// 純正サウンドボードと同じく、1 行に 3 つずつ並べる
const SOUNDS_PER_ROW = 3;
const rowsOf = <T,>(items: T[]) =>
    Array.from({ length: Math.ceil(items.length / SOUNDS_PER_ROW) }, (_, i) => items.slice(i * SOUNDS_PER_ROW, (i + 1) * SOUNDS_PER_ROW));

const folderName = (folder: string) => folder.split(/[\\/]/).filter(s => s !== "").pop() ?? "サウンドフォルダ";

function IconButton({ label, onClick, children }: { label: string; onClick: (e: MouseEvent) => void; children: ReactNode; }) {
    return (
        <Tooltip text={label}>
            {p => (
                <button {...p} type="button" aria-label={label} className="vc-voicecord-icon-button" onClick={onClick}>
                    {children}
                </button>
            )}
        </Tooltip>
    );
}

function VolumeBody({ sound }: { sound: SoundItem; }) {
    const previewSrc = useVoiceCord(s => s.previewSrc);
    const volume = useVoiceCord(s => s.sourceVolumes[sound.id] ?? 1);
    const unadjusted = useVoiceCord(s => s.settings.calibration !== null && !s.isVolumeAdjusted(sound.id));
    const { togglePreview, setSourceVolume, setSourceVolumeLive } = store.getState();
    const isPreviewing = previewSrc === sound.id;

    return (
        <div className={classes(PickerClasses.picker, "vc-voicecord-volume")} role="dialog" aria-label={`${sound.id}の音量`}>
            <DiscordText variant="body-md/semibold" lineClamp={1}>{sound.name}</DiscordText>
            <div className="vc-voicecord-spread">
                <Small>この音の音量（送信・モニター共通）</Small>
                <Small><Mono>{Math.round(volume * 100)}%</Mono></Small>
            </div>
            {unadjusted && (
                <Small className="vc-voicecord-warn">
                    この音はまだ音量を揃えていません。音量調整の「音源の音量を揃える」を実行するまで、この音だけ相手への大きさがずれます。
                </Small>
            )}
            <VSlider
                label={`${sound.id}の音量`}
                value={Math.round(volume * 100)}
                min={0}
                max={150}
                render={v => `${v}%`}
                onChange={v => setSourceVolumeLive(sound.id, v / 100)}
                onCommit={v => setSourceVolume(sound.id, v / 100)}
            />
            <Btn variant={isPreviewing ? "secondary" : "primary"} size="sm" grow onClick={() => togglePreview(sound.id)}>
                {isPreviewing ? <><StopIcon size={14} />試聴を停止</> : <><HeadphonesIcon size={14} />この端末で試聴</>}
            </Btn>
        </div>
    );
}

function SoundTile({ sound }: { sound: SoundItem; }) {
    const connection = useVoiceCord(s => s.connection);
    const previewSrc = useVoiceCord(s => s.previewSrc);
    const unadjusted = useVoiceCord(s => s.settings.calibration !== null && !s.isVolumeAdjusted(sound.id));
    const isPlaying = useVoiceCord(s => s.voices.some(v => v.kind === "vc" && v.srcId === sound.id));
    const { play, togglePreview, stopPreview } = store.getState();
    const [volumeOpen, setVolumeOpen] = useState(false);
    const ref = useRef<HTMLLIElement>(null);
    const isPreviewing = previewSrc === sound.id;
    const isConnected = connection === "connected";

    // VC へ音を流す操作なので、ページ側のスクリプトの合成クリックでは鳴らさない
    const onPlay = guardTrusted("タイルの再生", () => void play(sound.id));

    return (
        <li
            ref={ref}
            className={SoundClasses.soundButtonWrapper}
            onContextMenu={e => {
                e.preventDefault();
                setVolumeOpen(true);
            }}
        >
            <Popout
                position="right"
                align="center"
                shouldShow={volumeOpen}
                onRequestClose={() => {
                    setVolumeOpen(false);
                    if (isPreviewing) stopPreview();
                }}
                targetElementRef={ref}
                renderPopout={() => <VolumeBody sound={sound} />}
            >
                {() => (
                    <div
                        role="button"
                        tabIndex={0}
                        aria-label={`${sound.id}をプレイする`}
                        aria-disabled={!isConnected}
                        title={isConnected ? sound.name : "VC未接続のため再生できません（右クリックで試聴・音量調節）"}
                        className={classes(SoundClasses.soundButton, SoundClasses.soundButtonInteractive, isPlaying && SoundClasses.playing, !isConnected && "vc-voicecord-dim")}
                        onClick={e => {
                            if (e.target !== e.currentTarget && (e.target as HTMLElement).closest("[data-secondary]")) return;
                            onPlay(e);
                        }}
                        onKeyDown={e => {
                            if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                // キーボードの操作はブラウザ自身が作るので信頼できる
                                void play(sound.id);
                            }
                        }}
                    >
                        <div className={SoundClasses.soundInfo}>
                            {unadjusted && <WarningIcon size={14} className="vc-voicecord-warn" />}
                            {isPreviewing && <HeadphonesIcon size={14} className="vc-voicecord-accent" />}
                            <DiscordText variant="body-xs/medium" className={SoundClasses.soundName} lineClamp={1}>{sound.id}</DiscordText>
                        </div>
                        {/* 純正と同じく、中央は再生の印。試聴と音量は左右の操作に分ける */}
                        <div className={SoundClasses.buttonOverlay}>
                            <div className={SoundClasses.buttonOverlayBackground} />
                            <div className={SoundClasses.buttonOverlayActions}>
                                <div
                                    data-secondary
                                    role="button"
                                    tabIndex={0}
                                    aria-label={isPreviewing ? `${sound.id}の試聴を停止` : `${sound.id}を試聴`}
                                    className={SoundClasses.secondaryButton}
                                    onClick={() => togglePreview(sound.id)}
                                >
                                    {isPreviewing ? <StopIcon size={16} className={SoundClasses.secondaryIcon} /> : <HeadphonesIcon size={16} className={SoundClasses.secondaryIcon} />}
                                </div>
                                <PlayIcon size={16} className={SoundClasses.primaryIcon} />
                                <div
                                    data-secondary
                                    role="button"
                                    tabIndex={0}
                                    aria-label={`${sound.id}の音量設定`}
                                    className={SoundClasses.secondaryButton}
                                    onClick={() => setVolumeOpen(v => !v)}
                                >
                                    <SlidersIcon size={16} className={SoundClasses.secondaryIcon} />
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </Popout>
        </li>
    );
}

// 全音源を保存済みの基準へ揃える（手で決めた音量も上書きする）。VC へ音を流さない操作なので guardTrusted は付けない
function NormalizeButton() {
    const count = useVoiceCord(s => s.sounds.length);
    const job = useVoiceCord(s => s.normalizeJob);
    const label = job ? `音量を揃えています（${job.done}/${job.total}）` : count === 0 ? "音源がありません" : "すべての音源の音量を揃える";
    return (
        <Tooltip text={label}>
            {p => (
                <div {...p}>
                    <Btn variant="secondary" size="sm" label={label} disabled={job !== null || count === 0} onClick={() => void store.getState().normalizeAll()}>
                        <SoundIcon size={14} />
                        {job ? <Mono>{job.done}/{job.total}</Mono> : "揃える"}
                    </Btn>
                </div>
            )}
        </Tooltip>
    );
}

// mod 自身の不調。平常時は出さない（純正のポップアウトに無い帯を常設しない）
function StatusNotice({ onOpenSettings }: { onOpenSettings: () => void; }) {
    const status = useEngineStatus();
    const krispHint = useVoiceCord(s => s.krispHint && s.connection === "waiting");
    const problems = status ? statusProblems(status) : [];
    // 既存の問題があればそちらを先に出す（エンジンが動いていなければ Krisp の設定以前の話）
    const issue = status && (status.engine !== "attached" || problems.length > 0) ? (problems[0] ?? DOT_LABEL[status.engine]) : null;
    const text = issue ?? (krispHint ? KRISP_HINT : null);
    if (text === null) return null;
    return (
        <button type="button" className="vc-voicecord-band" onClick={onOpenSettings} title={text}>
            <WarningIcon size={14} />
            <DiscordText variant="body-xs/medium" lineClamp={1} className="vc-voicecord-grow">VoiceCord: {text}</DiscordText>
            <DiscordText variant="body-xs/semibold">詳細</DiscordText>
        </button>
    );
}

function MainView({ onOpenSettings }: { onOpenSettings: () => void; }) {
    const sounds = useVoiceCord(s => s.sounds);
    const folder = useVoiceCord(s => s.folder);
    const search = useVoiceCord(s => s.search);
    const { setSearch, chooseFolder, reload, stopAll } = store.getState();
    const filtered = useMemo(() => sounds.filter(s => s.id.toLowerCase().includes(search.toLowerCase())), [sounds, search]);

    return (
        <>
            <div className="vc-voicecord-header">
                <div className="vc-voicecord-grow">
                    <DiscordSearchBar query={search} onChange={setSearch} onClear={() => setSearch("")} placeholder="サウンドを検索" aria-label="サウンドを検索" />
                </div>
                <IconButton label="VoiceCord の設定" onClick={onOpenSettings}><CogWheel width={20} height={20} /></IconButton>
            </div>
            <StatusNotice onOpenSettings={onOpenSettings} />
            <ScrollerThin className="vc-voicecord-scroller">
                <div className={SectionClasses.sectionContainer}>
                    <div className={classes(SectionClasses.sectionHeader, "vc-voicecord-section-header")}>
                        <div className={SectionClasses.sectionHeaderContent}>
                            <DiscordText variant="body-sm/semibold" tag="h1" className={SectionClasses.sectionTitle}>
                                {folder ? folderName(folder) : "フォルダ未選択"}
                            </DiscordText>
                        </div>
                        <Small><Mono>{filtered.length}/{sounds.length}</Mono></Small>
                        <span className="vc-voicecord-grow" />
                        <IconButton label="サウンドフォルダを選択" onClick={() => void chooseFolder()}><FolderIcon width={16} height={16} /></IconButton>
                        <IconButton label="サウンド一覧を再読込" onClick={() => void reload()}><RestartIcon width={16} height={16} /></IconButton>
                    </div>
                </div>
                {/* 「検索で 0 件」と「フォルダに音源が無い」は原因も次の行動も違うので分ける */}
                {sounds.length === 0 ? (
                    <div className="vc-voicecord-empty">
                        <DiscordText variant="body-md/medium">このフォルダにサウンドがありません</DiscordText>
                        <Small><Mono>{folder || "（フォルダが選ばれていません）"}</Mono></Small>
                        <Small>wav / mp3 / ogg などの音声ファイルをこのフォルダに置くか、別のフォルダを選んでください。</Small>
                        <Btn size="sm" onClick={() => void chooseFolder()}>サウンドフォルダを選ぶ</Btn>
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="vc-voicecord-empty">
                        <DiscordText variant="body-md/medium">「{search}」に一致するサウンドがありません</DiscordText>
                        <Btn size="sm" variant="secondary" onClick={() => setSearch("")}>検索を消す</Btn>
                    </div>
                ) : rowsOf(filtered).map(row => (
                    <ul key={row[0].id} className={SectionClasses.soundRow} aria-label="サウンド">
                        {row.map(sound => <SoundTile key={sound.id} sound={sound} />)}
                    </ul>
                ))}
            </ScrollerThin>
            <div className="vc-voicecord-footer">
                <MasterFader className="vc-voicecord-grow" />
                <NormalizeButton />
                <Btn variant="danger" size="sm" onClick={stopAll}><StopIcon size={14} />全停止</Btn>
            </div>
        </>
    );
}

function StatusSection() {
    const status = useEngineStatus();
    const connection = useVoiceCord(s => s.connection);
    const detail = useVoiceCord(s => s.connectionDetail);
    const krispHint = useVoiceCord(s => s.krispHint && s.connection === "waiting");
    const problems = status ? statusProblems(status) : [];
    // 普段は見ない診断なので畳むが、不具合があるときは開いておく（畳んだ中に隠さない）
    const hasIssue = problems.length > 0 || krispHint || !state.buttonSeen;
    const issueKey = hasIssue ? JSON.stringify([problems, krispHint, state.buttonSeen]) : "";
    const [expanded, setExpanded] = useState(hasIssue);
    useEffect(() => {
        if (issueKey !== "") setExpanded(true);
    }, [issueKey]);

    const rows: [string, string][] = [];
    if (status) {
        rows.push(["エンジン", DOT_LABEL[status.engine]]);
        rows.push(["ビルド", `${status.discordBuild} ${status.discordVersion}`]);
        rows.push(["注入先", status.attachedPid === null ? "未検出" : `PID ${status.attachedPid}`]);
        rows.push(["エンジン PID", status.enginePid === null ? "起動していません" : String(status.enginePid)]);
        rows.push(["注入レート", status.sampleRate === null ? "未計測" : `${status.sampleRate} Hz（${status.frameSamples ?? "?"} サンプル）`]);
    }
    if (krispHint) rows.push(["VC 検出", "Krisp の処理を検出できません（ノイズ抑制を Krisp にし、ミュートを解除）"]);
    rows.push(["ボタン", state.buttonSeen ? "音声パネル（サウンドボードの隣）" : "未表示（VC に入ると音声パネルに出ます。出ない場合は画面右下の予備ボタン）"]);

    return (
        <section aria-label="接続状態">
            <SectionTitle>接続状態</SectionTitle>
            <div className="vc-voicecord-spread">
                <div className="vc-voicecord-inline">
                    <span className={classes("vc-voicecord-dot", `vc-voicecord-conn-${connection}`)} />
                    <DiscordText variant="body-sm/medium">{CONNECTION[connection]}</DiscordText>
                    <Small><Mono>{detail}</Mono></Small>
                </div>
                <Btn variant="secondary" size="sm" onClick={() => setExpanded(v => !v)}>{expanded ? "閉じる" : "詳細"}</Btn>
            </div>
            {expanded && (
                <>
                    <dl className="vc-voicecord-dl">
                        {rows.map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}
                    </dl>
                    {problems.length > 0 && <div className="vc-voicecord-problems">{problems.join("\n")}</div>}
                </>
            )}
        </section>
    );
}

function SettingsView({ onBack }: { onBack: () => void; }) {
    const folder = useVoiceCord(s => s.folder);
    const sounds = useVoiceCord(s => s.sounds);
    const entryEnabled = useVoiceCord(s => s.settings.entrySoundEnabled);
    const hideCamera = useVoiceCord(s => s.settings.hideCameraButton);
    const unlockSoundboard = useVoiceCord(s => s.settings.unlockSoundboard);
    const entrySrcId = useVoiceCord(s => s.settings.entrySoundSrcId);
    const { patchSettings: patch, chooseFolder, reload } = store.getState();
    // 有効でも音源が未選択・見つからなければ鳴らないので、スイッチとは別に説明で伝える
    const entryDescription = entrySrcId === "" ? "サウンドが未選択のため鳴りません"
        : !sounds.some(s => s.id === entrySrcId) ? `「${entrySrcId}」が見つかりません（ファイルが移動・削除された可能性）`
            : entrySrcId;

    return (
        <>
            <div className="vc-voicecord-header">
                <IconButton label="サウンドボードに戻る" onClick={onBack}><BackIcon size={20} /></IconButton>
                <DiscordText variant="body-md/semibold" tag="h2">VoiceCord の設定</DiscordText>
            </div>
            {/* 純正の設定と同じく、よく触るものから順に並べる。診断は普段見ないので最後に畳んで置く */}
            <ScrollerThin className="vc-voicecord-scroller vc-voicecord-settings">
                <VolumeSection />
                <MonitorSection />
                <section aria-label="入場サウンド">
                    <SectionTitle>入場サウンド</SectionTitle>
                    <FormSwitch title="VC に入ったら自動で鳴らす" description={entryDescription} value={entryEnabled} onChange={v => patch({ entrySoundEnabled: v })} />
                    <Row label="入場サウンドの設定" description="鳴らす音源・音量・タイミングを選びます" control={<Btn variant="secondary" size="sm" onClick={openEntrySoundModal}>設定</Btn>} />
                </section>
                <section aria-label="サウンドフォルダ">
                    <SectionTitle>サウンドフォルダ</SectionTitle>
                    <Row
                        label={folder ? folderName(folder) : "フォルダ未選択"}
                        description={folder ? <Mono className="vc-voicecord-break">{folder}</Mono> : undefined}
                        control={<>
                            <Btn variant="secondary" size="sm" onClick={() => void chooseFolder()}>選ぶ</Btn>
                            <Btn variant="secondary" size="sm" onClick={() => void reload()}>再読込</Btn>
                        </>}
                    />
                </section>
                <section aria-label="表示">
                    <SectionTitle>表示</SectionTitle>
                    <FormSwitch
                        title="ビデオボタンを隠す"
                        description="音声パネルのビデオボタンを隠し、VoiceCord のボタンを純正のボタンと同じ幅で並べます"
                        value={hideCamera}
                        onChange={v => patch({ hideCameraButton: v })}
                    />
                </section>
                <section aria-label="サウンドボード">
                    <SectionTitle>サウンドボード</SectionTitle>
                    <FormSwitch
                        title="ほかのサーバーのサウンドを VoiceCord で鳴らす"
                        description="Nitro が必要なサウンドをクリックしたとき、音声を取得して VoiceCord から再生します。サーバーの管理者が外部のサウンドを禁止している場合も鳴ります。Discord の利用規約に反する可能性があります"
                        value={unlockSoundboard}
                        onChange={v => patch({ unlockSoundboard: v })}
                    />
                </section>
                <StatusSection />
            </ScrollerThin>
        </>
    );
}

export function SoundboardPopout() {
    // 閉じたら次に開いたときはサウンドの一覧から始める（純正と同じ）。ポップアウトごと作り直されるので状態は持ち越さない
    const [view, setView] = useState<"main" | "settings">("main");
    return (
        <div className={classes(PickerClasses.picker, "vc-voicecord-picker")} role="dialog" aria-label="VoiceCord サウンドボード">
            {view === "main"
                ? <MainView onOpenSettings={() => setView("settings")} />
                : <SettingsView onBack={() => setView("main")} />}
        </div>
    );
}
