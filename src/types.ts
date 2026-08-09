export const FARM_PLATFORMS = ["tiktok", "instagram", "youtube", "facebook"] as const;
export type FarmPlatform = (typeof FARM_PLATFORMS)[number];

export const PLATFORM_LABELS: Record<FarmPlatform, string> = {
  tiktok: "TikTok",
  instagram: "Instagram Reels",
  youtube: "YouTube Shorts",
  facebook: "Facebook Reels",
};

export type FarmVideoStatus =
  | "draft" | "captioned" | "rendering" | "ready"
  | "scheduled" | "published" | "archived" | "failed";

export type FarmMusic = {
  id: string;
  title: string;
  kind: "procedural" | "upload";
  preset_key: string | null;
  storage_path: string | null;
  mood: string | null;
  license: string;
  duration_sec: number | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
};

export type FarmCaption = {
  id: string;
  video_id: string;
  platform: FarmPlatform;
  title: string | null;
  caption: string;
  hashtags: string[];
  updated_at: string;
};

export type FarmPost = {
  id: string;
  video_id: string;
  platform: FarmPlatform;
  scheduled_at: string;
  status: "queued" | "ready" | "posted" | "skipped" | "failed";
  notified_at: string | null;
  posted_at: string | null;
  posted_url: string | null;
};

export type FarmVideo = {
  id: string;
  title: string;
  description: string | null;
  status: FarmVideoStatus;
  source_path: string;
  source_mime: string | null;
  source_size: number | null;
  duration_sec: number | null;
  width: number | null;
  height: number | null;
  thumbnail_path: string | null;
  music_id: string | null;
  burn_caption: boolean;
  overlay_text: string | null;
  render_path: string | null;
  render_error: string | null;
  created_at: string;
  updated_at: string;
};

export type FarmVideoWithRelations = FarmVideo & {
  captions: FarmCaption[];
  posts: FarmPost[];
  music: Pick<FarmMusic, "id" | "title" | "kind" | "preset_key"> | null;
};

export type FarmSettings = {
  id: string;
  timezone: string;
  daily_slots: string[];
  platforms: FarmPlatform[];
  notify_email: string | null;
  notify_phone: string | null;
};
