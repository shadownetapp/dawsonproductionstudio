import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, X, Save } from "lucide-react";
import { Button, Card, Input, Label, Spinner } from "./ui";
import { getSettings, updateSettings } from "../api";
import { FARM_PLATFORMS, PLATFORM_LABELS, type FarmPlatform, type FarmSettings } from "../types";

const COMMON_TZ = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Phoenix", "America/Anchorage", "Pacific/Honolulu", "UTC",
  "Europe/London", "Europe/Paris", "Australia/Sydney",
];

export function SettingsTab() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: getSettings });

  const [timezone, setTimezone] = useState("America/New_York");
  const [slots, setSlots] = useState<string[]>(["08:00", "12:00", "16:00", "20:00"]);
  const [platforms, setPlatforms] = useState<FarmPlatform[]>([...FARM_PLATFORMS]);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  useEffect(() => {
    const s = settings.data;
    if (!s) return;
    setTimezone(s.timezone); setSlots(s.daily_slots); setPlatforms(s.platforms);
    setEmail(s.notify_email ?? ""); setPhone(s.notify_phone ?? "");
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () => updateSettings({
      timezone,
      daily_slots: [...slots].filter((s) => /^\d{2}:\d{2}$/.test(s)).sort(),
      platforms,
      notify_email: email.trim() || null,
      notify_phone: phone.trim() || null,
    } as Partial<Omit<FarmSettings, "id">>),
    onSuccess: () => { toast.success("Settings saved"); qc.invalidateQueries({ queryKey: ["settings"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  const togglePlatform = (p: FarmPlatform) =>
    setPlatforms((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));

  if (settings.isLoading) return <Spinner label="Loading settings…" />;
  const tzOptions = Array.from(new Set([timezone, ...COMMON_TZ]));

  return (
    <div className="max-w-2xl space-y-5">
      <Card className="space-y-4 p-4">
        <div className="space-y-1">
          <Label>Time zone</Label>
          <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className="h-9 w-full rounded-lg border border-green-900/15 bg-white px-3 text-sm">
            {tzOptions.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
          </select>
          <p className="text-[11px] text-green-900/50">Slot times below are in this zone.</p>
        </div>

        <div className="space-y-2">
          <Label>Daily posting slots</Label>
          <p className="text-[11px] text-green-900/50">Each scheduled short takes the next open slot. Four slots ≈ four posts a day.</p>
          <div className="flex flex-wrap gap-2">
            {slots.map((s, i) => (
              <div key={i} className="flex items-center gap-1">
                <Input type="time" value={s} onChange={(e) => setSlots((cur) => cur.map((x, idx) => (idx === i ? e.target.value : x)))} className="w-32" />
                <button onClick={() => setSlots((cur) => cur.filter((_, idx) => idx !== i))} className="rounded-md p-1.5 text-green-900/50 hover:bg-green-900/5"><X className="size-4" /></button>
              </div>
            ))}
            <Button variant="outline" onClick={() => setSlots((cur) => [...cur, "18:00"])}><Plus className="size-4" /> Add slot</Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Platforms</Label>
          <div className="grid grid-cols-2 gap-2">
            {FARM_PLATFORMS.map((p) => (
              <label key={p} className="flex cursor-pointer items-center gap-2 text-sm text-green-900">
                <input type="checkbox" checked={platforms.includes(p)} onChange={() => togglePlatform(p)} className="size-4 accent-green-700" />
                {PLATFORM_LABELS[p]}
              </label>
            ))}
          </div>
        </div>
      </Card>

      <Card className="space-y-4 p-4">
        <div>
          <h3 className="text-sm font-semibold text-green-900">Nudges</h3>
          <p className="text-[11px] text-green-900/50">When a slot comes due, you get one reminder per short with all the captions and a link to download the finished video.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Notify email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
          <div className="space-y-1">
            <Label>Notify phone (SMS)</Label>
            <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 123 4567" />
          </div>
        </div>
        <p className="text-[11px] text-green-900/50">Email nudges use Resend (set RESEND_API_KEY on the Supabase function). SMS is optional — wire a provider later.</p>
      </Card>

      <Button onClick={() => save.mutate()} loading={save.isPending}><Save className="size-4" /> Save settings</Button>
    </div>
  );
}
