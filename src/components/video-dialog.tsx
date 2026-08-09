import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Sparkles, Music2, Wand2, CalendarPlus, CalendarX, Trash2, Download, Check, ExternalLink, Loader2,
} from "lucide-react";
import { Button, Card, Input, Label, Modal, Tabs, Textarea, Badge, cn } from "./ui";
import {
  getVideoAssets, updateVideo, deleteVideo, generateCaptions, updateCaption,
  listMusic, scheduleVideo, unscheduleVideo, markPosted,
} from "../api";
import {
  FARM_PLATFORMS, PLATFORM_LABELS,
  type FarmVideoWithRelations, type FarmPlatform, type FarmMusic,
} from "../types";
import { renderShort } from "../render";
import { renderMusicBed, type MusicPresetKey } from "../music";
import { fetchBytes, uploadToBucket, extFromUrl } from "../client-helpers";

// Turn a full caption into a short on-screen hook: first line, no hashtags,
// first sentence or ~90 chars, so the burned-in text stays a clean one-liner.
function shortHook(caption: string): string {
  let s = (caption.split("\n")[0] || "").replace(/#[^\s#]+/g, "").replace(/\s{2,}/g, " ").trim();
  const m = s.match(/^(.{0,90}?[.!?])(\s|$)/);
  if (m) return m[1].trim();
  if (s.length > 90) s = s.slice(0, 88).replace(/\s+\S*$/, "").trim() + "…";
  return s;
}

export function VideoDialog({
  video, open, onClose,
}: {
  video: FarmVideoWithRelations;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["videos"] });

  const assets = useQuery({
    queryKey: ["assets", video.id, video.render_path, video.music_id],
    queryFn: () => getVideoAssets(video.id),
    enabled: open,
    staleTime: 45 * 60 * 1000,
  });
  const music = useQuery({ queryKey: ["music"], queryFn: listMusic, enabled: open });

  const [title, setTitle] = useState(video.title);
  const [description, setDescription] = useState(video.description ?? "");
  const [musicId, setMusicId] = useState<string | null>(video.music_id);
  const [burnCaption, setBurnCaption] = useState(video.burn_caption);
  const [overlayText, setOverlayText] = useState(video.overlay_text ?? "");
  const [renderProgress, setRenderProgress] = useState<number | null>(null);

  useEffect(() => {
    setTitle(video.title);
    setDescription(video.description ?? "");
    setMusicId(video.music_id);
    setBurnCaption(video.burn_caption);
    setOverlayText(video.overlay_text ?? "");
  }, [video.id]);

  const saveMeta = useMutation({
    mutationFn: () => updateVideo(video.id, {
      title: title.trim() || "Untitled short",
      description: description.trim() || null,
      music_id: musicId, burn_caption: burnCaption,
      overlay_text: overlayText.trim() || null,
    }),
    onSuccess: () => { toast.success("Saved"); invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  const regenerate = useMutation({
    mutationFn: () => generateCaptions(video.id),
    onSuccess: () => { toast.success("Captions refreshed by Claude"); invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Caption generation failed"),
  });

  const doSchedule = useMutation({
    mutationFn: async () => { await saveMeta.mutateAsync(); return scheduleVideo(video.id); },
    onSuccess: (r) => { toast.success(`Scheduled for ${new Date(r.scheduledAt).toLocaleString()}`); invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Scheduling failed"),
  });
  const doUnschedule = useMutation({
    mutationFn: () => unscheduleVideo(video.id),
    onSuccess: () => { toast.success("Removed from the schedule"); invalidate(); },
  });
  const doDelete = useMutation({
    mutationFn: () => deleteVideo(video.id),
    onSuccess: () => { toast.success("Deleted"); onClose(); invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Delete failed"),
  });

  const render = useMutation({
    mutationFn: async () => {
      if (!musicId) throw new Error("Pick a music bed first");
      await saveMeta.mutateAsync();
      await updateVideo(video.id, { status: "rendering", render_error: null });
      setRenderProgress(0);
      const fresh = await getVideoAssets(video.id);
      if (!fresh.sourceUrl) throw new Error("Source video not found");
      const srcBytes = await fetchBytes(fresh.sourceUrl);
      const srcBlob = new Blob([srcBytes.slice().buffer], { type: video.source_mime ?? "video/mp4" });

      if (!fresh.music) throw new Error("Music track not found");
      let musicBytes: Uint8Array;
      let musicExt: string;
      if (fresh.music.kind === "procedural" && fresh.music.preset_key) {
        const dur = Math.max(15, Math.min(90, Math.ceil((video.duration_sec ?? 30) + 2)));
        musicBytes = await renderMusicBed(fresh.music.preset_key as MusicPresetKey, dur);
        musicExt = "wav";
      } else if (fresh.music.url) {
        musicBytes = await fetchBytes(fresh.music.url);
        musicExt = extFromUrl(fresh.music.url);
      } else {
        throw new Error("This track has no audio file");
      }

      const captionText = burnCaption
        ? overlayText.trim() ||
          shortHook(
            video.captions.find((c) => c.platform === "instagram")?.caption ||
              video.captions[0]?.caption ||
              "",
          ) ||
          null
        : null;

      const out = await renderShort(srcBlob, {
        music: musicBytes, musicExt, audioMode: "mix", captionText,
        onProgress: (r) => setRenderProgress(Math.round(r * 100)),
      });
      const renderPath = await uploadToBucket("farm-renders", out, { ext: "mp4", contentType: "video/mp4", path: `${video.id}.mp4` });
      await updateVideo(video.id, { render_path: renderPath, status: "ready" });
    },
    onSuccess: () => {
      setRenderProgress(null);
      toast.success("Rendered with music — ready to schedule & post");
      qc.invalidateQueries({ queryKey: ["assets", video.id] });
      invalidate();
    },
    onError: async (e) => {
      setRenderProgress(null);
      await updateVideo(video.id, { status: "failed", render_error: e instanceof Error ? e.message : "render failed" }).catch(() => {});
      invalidate();
      toast.error(e instanceof Error ? e.message : "Render failed");
    },
  });

  const scheduledAt = video.posts.find((p) => p.status === "queued" || p.status === "ready")?.scheduled_at;
  const tooLong = (video.duration_sec ?? 0) > 60;
  const previewUrl = assets.data?.renderUrl ?? assets.data?.sourceUrl ?? null;

  return (
    <Modal open={open} onClose={onClose} title="Edit short">
      <div className="grid gap-5 md:grid-cols-[220px_1fr]">
        <div className="space-y-3">
          <div className="grid aspect-[9/16] place-items-center overflow-hidden rounded-lg bg-black">
            {previewUrl ? (
              <video key={previewUrl} src={previewUrl} controls playsInline className="h-full w-full object-contain" />
            ) : (
              <Loader2 className="size-6 animate-spin text-white/60" />
            )}
          </div>
          {assets.data?.renderUrl && (
            <a href={assets.data.renderUrl} download={`${title || "short"}.mp4`}>
              <Button variant="outline" className="w-full"><Download className="size-4" /> Download render</Button>
            </a>
          )}
          <div className="space-y-1">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Description (context for captions)</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>
        </div>

        <div className="min-w-0 space-y-5">
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-green-900"><Sparkles className="size-4" /> Captions</h3>
              <Button variant="outline" onClick={() => regenerate.mutate()} loading={regenerate.isPending}>
                <Wand2 className="size-4" /> Regenerate
              </Button>
            </div>
            <CaptionEditor video={video} onSaved={invalidate} />
          </section>

          <section className="space-y-3">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-green-900"><Music2 className="size-4" /> Music &amp; render</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Music bed</Label>
                <select
                  value={musicId ?? ""}
                  onChange={(e) => setMusicId(e.target.value || null)}
                  className="w-full rounded-lg border border-green-900/15 bg-white px-3 py-2 text-sm"
                >
                  <option value="">Choose a track</option>
                  {(music.data ?? []).map((m: FarmMusic) => (
                    <option key={m.id} value={m.id}>{m.title}{m.mood ? ` · ${m.mood}` : ""}</option>
                  ))}
                </select>
              </div>
              <label className="flex items-end gap-2 pb-1 text-xs text-green-900">
                <input type="checkbox" checked={burnCaption} onChange={(e) => setBurnCaption(e.target.checked)} className="size-4 accent-green-700" />
                Burn caption onto video
              </label>
            </div>
            {burnCaption && (
              <div className="space-y-1">
                <Label>On-screen text (blank = use Instagram caption)</Label>
                <Textarea value={overlayText} onChange={(e) => setOverlayText(e.target.value)} rows={2} placeholder="Short punchy line to overlay" />
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" onClick={() => saveMeta.mutate()} loading={saveMeta.isPending}><Check className="size-4" /> Save</Button>
              <Button onClick={() => render.mutate()} loading={render.isPending} disabled={!musicId}>
                <Music2 className="size-4" />
                {render.isPending ? `Rendering${renderProgress != null ? ` ${renderProgress}%` : "…"}` : video.render_path ? "Re-render" : "Render with music"}
              </Button>
            </div>
            {render.isPending && (
              <p className="text-[11px] text-green-900/50">Rendering happens in your browser and can take a minute for longer clips — keep this tab open.</p>
            )}
            {video.render_error && video.status === "failed" && (
              <p className="text-[11px] text-red-500">Last render error: {video.render_error}</p>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-green-900"><CalendarPlus className="size-4" /> Schedule &amp; posting</h3>
            {scheduledAt ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-green-900/10 p-2.5">
                <span className="text-sm text-green-900">Slotted for <strong>{new Date(scheduledAt).toLocaleString()}</strong></span>
                <Button variant="ghost" onClick={() => doUnschedule.mutate()} loading={doUnschedule.isPending}><CalendarX className="size-4" /> Unschedule</Button>
              </div>
            ) : tooLong ? (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800">
                This clip is <strong>{Math.round(video.duration_sec ?? 0)}s</strong> — over a minute, so it won't
                post. Re-upload it and it'll auto-split into sub-minute parts you can schedule.
              </div>
            ) : (
              <Button variant="outline" onClick={() => doSchedule.mutate()} loading={doSchedule.isPending}><CalendarPlus className="size-4" /> Schedule into next open slot</Button>
            )}
            {video.posts.length > 0 && (
              <div className="space-y-1.5 pt-1">
                {video.posts.slice().sort((a, b) => a.platform.localeCompare(b.platform)).map((p) => (
                  <PostRow key={p.id} post={p} onDone={invalidate} />
                ))}
              </div>
            )}
          </section>

          <div className="border-t border-green-900/10 pt-2">
            <Button variant="danger" onClick={() => doDelete.mutate()} loading={doDelete.isPending}><Trash2 className="size-4" /> Delete short</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function PostRow({ post, onDone }: { post: FarmVideoWithRelations["posts"][number]; onDone: () => void }) {
  const [url, setUrl] = useState(post.posted_url ?? "");
  const [busy, setBusy] = useState(false);
  const done = post.status === "posted" || post.status === "skipped";
  const run = async (payload: { postedUrl?: string | null; skipped?: boolean }) => {
    setBusy(true);
    try { await markPosted(post.id, payload); onDone(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  };
  return (
    <div className="flex items-center gap-2 rounded-lg border border-green-900/10 p-2 text-sm">
      <span className="w-32 shrink-0 font-medium text-green-900">{PLATFORM_LABELS[post.platform]}</span>
      {done ? (
        <span className="flex items-center gap-1.5 text-xs">
          <Badge className={post.status === "posted" ? "bg-green-200 text-green-800" : "bg-gray-100 text-gray-500"}>
            {post.status === "posted" ? "Posted" : "Skipped"}
          </Badge>
          {post.posted_url && <a href={post.posted_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-green-700">link <ExternalLink className="size-3" /></a>}
        </span>
      ) : (
        <>
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste live post URL (optional)" className="h-8 text-xs" />
          <Button className="h-8" loading={busy} onClick={() => run({ postedUrl: url.trim() || null })}>Mark posted</Button>
          <Button variant="ghost" className="h-8" disabled={busy} onClick={() => run({ skipped: true })}>Skip</Button>
        </>
      )}
    </div>
  );
}

function CaptionEditor({ video, onSaved }: { video: FarmVideoWithRelations; onSaved: () => void }) {
  const byPlatform = useMemo(() => new Map(video.captions.map((c) => [c.platform, c])), [video.captions]);
  const [tab, setTab] = useState<FarmPlatform>(FARM_PLATFORMS[0]);
  return (
    <div className="space-y-2">
      <Tabs value={tab} onChange={(v) => setTab(v as FarmPlatform)} tabs={FARM_PLATFORMS.map((p) => ({ value: p, label: PLATFORM_LABELS[p] }))} />
      <PlatformCaption key={tab} video={video} platform={tab} existing={byPlatform.get(tab)} onSaved={onSaved} />
    </div>
  );
}

function PlatformCaption({
  video, platform, existing, onSaved,
}: {
  video: FarmVideoWithRelations;
  platform: FarmPlatform;
  existing?: FarmVideoWithRelations["captions"][number];
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(existing?.title ?? "");
  const [caption, setCaption] = useState(existing?.caption ?? "");
  const [hashtags, setHashtags] = useState((existing?.hashtags ?? []).join(" "));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await updateCaption(video.id, platform, {
        title: platform === "youtube" ? title.trim() || null : null,
        caption: caption.trim(),
        hashtags: hashtags.split(/[\s,]+/).map((h) => h.replace(/^#/, "").trim()).filter(Boolean),
      });
      toast.success(`${PLATFORM_LABELS[platform]} caption saved`);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  if (!existing && !caption) {
    return <p className="py-3 text-xs text-green-900/60">No caption yet for {PLATFORM_LABELS[platform]}. Use “Regenerate” above, or write one below.</p>;
  }
  return (
    <div className={cn("space-y-2")}>
      {platform === "youtube" && (
        <div className="space-y-1">
          <Label>Title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} />
        </div>
      )}
      <div className="space-y-1">
        <Label>Caption</Label>
        <Textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={4} />
      </div>
      <div className="space-y-1">
        <Label>Hashtags (space or comma separated)</Label>
        <Textarea value={hashtags} onChange={(e) => setHashtags(e.target.value)} rows={2} placeholder="horse farmlife equestrian" />
      </div>
      <Button onClick={save} loading={busy}><Check className="size-4" /> Save {PLATFORM_LABELS[platform]}</Button>
    </div>
  );
}
