import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Play, Pause, Upload, Trash2, Music2 } from "lucide-react";
import { Button, Card, Badge, Spinner } from "./ui";
import { listMusic, registerTrack, deleteTrack } from "../api";
import type { FarmMusic } from "../types";
import { renderMusicBed, type MusicPresetKey } from "../music";
import { uploadToBucket } from "../client-helpers";

export function MusicTab() {
  const qc = useQueryClient();
  const music = useQuery({ queryKey: ["music"], queryFn: listMusic });
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const preview = async (m: FarmMusic) => {
    if (playing === m.id) { audioRef.current?.pause(); setPlaying(null); return; }
    try {
      audioRef.current?.pause();
      setPlaying(m.id);
      const bytes = await renderMusicBed((m.preset_key ?? "sunrise") as MusicPresetKey, 20);
      const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: "audio/wav" }));
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { setPlaying(null); URL.revokeObjectURL(url); };
      await audio.play();
    } catch (e) {
      setPlaying(null);
      toast.error(e instanceof Error ? e.message : "Could not preview");
    }
  };

  const del = useMutation({
    mutationFn: (id: string) => deleteTrack(id),
    onSuccess: () => { toast.success("Track removed"); qc.invalidateQueries({ queryKey: ["music"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Delete failed"),
  });

  return (
    <div className="max-w-3xl space-y-5">
      <UploadTrack onDone={() => qc.invalidateQueries({ queryKey: ["music"] })} />
      <div className="space-y-2">
        {music.isLoading ? <Spinner label="Loading tracks…" /> : (music.data ?? []).map((m) => (
          <Card key={m.id} className="flex items-center gap-3 p-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-green-100"><Music2 className="size-4 text-green-700" /></div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-green-900">{m.title}</span>
                <Badge className="bg-green-900/5 text-green-900/60">{m.kind === "procedural" ? "Bundled" : "Uploaded"}</Badge>
              </div>
              <p className="text-xs text-green-900/50">{[m.mood, m.license].filter(Boolean).join(" · ")}</p>
            </div>
            {m.kind === "procedural" ? (
              <Button variant="outline" onClick={() => preview(m)}>{playing === m.id ? <Pause className="size-4" /> : <Play className="size-4" />}</Button>
            ) : (
              <Button variant="danger" onClick={() => del.mutate(m.id)} loading={del.isPending}><Trash2 className="size-4" /></Button>
            )}
          </Card>
        ))}
      </div>
      <p className="text-xs text-green-900/50">Bundled beds are generated on the fly and are royalty-free. Upload your own licensed tracks to expand the library.</p>
    </div>
  );
}

const AUDIO_EXT = /\.(mp3|m4a|wav|aac|ogg|oga|flac)$/i;
const MAX_BYTES = 30 * 1024 * 1024;

// Guess a mood from the file name so uploaded tracks join the auto-picker.
function moodFromName(name: string): string | null {
  const t = name.toLowerCase();
  const has = (w: string[]) => w.some((x) => t.includes(x));
  if (has(["upbeat", "energ", "hype", "party", "dance", "fast", "rock", "epic", "action"])) return "upbeat";
  if (has(["warm", "happy", "feel", "uplift", "family", "cozy", "acoustic", "folk"])) return "warm";
  if (has(["calm", "chill", "relax", "ambient", "peace", "soft", "mellow", "lofi", "lo-fi"])) return "calm";
  if (has(["bright", "sunny", "pop", "fun", "playful", "cheer"])) return "bright";
  if (has(["country", "trail", "western", "guitar", "road"])) return "chill";
  return null;
}

function UploadTrack({ onDone }: { onDone: () => void }) {
  const filesRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; name: string } | null>(null);

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList) return;
    const all = Array.from(fileList);
    const audio = all.filter((f) => f.type.startsWith("audio/") || AUDIO_EXT.test(f.name));
    const tooBig = audio.filter((f) => f.size > MAX_BYTES);
    const queue = audio.filter((f) => f.size <= MAX_BYTES);

    if (queue.length === 0) {
      toast.error(all.length ? "No audio files found (MP3, M4A, WAV, OGG, FLAC)" : "Nothing selected");
      return;
    }

    let added = 0;
    let failed = 0;
    setProgress({ done: 0, total: queue.length, name: "" });
    for (let i = 0; i < queue.length; i++) {
      const file = queue[i];
      setProgress({ done: i, total: queue.length, name: file.name });
      try {
        const path = await uploadToBucket("farm-music", file, {
          contentType: file.type || "audio/mpeg",
        });
        // Tidy a title from the filename: strip ext, turn separators into spaces.
        const title = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
        await registerTrack(title || file.name, path, moodFromName(file.name));
        added++;
      } catch (e) {
        console.error("track upload failed", file.name, e);
        failed++;
      }
      if (added % 5 === 0) onDone(); // refresh the list periodically
    }
    setProgress(null);
    onDone();
    const bits = [`Added ${added} track${added === 1 ? "" : "s"}`];
    if (failed) bits.push(`${failed} failed`);
    if (tooBig.length) bits.push(`${tooBig.length} skipped (over 30 MB)`);
    toast.success(bits.join(" · "));
  };

  const busy = !!progress;

  return (
    <Card className="space-y-3 p-4">
      <label className="text-xs font-medium text-green-900/70">Add music to your library</label>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => filesRef.current?.click()} loading={busy}>
          <Upload className="size-4" /> Upload files
        </Button>
        <Button variant="outline" onClick={() => folderRef.current?.click()} disabled={busy}>
          <Upload className="size-4" /> Upload a whole folder
        </Button>
      </div>
      {progress && (
        <div className="space-y-1">
          <div className="h-2 w-full overflow-hidden rounded-full bg-green-900/10">
            <div
              className="h-full bg-green-600 transition-all"
              style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
            />
          </div>
          <p className="truncate text-[11px] text-green-900/60">
            Uploading {progress.done + 1} of {progress.total}: {progress.name}
          </p>
        </div>
      )}
      <p className="text-[11px] text-green-900/50">
        Only add music you have the rights to use (public-domain / CC0 or licensed). Pick many files
        at once, or a whole folder. MP3 / M4A / WAV / OGG / FLAC · up to 30 MB each.
      </p>
      <input
        ref={filesRef}
        type="file"
        accept="audio/*"
        multiple
        className="hidden"
        onChange={(e) => { void handleFiles(e.target.files); e.target.value = ""; }}
      />
      <input
        ref={folderRef}
        type="file"
        multiple
        className="hidden"
        // @ts-expect-error non-standard but widely supported directory picker
        webkitdirectory=""
        onChange={(e) => { void handleFiles(e.target.files); e.target.value = ""; }}
      />
    </Card>
  );
}
