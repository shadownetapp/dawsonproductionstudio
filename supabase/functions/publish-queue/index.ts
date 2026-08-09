// Assisted-posting nudge. Triggered by pg_cron (verify_jwt = false; gated by a
// shared x-cron-secret). Promotes due posts to "ready" and emails the owner one
// reminder per short (via Resend) with every caption + a link to the app.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const PLATFORM_LABELS: Record<string, string> = {
  tiktok: "TikTok", instagram: "Instagram Reels", youtube: "YouTube Shorts", facebook: "Facebook Reels",
};

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get("FARM_CRON_SECRET");
  const provided = req.headers.get("x-cron-secret");
  if (!cronSecret || provided !== cronSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const appUrl = (Deno.env.get("FARM_APP_URL") ?? "").replace(/\/$/, "");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("FARM_FROM_EMAIL") ?? "Dawson Content Creations <onboarding@resend.dev>";
  const nowIso = new Date().toISOString();

  const { data: settings } = await supabase
    .from("farm_settings").select("notify_email").eq("id", "default").maybeSingle();
  const notifyEmail = settings?.notify_email ?? null;

  const { data: duePosts } = await supabase
    .from("farm_posts")
    .select("id, video_id, platform, scheduled_at")
    .eq("status", "queued")
    .is("notified_at", null)
    .lte("scheduled_at", nowIso)
    .order("scheduled_at", { ascending: true })
    .limit(200);

  const posts = duePosts ?? [];
  if (posts.length === 0) return json({ ok: true, promoted: 0, notified: 0 });

  const byVideo = new Map<string, typeof posts>();
  for (const p of posts) {
    const arr = byVideo.get(p.video_id) ?? [];
    arr.push(p);
    byVideo.set(p.video_id, arr);
  }

  let promoted = 0;
  let notified = 0;

  for (const [videoId, group] of byVideo) {
    const ids = group.map((p) => p.id);
    const stamp = new Date().toISOString();
    await supabase.from("farm_posts").update({ status: "ready", notified_at: stamp }).in("id", ids);
    promoted += ids.length;

    const [{ data: video }, { data: captions }] = await Promise.all([
      supabase.from("farm_videos").select("title, render_path").eq("id", videoId).maybeSingle(),
      supabase.from("farm_captions").select("platform, title, caption, hashtags").eq("video_id", videoId),
    ]);

    const capByPlatform = new Map((captions ?? []).map((c) => [c.platform, c]));
    const labels = group.map((p) => PLATFORM_LABELS[p.platform] ?? p.platform).join(", ");
    const captionsText = group.map((p) => {
      const c = capByPlatform.get(p.platform);
      const label = PLATFORM_LABELS[p.platform] ?? p.platform;
      if (!c) return `${label}:\n(no caption yet)`;
      const tags = (c.hashtags ?? []).map((h: string) => `#${h}`).join(" ");
      return `${label}:\n${c.title ? c.title + "\n" : ""}${c.caption}${tags ? "\n" + tags : ""}`;
    }).join("\n\n");

    if (notifyEmail && resendKey) {
      const renderNote = video?.render_path ? "" : " (open the app to finish rendering first)";
      const html = `<h2>🎬 Ready to post: ${escapeHtml(video?.title ?? "your short")}</h2>
<p>Post to <strong>${escapeHtml(labels)}</strong>${renderNote}.</p>
${appUrl ? `<p><a href="${appUrl}">Open Dawson Content Creations → download &amp; post</a></p>` : ""}
<pre style="white-space:pre-wrap;font-family:inherit;background:#f4f4f4;padding:12px;border-radius:8px">${escapeHtml(captionsText)}</pre>`;
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
        body: JSON.stringify({
          from: fromEmail,
          to: [notifyEmail],
          subject: `🎬 Ready to post: "${video?.title ?? "your short"}"`,
          html,
        }),
      });
      if (r.ok) notified++;
    }
  }

  return json({ ok: true, dueCandidates: posts.length, videos: byVideo.size, promoted, notified });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
