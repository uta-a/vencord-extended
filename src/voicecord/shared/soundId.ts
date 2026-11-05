/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * サウンドフォルダの音源の ID。
 *
 * ID は音源別音量（sourceVolumes）のキーであり、入場サウンドの指定でもある。複数のフォルダに
 * 同じ名前のファイルがあってもぶつからないよう、「フォルダの鍵 | フォルダ内の名前」にする。
 * フォルダを外したり並べ替えたりしても、ほかのフォルダの ID は変わらない。
 *
 * 区切りの `|` は Windows のパスにもファイル名にも使えない文字なので、取り違えない。
 * サウンドボードの音（`sb:数字`）とは、鍵がドライブ名から始まるので重ならない。
 */

const SEP = "|";

/** フォルダの鍵。区切りをスラッシュにそろえ、末尾の区切りを落とし、小文字にする（Windows は大文字小文字を区別しない） */
export function folderKey(folder: string): string {
  return folder.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function makeSoundId(folder: string, label: string): string {
  return `${folderKey(folder)}${SEP}${label}`;
}

/** 表示用の名前（フォルダ内の名前）。区切りが無い ID（サウンドボードの音や旧形式）はそのまま返す */
export function soundIdLabel(id: string): string {
  return id.slice(id.lastIndexOf(SEP) + 1);
}

/**
 * 単一フォルダの時代の ID（フォルダ内の名前だけ）を、そのフォルダの ID に直す。
 * すでに新しい形のものと、サウンドボードの音（`sb:`）はそのまま返す
 */
export function migrateLegacySoundId(id: string, folder: string): string {
  if (id === "" || id.includes(SEP) || id.startsWith("sb:")) return id;
  return makeSoundId(folder, id);
}
