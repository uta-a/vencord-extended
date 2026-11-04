/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { EngineState, VoiceCordEvent } from "../../../voicecord/shared/ipc.js";

/**
 * VC 在席（hook.js の vc 通知）を main 側でも覚えておくための判定。
 *
 * hook.js は vc を「変化したときだけ」送る。UI を再読み込み（Ctrl+R）すると engine と hook は
 * 生きたままなので vc は再送されず、renderer は在席を知る手段を失って「VC待機中」のまま固まる。
 * main が最後の値を status に持っておき、attach の結果として返せるようにする。
 */

/** main → renderer へ流すイベントを見て、次の vcActive を決める */
export function nextVcActive(prev: boolean, e: VoiceCordEvent): boolean {
  if (e.ev !== "engine") return prev;
  const p = e.payload;
  if (p.ev === "vc") return p.active === true;
  // どちらも hook が消えていて、vc:false は二度と来ない
  if (p.ev === "detached" || p.ev === "engineLost") return false;
  return prev;
}

/** 再生中の voiceId の一覧を、エンジンのイベントで更新する。変化が無ければ同じ配列を返す */
export function nextPlaying(prev: string[], e: VoiceCordEvent): string[] {
  if (e.ev !== "engine") return prev;
  const p = e.payload;
  if (p.ev === "voiceEnded" || p.ev === "playRejected") return prev.filter(v => v !== p.voiceId);
  if (p.ev === "detached" || p.ev === "engineLost") return prev.length ? [] : prev;
  return prev;
}

/** エンジンの状態が変わったときの vcActive。attach していなければ在席していない */
export function vcActiveForState(state: EngineState, prev: boolean): boolean {
  return state === "attached" ? prev : false;
}
