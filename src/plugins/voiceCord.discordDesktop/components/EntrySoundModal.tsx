/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { FormSwitch } from "@components/FormSwitch";
import { store } from "@plugins/voiceCord.discordDesktop/store";
import { useVoiceCord } from "@plugins/voiceCord.discordDesktop/useVoiceCord";
import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal, ScrollerThin, showToast, useMemo, useState } from "@webpack/common";

import { DiscordSearchBar, DiscordText } from "./discord";
import { CheckIcon, HeadphonesIcon, StopIcon } from "./icons";
import { Btn, Mono, Small, VSlider } from "./ui";

// 入場サウンドの設定（voicecord-module の EntrySoundDialog 由来）

function Field({ label, value, children, note }: { label: string; value: string; children: React.ReactNode; note: string; }) {
    return (
        <div className="vc-voicecord-field">
            <div className="vc-voicecord-spread">
                <DiscordText variant="body-sm/medium">{label}</DiscordText>
                <Small><Mono>{value}</Mono></Small>
            </div>
            {children}
            <Small>{note}</Small>
        </div>
    );
}

function EntrySoundModal({ modalProps }: { modalProps: RenderModalProps; }) {
    const settings = useVoiceCord(s => s.settings);
    const sounds = useVoiceCord(s => s.sounds);
    const previewSrc = useVoiceCord(s => s.previewSrc);
    const { patchSettings: patch, togglePreview, testEntrySound } = store.getState();
    const [query, setQuery] = useState("");

    // ここでの試聴は入場音の音量で鳴らすため、0% だと何も聞こえない。黙って無音にしない
    const warnIfMuted = () => {
        if (settings.entrySoundVolume === 0) showToast({ text: "入場音の音量が 0% です。音が出ていないかもしれません" });
    };

    const filtered = useMemo(() => sounds.filter(s => s.id.toLowerCase().includes(query.toLowerCase())), [sounds, query]);
    const selected = settings.entrySoundSrcId;
    const selectedMissing = selected !== "" && !sounds.some(s => s.id === selected);

    return (
        <Modal
            {...modalProps}
            size="lg"
            title="入場サウンド"
            subtitle="VC に入ったのを検知して、選んだ音を 1 回だけ自動で送信します。"
            actions={[{ text: "閉じる", variant: "secondary", onClick: modalProps.onClose }]}
        >
            <FormSwitch
                title="入場時に自動で鳴らす"
                description={selected === ""
                    ? "サウンドが未選択のため鳴りません"
                    : selectedMissing
                        ? `「${selected}」が見つかりません（ファイルが移動・削除された可能性）`
                        : `現在の音源: ${selected}`}
                value={settings.entrySoundEnabled}
                onChange={v => patch({ entrySoundEnabled: v })}
            />
            <div className="vc-voicecord-entry">
                <div className="vc-voicecord-entry-list">
                    <div className="vc-voicecord-spread">
                        <DiscordText variant="body-sm/medium">音源を選ぶ</DiscordText>
                        <Small><Mono>{filtered.length}/{sounds.length}</Mono></Small>
                    </div>
                    <div className="vc-voicecord-fixed"><DiscordSearchBar query={query} onChange={setQuery} onClear={() => setQuery("")} placeholder="サウンドを検索" aria-label="入場サウンドを検索" /></div>
                    <ScrollerThin className="vc-voicecord-entry-scroller">
                        {filtered.length === 0
                            ? <Small className="vc-voicecord-center">該当するサウンドがありません</Small>
                            : filtered.map(sound => {
                                const isSelected = selected === sound.id;
                                const isPreviewing = previewSrc === sound.id;
                                return (
                                    <div key={sound.id} className="vc-voicecord-entry-item">
                                        <button
                                            type="button"
                                            aria-pressed={isSelected}
                                            title={sound.name}
                                            className={classes("vc-voicecord-entry-pick", isSelected && "vc-voicecord-entry-selected")}
                                            onClick={() => patch({ entrySoundSrcId: sound.id })}
                                        >
                                            <CheckIcon size={14} className={isSelected ? undefined : "vc-voicecord-hidden"} />
                                            <DiscordText variant="body-sm/normal" lineClamp={1}>{sound.id}</DiscordText>
                                        </button>
                                        <Btn
                                            variant="ghost"
                                            size="icon"
                                            label={`${sound.id}を試聴`}
                                            onClick={() => {
                                                if (!isPreviewing) warnIfMuted();
                                                togglePreview(sound.id, settings.entrySoundVolume);
                                            }}
                                        >
                                            {isPreviewing ? <StopIcon size={14} /> : <HeadphonesIcon size={14} />}
                                        </Btn>
                                    </div>
                                );
                            })}
                    </ScrollerThin>
                </div>
                <div className="vc-voicecord-entry-side">
                    <Field label="入場音の音量" value={`${Math.round(settings.entrySoundVolume * 100)}%`} note="音源ごとの音量とは別に持ちます。入場音は自分の声に重ねて 1 回だけ鳴ります。">
                        <VSlider label="入場音の音量" value={Math.round(settings.entrySoundVolume * 100)} min={0} max={150} render={v => `${v}%`} onChange={v => patch({ entrySoundVolume: v / 100 })} />
                    </Field>
                    <Field label="鳴るまでの追加の間" value={`${(settings.entryDelayMs / 1000).toFixed(1)}秒`} note="0 でも送信の準備待ちで最大 1.5 秒ほどかかります。ここはその上に足す間です。">
                        <VSlider label="鳴るまでの追加の間" value={settings.entryDelayMs} min={0} max={3000} step={100} render={v => `${(v / 1000).toFixed(1)}秒`} onChange={v => patch({ entryDelayMs: v })} />
                    </Field>
                    <Field label="退出とみなす時間" value={`${(settings.entryLeaveDebounceMs / 1000).toFixed(1)}秒`} note="短くするとチャンネル移動でも鳴りやすくなりますが、通信の一瞬の途切れでも誤って鳴ることがあります。">
                        <VSlider label="退出とみなす時間" value={settings.entryLeaveDebounceMs} min={1000} max={5000} step={100} render={v => `${(v / 1000).toFixed(1)}秒`} onChange={v => patch({ entryLeaveDebounceMs: v })} />
                    </Field>
                    <Btn
                        variant="secondary"
                        size="sm"
                        grow
                        disabled={selected === "" || selectedMissing}
                        onClick={() => {
                            if (previewSrc !== selected) warnIfMuted();
                            testEntrySound();
                        }}
                    >
                        {previewSrc === selected && selected !== ""
                            ? <><StopIcon size={14} />テストを停止</>
                            : <><HeadphonesIcon size={14} />この端末でテスト再生</>}
                    </Btn>
                    {/* テストは Web Audio のローカル再生で、送信音量とモニター音量まで掛かる。
                        相手側と絶対値が違うのは送信ヘッドルーム（約 -12 dB）とゲート待ちの分だけ */}
                    <Small>
                        テストはこの端末だけで鳴ります。送信音量とモニター音量はテストにも掛かりますが、実際の入場時はさらに送信ヘッドルーム（約 -12 dB）が掛かり、送信の準備が整うまでの待ちも入るため、絶対的な音量とタイミングはここでの確認と異なります。
                    </Small>
                </div>
            </div>
        </Modal>
    );
}

// openModal で直接描くので、起点のボタンの ErrorBoundary では守られない。モーダルごと包む
const SafeEntrySoundModal = ErrorBoundary.wrap(EntrySoundModal, { noop: false });

export function openEntrySoundModal() {
    // 閉じたら試聴を止める。画面を閉じた後も鳴り続けると、止める手段が分かりにくい
    openModal(props => <SafeEntrySoundModal modalProps={props} />, { onCloseCallback: () => store.getState().stopPreview() });
}
