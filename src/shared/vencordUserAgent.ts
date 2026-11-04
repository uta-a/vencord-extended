/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import gitHash from "~git-hash";
import gitRemote from "~git-remote";

export { gitHash, gitRemote };

// vencord-extended: 非公式 fork であることを User-Agent で名乗る
export const VENCORD_USER_AGENT = `VencordExtended/${gitHash}${gitRemote ? ` (https://github.com/${gitRemote})` : ""}`;
