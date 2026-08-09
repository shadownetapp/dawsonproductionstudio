import { useCallback, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UploadCloud, Music2, Settings2, Clapperboard, Loader2 } from "lucide-react";
import { Button, Card, Input, Spinner, Tabs } from "./ui";
import { listVideos, createVideo, updateVideo, generateCaptions, getVideoAssets, listMusic } from "../api";
import type { FarmVideoWithRelations, FarmVideoStatus, FarmMusic } from "../types";
import { probeVideoFile, uploadToBucket, shortHook } from "../client-helpers";
import { splitIntoSegments, renderShort } from "../render";
import { renderMusicBed, type MusicPresetKey } from "../music";
import { VideoDialog } from "./video-dialog";
import { MusicTab } from "./music-tab";
import { SettingsTab } from "./settings-tab";

const STATUS_STYLES: Record<FarmVideoStatus, string> = {
  draft: "bg-green-900/10 text-green-900/70",
  captioned: "bg-blue-100 text-blue-700",
  rendering: "bg-amber-100 text-amber-700",
  ready: "bg-emerald-100 text-emerald-700",
  scheduled: "bg-violet-100 text-violet-700",
  published: "bg-green-200 text-green-800",
  archived: "bg-gray-100 text-gray-500",
  failed: "bg-red-100 text-red-700",
};
const STATUS_LABEL: Record<FarmVideoStatus, string> = {
  draft: "Draft", captioned: "Captioned", rendering: "Rendering", ready: "Ready",
  scheduled: "Scheduled", published: "Published", archived: "Archived", failed: "Failed",
};

export function Studio() {
  const [tab, setTab] = useState("queue");
  return (
    <div className="space-y-4">
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "queue", label: <span className="inline-flex items-center gap-1.5"><Clapperboard className="size-4" /> Queue</span> },
          { value: "music", label: <span className="inline-flex items-center gap-1.5"><Music2 className="size-4" /> Music</span> },
          { value: "settings", label: <span className="inline-flex items-center gap-1.5"><Settings2 className="size-4" /> Settings</span> },
        ]}
      />
      {tab === "queue" && <QueueTab />}
      {tab === "music" && <MusicTab />}
      {tab === "settings" && <SettingsTab />}
    </div>
  );
}

function QueueTab() {
  const qc = useQueryClient();
  const videos = useQuery({ queryKey: ["videos"], queryFn: listVideos });
  const [openId, setOpenId] = useState<string | null>(null);
  const openVideo = videos.data?.find((v) => v.id === openId) ?? null;

  return (
    <div className="space-y-6">
      <UploadDropzone onUploaded={() => qc.invalidateQueries({ queryKey: ["videos"] })} />
      {videos.isLoading ? (
        <Spinner label="Loading your shorts…" />
      ) : (videos.data?.length ?? 0) === 0 ? (
        <p className="text-sm text-green-900/60">No shorts yet. Drop a clip above to get started.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {videos.data!.map((v) => <VideoCard key={v.id} video={v} onOpen={() => setOpenId(v.id)} />)}
        </div>
      )}
      {openVideo && (
        <VideoDialog video={openVideo} open={!!openId} onClose={() => setOpenId(null)} />
      )}
    </div>
  );
}

function VideoCard({ video, onOpen }: { video: FarmVideoWithRelations; onOpen: () => void }) {
  const scheduled = video.posts.find((p) => p.status === "queued" || p.status === "ready");
  return (
    <button onClick={onOpen} className="group overflow-hidden rounded-xl border border-green-900/10 bg-white text-left transition-colors hover:border-green-600/50">
      <div className="grid aspect-[9/16] place-items-center overflow-hidden bg-green-900/5">
        <Thumb video={video} />
      </div>
      <div className="space-y-1.5 p-2.5">
        <div className="truncate text-sm font-medium text-green-900">{video.title}</div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_STYLES[video.status]}`}>
            {STATUS_LABEL[video.status]}
          </span>
          {video.captions.length > 0 && (
            <span className="rounded bg-green-900/5 px-1.5 py-0.5 text-[10px] text-green-900/60">
              {video.captions.length} caption{video.captions.length > 1 ? "s" : ""}
            </span>
          )}
        </div>
        {scheduled && (
          <p className="text-[10px] text-green-900/50">
            {new Date(scheduled.scheduled_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
          </p>
        )}
      </div>
    </button>
  );
}

function Thumb({ video }: { video: FarmVideoWithRelations }) {
  const q = useQuery({
    queryKey: ["thumb", video.id, video.thumbnail_path],
    queryFn: async () => (await getVideoAssets(video.id)).thumbnailUrl,
    enabled: !!video.thumbnail_path,
    staleTime: 50 * 60 * 1000,
  });
  if (!q.data) return <Clapperboard className="size-8 text-green-900/20" />;
  return <img src={q.data} alt={video.title} className="h-full w-full object-cover" />;
}

function UploadDropzone({ onUploaded }: { onUploaded: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  // Ingest one <=60s clip end-to-end: upload → captions → auto-render
  // (music bed + burned-in caption) → mark ready. The finished, captioned video
  // is produced automatically, no manual render step.
  const ingestClip = useCallback(
    async (clip: File, clipTitle: string, idx: number, beds: FarmMusic[], label: string) => {
      setBusy(`${label}uploading…`);
      const probe = await probeVideoFile(clip);
      const sourcePath = await uploadToBucket("farm-uploads", clip, {
        contentType: clip.type || "video/mp4",
      });
      let thumbnailPath: string | null = null;
      if (probe.poster) {
        thumbnailPath = await uploadToBucket("farm-uploads", probe.poster, {
          ext: "jpg", contentType: "image/jpeg",
        });
      }
      const id = await createVideo({
        title: clipTitle,
        description: description.trim() || null,
        source_path: sourcePath,
        source_mime: clip.type || "video/mp4",
        source_size: clip.size,
        duration_sec: probe.duration || null,
        width: probe.width || null,
        height: probe.height || null,
        thumbnail_path: thumbnailPath,
      });

      setBusy(`${label}writing captions…`);
      let igCaption = "";
      try {
        const res = (await generateCaptions(id)) as { captions?: Array<{ platform: string; caption: string }> };
        const caps = res?.captions ?? [];
        igCaption = caps.find((c) => c.platform === "instagram")?.caption || caps[0]?.caption || "";
      } catch (e) {
        console.error("caption gen failed", e);
      }
      const captionText = shortHook(igCaption) || clipTitle;

      // Auto-render: music bed + burned-in caption, straight from the local file.
      setBusy(`${label}adding music + captions…`);
      const bed = beds.length ? beds[idx % beds.length] : null;
      try {
        const secs = Math.max(15, Math.min(90, Math.ceil((probe.duration ?? 30) + 2)));
        const musicBytes = await renderMusicBed((bed?.preset_key ?? "sunrise") as MusicPresetKey, secs);
        const out = await renderShort(clip, {
          music: musicBytes,
          musicExt: "wav",
          audioMode: "mix",
          captionText,
          onProgress: (r) => setBusy(`${label}rendering ${Math.round(r * 100)}%…`),
        });
        const renderPath = await uploadToBucket("farm-renders", out, {
          ext: "mp4", contentType: "video/mp4", path: `${id}.mp4`,
        });
        await updateVideo(id, { render_path: renderPath, status: "ready", music_id: bed?.id ?? null });
      } catch (e) {
        console.error("auto-render failed", e);
        // Leave as 'captioned' so the user can render manually from the editor.
      }
      return id;
    },
    [description],
  );

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith("video/")) return toast.error("That's not a video file");
    if (file.size > 300 * 1024 * 1024) return toast.error("Video is over 300 MB — please trim it first");
    const base = title.trim() || file.name.replace(/\.[^.]+$/, "");
    try {
      setBusy("Reading clip…");
      const probe = await probeVideoFile(file);
      const beds = (await listMusic()).filter((m) => m.kind === "procedural");

      if (probe.duration && probe.duration > 60) {
        // Long clip → split into <=1-minute parts; each rendered + captioned.
        setBusy("Splitting into 1-minute clips…");
        const segments = await splitIntoSegments(file, 60);
        let made = 0;
        for (let i = 0; i < segments.length; i++) {
          const segFile = new File([segments[i]], `${base}-part${i + 1}.mp4`, { type: "video/mp4" });
          const sp = await probeVideoFile(segFile);
          if (sp.duration && sp.duration < 3) continue; // drop tiny tail
          await ingestClip(segFile, `${base} (Part ${i + 1})`, made, beds, `Part ${i + 1}/${segments.length}: `);
          made++;
          onUploaded();
        }
        setTitle(""); setDescription("");
        toast.success(`Split into ${made} finished clip${made === 1 ? "" : "s"} — music + captions burned in.`);
      } else {
        await ingestClip(file, base, 0, beds, "");
        setTitle(""); setDescription("");
        toast.success("Short is ready — music + captions burned in.");
      }
      onUploaded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  }, [title, description, onUploaded, ingestClip]);

  return (
    <Card className="space-y-3 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="text-xs font-medium text-green-900/70">Title (optional)</label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Morning turnout" disabled={!!busy} />
        </div>
        <div>
          <label className="text-xs font-medium text-green-900/70">What's in the clip? (helps Claude)</label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. My mare galloping at sunrise" disabled={!!busy} />
        </div>
      </div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => !busy && inputRef.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && !busy && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
        className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors ${dragging ? "border-green-600 bg-green-50" : "border-green-900/20 hover:border-green-600/40"} ${busy ? "pointer-events-none opacity-70" : ""}`}
      >
        {busy ? (
          <div className="flex flex-col items-center gap-2 text-sm text-green-900/60">
            <Loader2 className="size-6 animate-spin text-green-700" />
            {busy}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <UploadCloud className="size-8 text-green-900/40" />
            <p className="text-sm font-medium text-green-900">Drop a short here, or click to choose</p>
            <p className="text-xs text-green-900/50">MP4 / MOV / WebM · up to 300 MB · 9:16 works best · clips over 1 min auto-split into parts</p>
          </div>
        )}
        <input ref={inputRef} type="file" accept="video/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
      </div>
    </Card>
  );
}
