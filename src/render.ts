// Browser-only: mux a music bed under a short and (optionally) burn in a caption.
// Reuses the shared ffmpeg.wasm instance from video-burnin.ts. Music can be a
// synthesized preset bed (see farm-music.ts) or an uploaded track's bytes.

import { getFFmpeg, probeVideo, fetchFile } from "./ffmpeg";

export type AudioMode = "mix" | "replace";

export type RenderOptions = {
  music: Uint8Array;          // audio bytes (wav/mp3/m4a…)
  musicExt: string;           // extension for the music file, e.g. "wav"
  audioMode?: AudioMode;      // mix (duck original under music) | replace. Default "mix".
  musicVolume?: number;       // 0..1, default 0.8
  captionText?: string | null; // when set, burned onto the lower third
  onProgress?: (ratio: number) => void;
};

/** Word-wrap + render a caption plate as a transparent PNG the width of the video. */
async function buildCaptionOverlay(opts: {
  text: string;
  videoWidth: number;
  videoHeight: number;
}): Promise<{ png: Uint8Array; height: number }> {
  const { text, videoWidth, videoHeight } = opts;
  // Compact caption strip sized to the text (not the full frame) so it reads as
  // a subtitle chip near the bottom and leaves the video mostly unobscured.
  const fontSize = Math.max(20, Math.round(videoHeight * 0.040));
  const lineH = Math.round(fontSize * 1.28);
  const padX = Math.round(fontSize * 0.9);
  const padY = Math.round(fontSize * 0.55);
  const maxChipW = Math.round(videoWidth * 0.92);
  const maxTextW = maxChipW - padX * 2;

  const measure = document.createElement("canvas").getContext("2d")!;
  const font = `700 ${fontSize}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  measure.font = font;

  // Greedy word wrap.
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (measure.measureText(test).width > maxTextW && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  // Keep it to 3 lines max; if it overflows, trim and add an ellipsis.
  let shown = lines.slice(0, 3);
  if (lines.length > 3) {
    let last = shown[2];
    while (last && measure.measureText(last + "…").width > maxTextW) {
      last = last.replace(/\s*\S+$/, "");
    }
    shown[2] = (last || shown[2]) + "…";
  }

  const textW = Math.max(...shown.map((l) => Math.ceil(measure.measureText(l).width)), 1);
  const chipW = Math.min(maxChipW, textW + padX * 2);
  const h = shown.length * lineH + padY * 2;

  const canvas = document.createElement("canvas");
  canvas.width = chipW;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  // Rounded translucent chip.
  const radius = Math.min(Math.round(h * 0.32), Math.round(fontSize * 0.9));
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  if (typeof (ctx as CanvasRenderingContext2D & { roundRect?: unknown }).roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(0, 0, chipW, h, radius);
    ctx.fill();
  } else {
    ctx.fillRect(0, 0, chipW, h);
  }

  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = Math.max(3, Math.round(fontSize / 7));
  ctx.strokeStyle = "rgba(0,0,0,0.9)";
  ctx.fillStyle = "#ffffff";
  shown.forEach((line, i) => {
    const y = padY + i * lineH + lineH / 2;
    ctx.strokeText(line, chipW / 2, y);
    ctx.fillText(line, chipW / 2, y);
  });

  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"),
  );
  return { png: new Uint8Array(await blob.arrayBuffer()), height: h };
}

function inputExt(name: string): string {
  const m = name.toLowerCase().match(/\.(mp4|mov|m4v|webm|mkv|avi|3gp|3g2|mts|m2ts|ts)$/);
  return m ? m[1] : "mp4";
}

/**
 * Render the final short: music bed under the clip, optional caption burn-in.
 * Returns an MP4 (H.264 + AAC). Audio is looped/trimmed to the video length.
 */
export async function renderShort(file: File | Blob, opts: RenderOptions): Promise<Blob> {
  const ff = await getFFmpeg();
  const asFile =
    file instanceof File ? file : new File([file], "in.mp4", { type: "video/mp4" });
  const probe = await probeVideo(asFile);
  const w = probe.width ?? 1080;
  const h = probe.height ?? 1920;
  const vol = Math.min(1, Math.max(0, opts.musicVolume ?? 0.8));
  const mode = opts.audioMode ?? "mix";

  const inExt = inputExt(asFile.name);
  const inName = `src.${inExt}`;
  const musName = `music.${opts.musicExt || "wav"}`;
  await ff.writeFile(inName, await fetchFile(asFile));
  await ff.writeFile(musName, opts.music);

  let overlayH = 0;
  const hasCaption = !!opts.captionText && opts.captionText.trim().length > 0;
  if (hasCaption) {
    const { png, height } = await buildCaptionOverlay({
      text: opts.captionText!.trim(),
      videoWidth: w,
      videoHeight: h,
    });
    await ff.writeFile("caption.png", png);
    overlayH = height;
  }

  let log = "";
  const logCollector = ({ message }: { message: string }) => { log += message + "\n"; };
  const progressHandler = ({ progress }: { progress: number }) => {
    if (opts.onProgress) opts.onProgress(progress);
  };
  ff.on("log", logCollector);
  ff.on("progress", progressHandler);

  // Anchor the caption chip near the very bottom (≈6% up), centered, so the
  // main subject stays clear. `H`/`h` are ffmpeg's main/overlay heights.
  void overlayH;
  const overlayY = `H-h-${Math.round(h * 0.06)}`;

  // Loop the music so short beds cover long clips; -shortest trims to the video.
  // audioMode "mix" ducks the clip's own audio under the bed; "replace" drops it.
  const buildArgs = (withClipAudio: boolean): string[] => {
    const filters: string[] = [];
    // Video branch (+ optional caption overlay).
    if (hasCaption) {
      filters.push(`[0:v][2:v]overlay=(W-w)/2:${overlayY}:format=auto[v]`);
    }
    // Audio branch.
    if (mode === "mix" && withClipAudio) {
      filters.push(
        `[1:a]volume=${vol}[m];[0:a]volume=0.9[o];[o][m]amix=inputs=2:duration=first:dropout_transition=0[a]`,
      );
    } else {
      filters.push(`[1:a]volume=${vol}[a]`);
    }
    const args = ["-i", inName, "-stream_loop", "-1", "-i", musName];
    if (hasCaption) args.push("-i", "caption.png");
    args.push("-filter_complex", filters.join(";"));
    args.push("-map", hasCaption ? "[v]" : "0:v:0");
    args.push("-map", "[a]");
    args.push(
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "22",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "160k",
      "-shortest",
      "-movflags", "+faststart",
      "out.mp4",
    );
    return args;
  };

  let ok = false;
  try {
    try {
      // Assume the clip has usable audio → mix.
      await ff.exec(buildArgs(true));
      ok = true;
    } catch {
      // Clip had no/odd audio: fall back to music-only.
      try { await ff.deleteFile("out.mp4"); } catch { /* ignore */ }
      await ff.exec(buildArgs(false));
      ok = true;
    }
  } finally {
    ff.off("progress", progressHandler);
    ff.off("log", logCollector);
  }

  if (!ok) {
    const tail = log.split("\n").slice(-12).join("\n");
    throw new Error(`ffmpeg render failed: ${tail || "unknown error"}`);
  }

  const data = (await ff.readFile("out.mp4")) as Uint8Array;
  for (const f of [inName, musName, "caption.png", "out.mp4"]) {
    try { await ff.deleteFile(f); } catch { /* ignore */ }
  }
  return new Blob([data.slice().buffer], { type: "video/mp4" });
}

/** Grab a poster frame (JPEG) from ~1s in, for the queue thumbnail. */
export async function grabPoster(file: File | Blob): Promise<Blob> {
  const ff = await getFFmpeg();
  const asFile =
    file instanceof File ? file : new File([file], "in.mp4", { type: "video/mp4" });
  const inExt = inputExt(asFile.name);
  const inName = `poster.${inExt}`;
  await ff.writeFile(inName, await fetchFile(asFile));
  try {
    await ff.exec(["-ss", "1", "-i", inName, "-frames:v", "1", "-q:v", "4", "poster.jpg"]);
  } catch {
    // Very short clip: grab the first frame instead.
    await ff.exec(["-i", inName, "-frames:v", "1", "-q:v", "4", "poster.jpg"]);
  }
  const data = (await ff.readFile("poster.jpg")) as Uint8Array;
  for (const f of [inName, "poster.jpg"]) {
    try { await ff.deleteFile(f); } catch { /* ignore */ }
  }
  return new Blob([data.slice().buffer], { type: "image/jpeg" });
}

/**
 * Split a clip into fixed-length segments (default 60s). Tries a fast stream
 * copy first; falls back to re-encoding for containers/codecs copy can't
 * segment. Returns the segments in order.
 */
export async function splitIntoSegments(
  file: File | Blob,
  seconds = 60,
): Promise<Blob[]> {
  const ff = await getFFmpeg();
  const asFile = file instanceof File ? file : new File([file], "in.mp4", { type: "video/mp4" });
  const probe = await probeVideo(asFile);
  const dur = probe.durationSec ?? 0;
  const inExt = inputExt(asFile.name);
  const inName = `split_in.${inExt}`;
  await ff.writeFile(inName, await fetchFile(asFile));

  const copyArgs = [
    "-i", inName, "-c", "copy", "-map", "0",
    "-f", "segment", "-segment_time", String(seconds),
    "-reset_timestamps", "1", "seg_%03d.mp4",
  ];
  const encodeArgs = [
    "-i", inName,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k",
    "-f", "segment", "-segment_time", String(seconds),
    "-force_key_frames", `expr:gte(t,n_forced*${seconds})`,
    "-reset_timestamps", "1", "seg_%03d.mp4",
  ];

  try {
    await ff.exec(copyArgs);
  } catch {
    // Clean any partial output, then re-encode.
    for (let i = 0; i < 256; i++) {
      try { await ff.deleteFile(`seg_${String(i).padStart(3, "0")}.mp4`); } catch { break; }
    }
    await ff.exec(encodeArgs);
  }

  const out: Blob[] = [];
  const expected = Math.max(1, Math.ceil((dur || seconds) / seconds)) + 2;
  for (let i = 0; i < expected; i++) {
    const name = `seg_${String(i).padStart(3, "0")}.mp4`;
    try {
      const d = (await ff.readFile(name)) as Uint8Array;
      out.push(new Blob([d.slice().buffer], { type: "video/mp4" }));
      await ff.deleteFile(name);
    } catch {
      break;
    }
  }
  try { await ff.deleteFile(inName); } catch { /* ignore */ }
  return out;
}
