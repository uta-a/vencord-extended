/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 uta-a
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { spawn } from "child_process";
import { IpcMainInvokeEvent } from "electron";
import { mkdtemp, readFile, rm, stat, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const AUDIO_KBPS = 96;
const MAX_ATTEMPTS = 3;
const TIMEOUT_MS = 180_000;

function run(ffmpegPath: string, args: string[], timeoutMs: number) {
    const { promise, resolve, reject } = Promise.withResolvers<{ code: number | null; stderr: string }>();
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = "";
    const timer = setTimeout(() => {
        child.kill();
        reject(new Error("ffmpeg timed out"));
    }, timeoutMs);
    child.stderr.on("data", d => stderr += d.toString());
    child.on("error", e => {
        clearTimeout(timer);
        reject(e);
    });
    child.on("close", code => {
        clearTimeout(timer);
        resolve({ code, stderr });
    });
    return promise;
}

async function getDurationSeconds(ffmpegPath: string, file: string) {
    const { code, stderr } = await run(ffmpegPath, ["-i", file], 30_000);
    const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (!m) throw new Error(`failed to read clip duration (ffmpeg exit code ${code})`);
    return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
}

export async function compressVideo(
    e: IpcMainInvokeEvent,
    ffmpegPath: string,
    data: ArrayBuffer,
    targetBytes: number
): Promise<ArrayBuffer> {
    const dir = await mkdtemp(join(tmpdir(), "openclip-"));
    try {
        const input = join(dir, "in.mp4");
        const output = join(dir, "out.mp4");
        await writeFile(input, Buffer.from(data));

        const duration = await getDurationSeconds(ffmpegPath, input);
        let videoKbps = Math.floor(targetBytes * 8 / duration / 1000 * 0.92) - AUDIO_KBPS;
        if (videoKbps < 1) throw new Error("clip is too long to fit under the upload limit");

        let outputSize = Infinity;
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            const args = ["-y", "-i", input, "-c:v", "libx264", "-preset", "veryfast",
                "-b:v", `${videoKbps}k`, "-maxrate", `${videoKbps * 2}k`, "-bufsize", `${videoKbps * 4}k`];
            if (videoKbps < 600) args.push("-vf", "scale=-2:480");
            else if (videoKbps < 1500) args.push("-vf", "scale=-2:720");
            args.push("-c:a", "aac", "-b:a", `${AUDIO_KBPS}k`, "-movflags", "+faststart", output);

            const { code, stderr } = await run(ffmpegPath, args, TIMEOUT_MS);
            if (code !== 0) throw new Error(`ffmpeg failed: ${stderr.slice(-300).trim()}`);

            outputSize = (await stat(output)).size;
            if (outputSize <= targetBytes) break;
            videoKbps = Math.max(1, Math.floor(videoKbps * (targetBytes / outputSize) * 0.9));
        }

        if (outputSize > targetBytes) throw new Error(`compression could only reach ${Math.round(outputSize / 1048576)} MB`);

        const bytes = await readFile(output);
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    } finally {
        rm(dir, { recursive: true, force: true }).catch(() => { });
    }
}
