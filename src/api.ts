import { supabase } from "./supabase";
import {
  FARM_PLATFORMS,
  type FarmPlatform, type FarmMusic, type FarmSettings,
  type FarmVideoWithRelations,
} from "./types";

const VIDEO_SELECT =
  "*, captions:farm_captions(*), posts:farm_posts(*), music:farm_music(id,title,kind,preset_key)";

// ---------- Videos ----------
export async function listVideos(): Promise<FarmVideoWithRelations[]> {
  const { data, error } = await supabase
    .from("farm_videos")
    .select(VIDEO_SELECT)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as FarmVideoWithRelations[];
}

export async function createVideo(payload: {
  title: string;
  description: string | null;
  source_path: string;
  source_mime: string | null;
  source_size: number | null;
  duration_sec: number | null;
  width: number | null;
  height: number | null;
  thumbnail_path: string | null;
}): Promise<string> {
  const { data: userData } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("farm_videos")
    .insert({ ...payload, created_by: userData.user?.id ?? null })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function updateVideo(id: string, patch: Record<string, unknown>) {
  const { error } = await supabase.from("farm_videos").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteVideo(id: string) {
  const { data: v } = await supabase
    .from("farm_videos")
    .select("source_path, render_path, thumbnail_path")
    .eq("id", id)
    .maybeSingle();
  if (v?.source_path) await supabase.storage.from("farm-uploads").remove([v.source_path]);
  if (v?.thumbnail_path) await supabase.storage.from("farm-uploads").remove([v.thumbnail_path]);
  if (v?.render_path) await supabase.storage.from("farm-renders").remove([v.render_path]);
  const { error } = await supabase.from("farm_videos").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export type VideoAssets = {
  sourceUrl: string | null;
  renderUrl: string | null;
  thumbnailUrl: string | null;
  music: { id: string; title: string; kind: string; preset_key: string | null; url: string | null } | null;
};

export async function getVideoAssets(id: string): Promise<VideoAssets> {
  const { data: v, error } = await supabase
    .from("farm_videos")
    .select("source_path, render_path, thumbnail_path, music:farm_music(id,title,kind,preset_key,storage_path)")
    .eq("id", id)
    .single();
  if (error || !v) throw new Error("Not found");
  const sign = async (bucket: string, path: string | null, expires = 3600) => {
    if (!path) return null;
    const { data } = await supabase.storage.from(bucket).createSignedUrl(path, expires);
    return data?.signedUrl ?? null;
  };
  // The untyped client can infer the to-one embed as an array; normalize it.
  const row = v as unknown as {
    source_path: string;
    render_path: string | null;
    thumbnail_path: string | null;
    music:
      | { id: string; title: string; kind: string; preset_key: string | null; storage_path: string | null }
      | Array<{ id: string; title: string; kind: string; preset_key: string | null; storage_path: string | null }>
      | null;
  };
  const music = Array.isArray(row.music) ? (row.music[0] ?? null) : row.music;
  return {
    sourceUrl: await sign("farm-uploads", row.source_path),
    renderUrl: await sign("farm-renders", row.render_path),
    thumbnailUrl: await sign("farm-uploads", row.thumbnail_path),
    music: music
      ? {
          id: music.id, title: music.title, kind: music.kind, preset_key: music.preset_key,
          url: music.kind === "upload" ? await sign("farm-music", music.storage_path) : null,
        }
      : null,
  };
}

// ---------- Music ----------
export async function listMusic(): Promise<FarmMusic[]> {
  const { data, error } = await supabase
    .from("farm_music")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as FarmMusic[];
}

export async function registerTrack(title: string, storage_path: string) {
  const { data: userData } = await supabase.auth.getUser();
  const { error } = await supabase.from("farm_music").insert({
    title, kind: "upload", storage_path, license: "Owner-supplied",
    created_by: userData.user?.id ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function deleteTrack(id: string) {
  const { data: row } = await supabase
    .from("farm_music").select("kind, storage_path").eq("id", id).maybeSingle();
  if (row?.kind === "upload" && row?.storage_path) {
    await supabase.storage.from("farm-music").remove([row.storage_path]);
  }
  const { error } = await supabase.from("farm_music").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ---------- Captions ----------
export async function generateCaptions(videoId: string, platforms?: FarmPlatform[]) {
  const { data, error } = await supabase.functions.invoke("generate-captions", {
    body: { videoId, platforms },
  });
  if (error) throw new Error(error.message ?? "Caption generation failed");
  return data;
}

export async function updateCaption(
  videoId: string,
  platform: FarmPlatform,
  payload: { title?: string | null; caption: string; hashtags: string[] },
) {
  const { error } = await supabase.from("farm_captions").upsert(
    {
      video_id: videoId,
      platform,
      title: payload.title ?? null,
      caption: payload.caption,
      hashtags: payload.hashtags.map((h) => h.replace(/^#/, "").trim()).filter(Boolean),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "video_id,platform" },
  );
  if (error) throw new Error(error.message);
}

// ---------- Settings ----------
export async function getSettings(): Promise<FarmSettings> {
  const { data, error } = await supabase
    .from("farm_settings").select("*").eq("id", "default").maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? {
    id: "default", timezone: "America/New_York",
    daily_slots: ["08:00", "12:00", "16:00", "20:00"],
    platforms: [...FARM_PLATFORMS], notify_email: null, notify_phone: null,
  }) as FarmSettings;
}

export async function updateSettings(patch: Partial<Omit<FarmSettings, "id">>) {
  const { error } = await supabase
    .from("farm_settings")
    .upsert({ id: "default", ...patch, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) throw new Error(error.message);
}

// ---------- Scheduling (client-side next-open-slot) ----------
function zonedWallClockToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const asUTC = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return new Date(guess - (asUTC - guess));
}

function nextOpenSlot(slots: string[], tz: string, taken: Set<string>): string | null {
  const sorted = [...slots].sort();
  const fromMs = Date.now();
  for (let dayOffset = 0; dayOffset < 120; dayOffset++) {
    const base = new Date(fromMs + dayOffset * 86400000);
    const [y, m, d] = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(base).split("-").map(Number);
    for (const slot of sorted) {
      const [hh, mm] = slot.split(":").map(Number);
      const inst = zonedWallClockToUtc(y, m, d, hh, mm, tz);
      const iso = inst.toISOString();
      if (inst.getTime() <= fromMs) continue;
      if (taken.has(iso)) continue;
      return iso;
    }
  }
  return null;
}

export async function scheduleVideo(videoId: string): Promise<{ scheduledAt: string; platforms: FarmPlatform[] }> {
  const settings = await getSettings();
  const { data: existing } = await supabase
    .from("farm_posts").select("scheduled_at").in("status", ["queued", "ready"]);
  const taken = new Set<string>(
    (existing ?? []).map((r: { scheduled_at: string }) => new Date(r.scheduled_at).toISOString()),
  );
  const next = nextOpenSlot(settings.daily_slots, settings.timezone, taken);
  if (!next) throw new Error("No open slot found in the next 120 days");

  const rows = settings.platforms.map((p) => ({
    video_id: videoId, platform: p, scheduled_at: next, status: "queued",
  }));
  const { error } = await supabase.from("farm_posts").upsert(rows, { onConflict: "video_id,platform" });
  if (error) throw new Error(error.message);
  await supabase.from("farm_videos").update({ status: "scheduled" }).eq("id", videoId);
  return { scheduledAt: next, platforms: settings.platforms };
}

export async function unscheduleVideo(videoId: string) {
  await supabase.from("farm_posts").delete().eq("video_id", videoId).in("status", ["queued", "ready"]);
  await supabase.from("farm_videos").update({ status: "ready" }).eq("id", videoId).eq("status", "scheduled");
}

export async function markPosted(postId: string, payload: { postedUrl?: string | null; skipped?: boolean }) {
  const { data: post, error } = await supabase
    .from("farm_posts")
    .update({
      status: payload.skipped ? "skipped" : "posted",
      posted_at: payload.skipped ? null : new Date().toISOString(),
      posted_url: payload.postedUrl ?? null,
    })
    .eq("id", postId)
    .select("video_id")
    .single();
  if (error) throw new Error(error.message);
  const { data: siblings } = await supabase.from("farm_posts").select("status").eq("video_id", post.video_id);
  const allDone = (siblings ?? []).every((s: { status: string }) => s.status === "posted" || s.status === "skipped");
  if (allDone) await supabase.from("farm_videos").update({ status: "published" }).eq("id", post.video_id);
}
