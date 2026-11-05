/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { FormSwitch } from "@components/FormSwitch";
import { currentTargetDb, recommendMasterDb, voiceMatchDb } from "@plugins/voiceCord.discordDesktop/lib/calibration";
import { fmtDb, toDb } from "@plugins/voiceCord.discordDesktop/lib/db";
import { store } from "@plugins/voiceCord.discordDesktop/store";
import { useVoiceCord } from "@plugins/voiceCord.discordDesktop/useVoiceCord";
import { Select } from "@webpack/common";

import { GaugeIcon } from "./icons";
import { Btn, Mono, Row, SectionTitle, VSlider } from "./ui";

// 設定画面のうち、送信音量とモニターの節（voicecord-module の SettingsSections 由来）

export function VolumeSection() {
    const settings = useVoiceCord(s => s.settings);
    const { setLevelOpen, applyMasterDb } = store.getState();

    const cal = settings.calibration;
    const masterDb = toDb(settings.master);
    const matchDb = cal ? voiceMatchDb(cal.voiceRms, settings.normalizeRefDbfs) : null;
    const diffDb = matchDb !== null && Number.isFinite(masterDb) ? currentTargetDb(masterDb, matchDb) : null;
    // 声とぴったり一致させる送信音量。既に一致していれば行を出さない
    const restoreDb = cal && matchDb !== null && diffDb !== null && Math.abs(diffDb) >= 0.05
        ? recommendMasterDb(cal.voiceRms, settings.normalizeRefDbfs, 0).db
        : null;

    return (
        <section aria-label="音量">
            <SectionTitle>音量</SectionTitle>
            {/* 未校正のときは「声との差」の数値を出さない（測っていない段階の ±0.0 dB は「調整済み」に見えてしまう） */}
            <Row
                label="声の大きさに合わせる"
                description={cal
                    ? <>声との差 <Mono className={diffDb !== null && Math.abs(diffDb) < 0.05 ? "vc-voicecord-ok" : "vc-voicecord-accent"}>{fmtDb(diffDb ?? masterDb)}</Mono></>
                    : "まだ声を測っていません。効果音が相手にどの大きさで届くかは未調整です"}
                control={
                    // 未校正のときだけ塗りで示す（自分のモニターだけでは声とのバランスを確かめられないため）
                    <Btn size="sm" variant={cal ? "secondary" : "primary"} onClick={() => setLevelOpen(true)}>
                        <GaugeIcon size={14} />
                        {cal ? "音量調整を開く" : "音量を調整"}
                    </Btn>
                }
            />
            {restoreDb !== null && (
                <Row
                    label="声と同じ大きさに戻す"
                    control={<Btn size="sm" variant="secondary" label="声と同じ大きさに戻す" onClick={() => applyMasterDb(restoreDb, 0)}>戻す</Btn>}
                />
            )}
        </section>
    );
}

export function MonitorSection() {
    const settings = useVoiceCord(s => s.settings);
    const devices = useVoiceCord(s => s.devices);
    const { patchSettings: patch } = store.getState();
    const options = [{ label: "既定デバイス", value: "" }, ...devices.map(d => ({ label: d.label, value: d.id }))];

    return (
        <section aria-label="モニター">
            <SectionTitle>モニター</SectionTitle>
            <FormSwitch
                title="自分の端末でも聴く"
                description="効果音を自分の出力デバイスでも鳴らします。相手に届く音は変わりません"
                value={settings.sidetoneEnabled}
                onChange={v => patch({ sidetoneEnabled: v })}
            />
            {/* 出力デバイスと音量は試聴にも使うので、モニターが OFF でも操作できるままにする */}
            <Row label="出力デバイス" description="モニターと試聴の出力先です。モニターが OFF でも試聴に使います">
                <Select
                    options={options}
                    isSelected={v => v === settings.sidetoneDevice}
                    select={v => patch({ sidetoneDevice: v })}
                    serialize={String}
                    closeOnSelect
                />
            </Row>
            <Row label="モニター音量" description="モニターと試聴の音量です。モニターが OFF でも試聴に効きます。相手に届く音量は変わりません">
                <VSlider
                    label="モニター音量"
                    value={Math.round(settings.sidetoneVolume * 100)}
                    min={0}
                    max={100}
                    render={v => `${v}%`}
                    onChange={v => patch({ sidetoneVolume: v / 100 })}
                />
            </Row>
        </section>
    );
}
