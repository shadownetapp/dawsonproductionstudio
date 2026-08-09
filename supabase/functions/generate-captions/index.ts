// Claude caption generator. Called from the browser via supabase.functions.invoke
// (verify_jwt = true, so only signed-in team members can call it). Reads the
// video, asks Claude for per-platform captions, and upserts them with the
// service role.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const PLATFORMS = ["tiktok", "instagram", "youtube", "facebook"] as const;
const ANTHROPIC_MODEL = "claude-sonnet-4-5";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { videoId, platforms } = await req.json();
    if (!videoId) return json({ error: "videoId required" }, 400);
    const targets: string[] = Array.isArray(platforms) && platforms.length ? platforms : [...PLATFORMS];

    const { data: v } = await supabase
      .from("farm_videos").select("title, description").eq("id", videoId).maybeSingle();
    if (!v) return json({ error: "Video not found" }, 404);

    const system = `You are a social media manager for a short-form video creator. Infer the niche, subject, and audience from the clip's title and description, then write warm, authentic, scroll-stopping captions in a voice that fits that content. Match each platform's native voice:
- tiktok: punchy hook first, casual, a little playful, 3-6 trending-style hashtags.
- instagram: warm storytelling caption (1-3 short lines), tasteful emoji, 8-15 relevant hashtags.
- youtube: a strong <=70-char title PLUS a 1-2 sentence description; 3-5 keyword hashtags.
- facebook: friendly, community-oriented, a question or call to engage; 2-4 hashtags.
Never invent facts not implied by the clip description. No hashtags inside the caption body (put them in the hashtags array). Keep it genuine, not spammy.`;

    const user = `Clip title: ${v.title}
Clip description: ${v.description || "(no description provided — write general, evergreen captions that fit the title)"}

Return STRICT JSON only, no prose, with keys for: ${targets.join(", ")}. Shape:
{
  "tiktok":   { "caption": "…", "hashtags": ["horse","farmlife"] },
  "instagram":{ "caption": "…", "hashtags": ["…"] },
  "youtube":  { "title": "…", "caption": "…", "hashtags": ["…"] },
  "facebook": { "caption": "…", "hashtags": ["…"] }
}
Hashtags must NOT include the # symbol.`;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1600,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      return json({ error: `Claude API error ${res.status}: ${t.slice(0, 300)}` }, 502);
    }
    const data = await res.json();
    const text: string = (data.content ?? [])
      .filter((p: { type: string }) => p.type === "text")
      .map((p: { text?: string }) => p.text ?? "")
      .join("\n");

    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    const parsed = JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : text);

    const rows = targets
      .filter((p) => parsed[p])
      .map((p) => {
        const e = parsed[p] as { title?: string; caption?: string; hashtags?: unknown };
        const hashtags = Array.isArray(e.hashtags)
          ? e.hashtags.map((h) => String(h).replace(/^#/, "").trim()).filter(Boolean)
          : [];
        return {
          video_id: videoId,
          platform: p,
          title: typeof e.title === "string" ? e.title : null,
          caption: typeof e.caption === "string" ? e.caption : "",
          hashtags,
          updated_at: new Date().toISOString(),
        };
      });

    if (rows.length) {
      const { error } = await supabase.from("farm_captions").upsert(rows, { onConflict: "video_id,platform" });
      if (error) return json({ error: error.message }, 500);
    }
    await supabase.from("farm_videos").update({ status: "captioned" }).eq("id", videoId).eq("status", "draft");

    return json({ captions: rows });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "unknown error" }, 500);
  }
});
