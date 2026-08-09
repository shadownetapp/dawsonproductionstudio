// Shared ffmpeg.wasm instance (single-threaded core, loaded lazily from CDN).
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

const CORE_BASE = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm";

let ffmpegInstance: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

export async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const ff = new FFmpeg();
    try {
      await ff.load({
        coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, "application/wasm"),
      });
      ffmpegInstance = ff;
      return ff;
    } catch (error) {
      loadPromise = null;
      throw new Error(error instanceof Error ? error.message : String(error));
    }
  })();
  return loadPromise;
}

export { fetchFile };

export type VideoProbe = {
  width: number | null;
  height: number | null;
  durationSec: number | null;
};

/** Run ffmpeg -i to surface container metadata (dimensions, duration). */
export async function probeVideo(file: File | Blob): Promise<VideoProbe> {
  const ff = await getFFmpeg();
  let log = "";
  const collector = ({ message }: { message: string }) => {
    log += message + "\n";
  };
  ff.on("log", collector);
  try {
    await ff.writeFile("probe.in", await fetchFile(file));
    try {
      await ff.exec(["-i", "probe.in", "-f", "null", "-"]);
    } catch {
      /* ffmpeg exits non-zero with -f null for some inputs, after logging */
    }
  } finally {
    ff.off("log", collector);
    try { await ff.deleteFile("probe.in"); } catch { /* ignore */ }
  }
  const dim = log.match(/,\s*(\d{2,5})x(\d{2,5})[ ,]/);
  const dur = log.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
  return {
    width: dim ? Number(dim[1]) : null,
    height: dim ? Number(dim[2]) : null,
    durationSec: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : null,
  };
}
