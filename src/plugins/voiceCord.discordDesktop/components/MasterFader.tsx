/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { currentTargetDb, targetRange, voiceMatchDb } from "@plugins/voiceCord.discordDesktop/lib/calibration";
import { fmtDb, MASTER_MAX_DB, MASTER_MIN_DB, toDb, toLinear } from "@plugins/voiceCord.discordDesktop/lib/db";
import { store } from "@plugins/voiceCord.discordDesktop/store";
import { useVoiceCord } from "@plugins/voiceCord.discordDesktop/useVoiceCord";
import { classes } from "@utils/misc";
import { Tooltip } from "@webpack/common";

import { VolumeIcon } from "./icons";
import { Btn, Mono, Small, VSlider } from "./ui";

// 全体音量のフェーダー（voicecord-module の MasterFader 由来）。
// 校正済みなら「効果音が声と同じ大きさで届く点」を 0 dB とする相対フェーダーにする。
// 原点は clamp しない voiceMatchDb を使う（設定画面の表示と食い違わないように）
export function MasterFader({ className }: { className?: string; }) {
    const settings = useVoiceCord(s => s.settings);
    const { setMaster, setMasterLive, setLevelOpen, saveCalibration } = store.getState();
    const cal = settings.calibration;
    const masterDb = toDb(settings.master);
    const matchDb = cal ? voiceMatchDb(cal.voiceRms, settings.normalizeRefDbfs) : null;
    const range = matchDb !== null ? targetRange(matchDb) : null;
    const rel = matchDb !== null && range !== null;
    const faderMin = rel ? range.min : MASTER_MIN_DB;
    const faderMax = rel ? range.max : MASTER_MAX_DB;
    const faderValue = rel ? currentTargetDb(masterDb, matchDb) : masterDb;
    const shownValue = Number.isFinite(faderValue) ? Math.min(faderMax, Math.max(faderMin, faderValue)) : faderMin;
    const toMaster = (v: number) => toLinear(rel ? matchDb + v : v);

    const tip = rel
        ? "効果音を自分の声より何 dB 大きく／小さく相手へ届けるか。0 dB で声と同じ大きさです。試聴やモニターで自分に聞こえる音にも同じだけ掛かります。"
        : "送信ゲイン — 相手に聞こえる音量です（試聴やモニターにも掛かります）。音量調整で声を測ると「声との差」で調整できるようになります。";

    // 下端の帯に 1 行で収める。見出しは置かず、名前と説明はツールチップと値に持たせる
    return (
        <div className={classes("vc-voicecord-fader", className)}>
            <div className="vc-voicecord-fader-row">
                <Tooltip text="声とのバランスを測って、送信音量と音源ごとの音量を調整します">
                    {p => (
                        <div {...p}>
                            <Btn variant="ghost" size="icon" label="音量調整を開く" onClick={() => setLevelOpen(true)}>
                                <VolumeIcon />
                            </Btn>
                        </div>
                    )}
                </Tooltip>
                <VSlider
                    className="vc-voicecord-grow"
                    label={rel ? "全体音量（声との差）" : "全体音量"}
                    value={shownValue}
                    min={faderMin}
                    max={faderMax}
                    step={0.5}
                    markers={rel ? [0] : undefined}
                    render={fmtDb}
                    compact
                    // ドラッグ中は音だけ変え、保存は指を離したとき（config.json への書き込みを抑える）
                    onChange={v => setMasterLive(toMaster(v))}
                    onCommit={v => {
                        setMaster(toMaster(v));
                        // 相対モードでは校正の記録側にも書き戻す。ズレたままだと基準が変わったときの再計算で手動調整が巻き戻る
                        if (rel && cal) saveCalibration({ ...cal, targetDb: v });
                    }}
                />
                <Tooltip text={tip}>
                    {p => (
                        <div {...p} className="vc-voicecord-fader-value" aria-label={rel ? "全体音量（声との差）" : "全体音量（未校正）"}>
                            <Small className={faderValue > 0.05 ? "vc-voicecord-warn" : undefined}><Mono>{fmtDb(faderValue)}</Mono></Small>
                        </div>
                    )}
                </Tooltip>
            </div>
        </div>
    );
}
