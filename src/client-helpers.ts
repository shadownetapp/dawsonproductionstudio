import { supabase } from "./supabase";

export type ProbeResult = { width: number; height: number; duration: number; poster: Blob | null };

/** Read dimensions/duration and grab a poster frame using an off-DOM <video>. */
export function probeVideoFile(file: File): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    (video as HTMLVideoElement & { playsInline: boolean }).playsInline = true;
    const done = (r: ProbeResult) => {
      URL.revokeObjectURL(url);
      resolve(r);
    };
    video.onloadedmetadata = () => {
      const width = video.videoWidth || 0;
      const height = video.videoHeight || 0;
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const seekTo = duration > 2 ? 1 : duration / 2 || 0;
      const capture = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = width || 720;
          canvas.height = height || 1280;
          const ctx = canvas.getContext("2d");
          if (ctx) ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((b) => done({ width, height, duration, poster: b }), "image/jpeg", 0.82);
        } catch {
          done({ width, height, duration, poster: null });
        }
      };
      video.onseeked = capture;
      try { video.currentTime = seekTo; } catch { capture(); }
    };
    video.onerror = () => done({ width: 0, height: 0, duration: 0, poster: null });
    video.src = url;
  });
}

const extFromName = (name: string) => {
  const m = name.toLowerCase().match(/\.([a-z0-9]{2,5})$/);
  return m ? m[1] : "bin";
};

export async function uploadToBucket(
  bucket: string,
  file: Blob,
  opts: { ext?: string; contentType?: string; path?: string } = {},
): Promise<string> {
  const ext = opts.ext ?? (file instanceof File ? extFromName(file.name) : "bin");
  const path = opts.path ?? `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    contentType: opts.contentType ?? (file as File).type ?? "application/octet-stream",
    upsert: !!opts.path,
  });
  if (error) throw new Error(error.message);
  return path;
}

export async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch asset (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

export function extFromUrl(url: string, fallback = "mp3") {
  try {
    const m = new URL(url).pathname.toLowerCase().match(/\.([a-z0-9]{2,5})$/);
    return m ? m[1] : fallback;
  } catch {
    return fallback;
  }
}

// Turn a full caption into a short on-screen hook: first line, no hashtags,
// first sentence or ~90 chars, so burned-in text stays a clean one-liner.
export function shortHook(caption: string): string {
  let s = (caption.split("\n")[0] || "").replace(/#[^\s#]+/g, "").replace(/\s{2,}/g, " ").trim();
  const m = s.match(/^(.{0,90}?[.!?])(\s|$)/);
  if (m) return m[1].trim();
  if (s.length > 90) s = s.slice(0, 88).replace(/\s+\S*$/, "").trim() + "…";
  return s;
}
