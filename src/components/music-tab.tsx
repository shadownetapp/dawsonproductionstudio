import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Play, Pause, Upload, Trash2, Music2 } from "lucide-react";
import { Button, Card, Input, Badge, Spinner } from "./ui";
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

function UploadTrack({ onDone }: { onDone: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");

  const handle = async (file: File) => {
    if (!file.type.startsWith("audio/")) return toast.error("Please choose an audio file (MP3, M4A, WAV)");
    if (file.size > 30 * 1024 * 1024) return toast.error("Track is over 30 MB");
    setBusy(true);
    try {
      const path = await uploadToBucket("farm-music", file, { contentType: file.type });
      await registerTrack(title.trim() || file.name.replace(/\.[^.]+$/, ""), path);
      setTitle("");
      toast.success("Track added to the library");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-3 p-4">
      <label className="text-xs font-medium text-green-900/70">Add your own track</label>
      <div className="flex gap-2">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Track name (optional)" disabled={busy} />
        <Button onClick={() => inputRef.current?.click()} loading={busy}><Upload className="size-4" /> Upload</Button>
      </div>
      <p className="text-[11px] text-green-900/50">Only upload music you have the rights to use. MP3 / M4A / WAV · up to 30 MB.</p>
      <input ref={inputRef} type="file" accept="audio/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handle(f); e.target.value = ""; }} />
    </Card>
  );
}
