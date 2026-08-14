import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UploadCloud, Film, Download, CalendarPlus, CalendarX, Trash2, Check, ExternalLink, Share2 } from "lucide-react";
import { Button, Card, Input, Label, Modal, Spinner, Badge } from "./ui";
import {
  listVideos, createVideo, updateVideo, deleteVideo, getVideoAssets,
  scheduleVideo, unscheduleVideo, markPosted, postizPublish,
} from "../api";
import type { FarmVideoWithRelations, FarmPlatform } from "../types";
import { probeVideoFile, uploadToBucket } from "../client-helpers";
import { insertMidroll } from "../render";

const LF_PLATFORMS: FarmPlatform[] = ["youtube", "facebook"];
const PLAT_LABEL: Record<string, string> = { youtube: "YouTube", facebook: "Facebook" };

export function LongForm() {
  const qc = useQueryClient();
  const videos = useQuery({ queryKey: ["videos", "longform"], queryFn: () => listVideos("longform") });
  const [openId, setOpenId] = useState<string | null>(null);
  const openVideo = videos.data?.find((v) => v.id === openId) ?? null;
  return (
    <div className="space-y-6">
      <LongUpload onDone={() => qc.invalidateQueries({ queryKey: ["videos"] })} />
      {videos.isLoading ? (
        <Spinner label="Loading…" />
      ) : (videos.data?.length ?? 0) === 0 ? (
        <p className="text-sm text-green-900/60">No long-form videos yet. Upload one above with a mid-roll clip.</p>
      ) : (
        <div className="grid gap-3">
          {videos.data!.map((v) => {
            const sched = v.posts.find((p) => p.status === "queued" || p.status === "ready");
            return (
              <button key={v.id} onClick={() => setOpenId(v.id)} className="flex items-center gap-3 rounded-xl border border-green-900/10 bg-white p-3 text-left hover:border-green-600/50">
                <div className="grid size-12 shrink-0 place-items-center rounded-lg bg-green-900/5"><Film className="size-5 text-green-700" /></div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-green-900">{v.title}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <Badge className="bg-green-900/5 text-green-900/60">{v.status}</Badge>
                    {v.duration_sec ? <span className="text-[11px] text-green-900/50">{Math.round(v.duration_sec / 60)} min</span> : null}
                    {v.render_path ? <span className="text-[11px] text-emerald-600">mid-roll inserted</span> : <span className="text-[11px] text-amber-600">not processed</span>}
                    {sched ? <span className="text-[11px] text-violet-600">· {new Date(sched.scheduled_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span> : null}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
      {openVideo && <LongDialog video={openVideo} open={!!openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function LongUpload({ onDone }: { onDone: () => void }) {
  const mainRef = useRef<HTMLInputElement>(null);
  const bumpRef = useRef<HTMLInputElement>(null);
  const [main, setMain] = useState<File | null>(null);
  const [bumper, setBumper] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const process = async () => {
    if (!main) return toast.error("Choose the main long-form video");
    if (!bumper) return toast.error("Choose the mid-roll clip to insert");
    if (main.size > 2 * 1024 * 1024 * 1024) return toast.error("Main video is over 2 GB — please compress it first");
    if (main.size > 600 * 1024 * 1024) {
      toast.warning("Large file — the in-browser mid-roll step may be slow or run out of memory. If it fails, compress the video first.");
    }
    const base = title.trim() || main.name.replace(/\.[^.]+$/, "");
    try {
      setBusy("Reading video…");
      const probe = await probeVideoFile(main);
      setBusy("Uploading video…");
      const sourcePath = await uploadToBucket("farm-uploads", main, { contentType: main.type || "video/mp4" });
      setBusy("Uploading mid-roll clip…");
      const midrollPath = await uploadToBucket("farm-uploads", bumper, { contentType: bumper.type || "video/mp4" });
      let thumbnailPath: string | null = null;
      if (probe.poster) thumbnailPath = await uploadToBucket("farm-uploads", probe.poster, { ext: "jpg", contentType: "image/jpeg" });

      const id = await createVideo({
        title: base,
        description: description.trim() || null,
        source_path: sourcePath,
        source_mime: main.type || "video/mp4",
        source_size: main.size,
        duration_sec: probe.duration || null,
        width: probe.width || null,
        height: probe.height || null,
        thumbnail_path: thumbnailPath,
        workspace: "longform",
        midroll_path: midrollPath,
      });

      setBusy("Inserting mid-roll (this can take a while)…");
      try {
        const out = await insertMidroll(main, bumper, {
          onProgress: (r) => setBusy(`Inserting mid-roll ${Math.round(r * 100)}%…`),
        });
        const renderPath = await uploadToBucket("farm-renders", out, { ext: "mp4", contentType: "video/mp4", path: `${id}.mp4` });
        await updateVideo(id, { render_path: renderPath, status: "ready" });
        toast.success("Done — mid-roll inserted.");
      } catch (e) {
        console.error("midroll failed", e);
        await updateVideo(id, { status: "captioned", render_error: e instanceof Error ? e.message : "midroll failed" }).catch(() => {});
        toast.warning("Uploaded, but mid-roll insert failed (video may be too large for in-browser processing).");
      }

      setMain(null); setBumper(null); setTitle(""); setDescription("");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="space-y-3 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="text-xs font-medium text-green-900/70">Title (optional)</label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Weekly farm update" disabled={!!busy} />
        </div>
        <div>
          <label className="text-xs font-medium text-green-900/70">What's it about? (helps Claude)</label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short summary of the video" disabled={!!busy} />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Button variant="outline" className="w-full" onClick={() => mainRef.current?.click()} disabled={!!busy}>
            <UploadCloud className="size-4" /> {main ? "Main video ✓" : "Choose main video"}
          </Button>
          {main && <p className="mt-1 truncate text-[11px] text-green-900/50">{main.name}</p>}
        </div>
        <div>
          <Button variant="outline" className="w-full" onClick={() => bumpRef.current?.click()} disabled={!!busy}>
            <Film className="size-4" /> {bumper ? "Mid-roll clip ✓" : "Choose mid-roll clip"}
          </Button>
          {bumper && <p className="mt-1 truncate text-[11px] text-green-900/50">{bumper.name}</p>}
        </div>
      </div>
      <Button onClick={process} loading={!!busy} disabled={!main || !bumper}>
        {busy ?? "Process (insert mid-roll + write captions)"}
      </Button>
      <p className="text-[11px] text-green-900/50">
        The main video is split at its midpoint and your mid-roll clip is spliced in. Processing runs in
        your browser (up to ~2 GB, but larger/longer files may hit memory limits). Deploys to YouTube &amp; Facebook.
      </p>
      <input ref={mainRef} type="file" accept="video/*" className="hidden" onChange={(e) => { setMain(e.target.files?.[0] ?? null); e.target.value = ""; }} />
      <input ref={bumpRef} type="file" accept="video/*" className="hidden" onChange={(e) => { setBumper(e.target.files?.[0] ?? null); e.target.value = ""; }} />
    </Card>
  );
}

function LongDialog({ video, open, onClose }: { video: FarmVideoWithRelations; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["videos"] });
  const assets = useQuery({
    queryKey: ["assets", video.id, video.render_path],
    queryFn: () => getVideoAssets(video.id),
    enabled: open,
    staleTime: 45 * 60 * 1000,
  });

  const [title, setTitle] = useState(video.title);
  useEffect(() => { setTitle(video.title); }, [video.id]);
  const saveTitle = useMutation({
    mutationFn: () => updateVideo(video.id, { title: title.trim() || "Untitled" }),
    onSuccess: () => { toast.success("Saved"); invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });
  const doSchedule = useMutation({
    mutationFn: () => scheduleVideo(video.id, LF_PLATFORMS),
    onSuccess: (r) => { toast.success(`Scheduled for ${new Date(r.scheduledAt).toLocaleString()}`); invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Scheduling failed"),
  });
  const doUnschedule = useMutation({ mutationFn: () => unscheduleVideo(video.id), onSuccess: () => { toast.success("Unscheduled"); invalidate(); } });
  const publishNow = useMutation({
    mutationFn: () => postizPublish(video.id, LF_PLATFORMS),
    onSuccess: (r) => { toast.success(`Posted to ${(r.published ?? []).join(", ") || "your channels"}`); invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Publish failed"),
  });
  const doDelete = useMutation({
    mutationFn: () => deleteVideo(video.id),
    onSuccess: () => { toast.success("Deleted"); onClose(); invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Delete failed"),
  });

  const previewUrl = assets.data?.renderUrl ?? assets.data?.sourceUrl ?? null;
  const scheduledAt = video.posts.find((p) => p.status === "queued" || p.status === "ready")?.scheduled_at;

  return (
    <Modal open={open} onClose={onClose} title="Long-form video">
      <div className="grid gap-5 md:grid-cols-[260px_1fr]">
        <div className="space-y-3">
          <div className="grid aspect-video place-items-center overflow-hidden rounded-lg bg-black">
            {previewUrl ? <video key={previewUrl} src={previewUrl} controls className="h-full w-full object-contain" /> : <Spinner label="Loading…" />}
          </div>
          {assets.data?.renderUrl && (
            <a href={assets.data.renderUrl} download={`${video.title || "longform"}.mp4`}>
              <Button variant="outline" className="w-full"><Download className="size-4" /> Download (with mid-roll)</Button>
            </a>
          )}
          {!video.render_path && video.render_error && (
            <p className="text-[11px] text-red-500">Mid-roll error: {video.render_error}</p>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          <div className="space-y-1">
            <Label>Title</Label>
            <div className="flex gap-2">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
              <Button variant="secondary" onClick={() => saveTitle.mutate()} loading={saveTitle.isPending}><Check className="size-4" /> Save</Button>
            </div>
            <p className="text-[11px] text-green-900/50">Add descriptions/captions in Postiz or YouTube.</p>
          </div>

          <div className="space-y-2 border-t border-green-900/10 pt-3">
            <h3 className="text-sm font-semibold text-green-900">Deploy (YouTube + Facebook)</h3>
            {scheduledAt ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-green-900/10 p-2.5">
                <span className="text-sm text-green-900">Slotted for <strong>{new Date(scheduledAt).toLocaleString()}</strong></span>
                <Button variant="ghost" onClick={() => doUnschedule.mutate()} loading={doUnschedule.isPending}><CalendarX className="size-4" /> Unschedule</Button>
              </div>
            ) : (
              <Button variant="outline" onClick={() => doSchedule.mutate()} loading={doSchedule.isPending}><CalendarPlus className="size-4" /> Schedule into next open slot</Button>
            )}
            {video.render_path && (
              <Button onClick={() => publishNow.mutate()} loading={publishNow.isPending}>
                <Share2 className="size-4" /> Publish now to YouTube + Facebook (Postiz)
              </Button>
            )}
            {video.posts.length > 0 && (
              <div className="space-y-1.5 pt-1">
                {video.posts.filter((p) => LF_PLATFORMS.includes(p.platform)).map((p) => (
                  <LongPostRow key={p.id} post={p} onDone={invalidate} />
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-green-900/10 pt-2">
            <Button variant="danger" onClick={() => doDelete.mutate()} loading={doDelete.isPending}><Trash2 className="size-4" /> Delete</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function LongPostRow({ post, onDone }: { post: FarmVideoWithRelations["posts"][number]; onDone: () => void }) {
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
      <span className="w-24 shrink-0 font-medium text-green-900">{PLAT_LABEL[post.platform] ?? post.platform}</span>
      {done ? (
        <span className="flex items-center gap-1.5 text-xs">
          <Badge className={post.status === "posted" ? "bg-green-200 text-green-800" : "bg-gray-100 text-gray-500"}>{post.status}</Badge>
          {post.posted_url && <a href={post.posted_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-green-700">link <ExternalLink className="size-3" /></a>}
        </span>
      ) : (
        <>
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste live URL (optional)" className="h-8 text-xs" />
          <Button className="h-8" loading={busy} onClick={() => run({ postedUrl: url.trim() || null })}>Mark posted</Button>
          <Button variant="ghost" className="h-8" disabled={busy} onClick={() => run({ skipped: true })}>Skip</Button>
        </>
      )}
    </div>
  );
}
