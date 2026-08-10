import { useState } from "react";
import { Tractor, LogOut, Clapperboard, Shield, Film, Music2, Settings2 } from "lucide-react";
import { supabase } from "./supabase";
import { AuthGate, useAuth } from "./auth";
import { Button, Tabs } from "./components/ui";
import { ShortsWorkspace } from "./components/studio";
import { LongForm } from "./components/longform";
import { MusicTab } from "./components/music-tab";
import { SettingsTab } from "./components/settings-tab";

export function App() {
  return (
    <AuthGate>
      <Shell />
    </AuthGate>
  );
}

const TAB = (Icon: typeof Clapperboard, label: string) => (
  <span className="inline-flex items-center gap-1.5">
    <Icon className="size-4" /> {label}
  </span>
);

function Shell() {
  const { session } = useAuth();
  const [section, setSection] = useState("farm");
  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <header className="mb-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-green-700 text-white">
            <Tractor className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-green-900">Dawson Content Creations</h1>
            <p className="text-sm text-green-900/60">Shorts, long-form, captions, music &amp; scheduling — all in one place.</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-green-900/50 sm:inline">{session?.user.email}</span>
          <Button variant="ghost" onClick={() => supabase.auth.signOut()}>
            <LogOut className="size-4" /> Sign out
          </Button>
        </div>
      </header>

      <div className="mb-5 overflow-x-auto">
        <Tabs
          value={section}
          onChange={setSection}
          tabs={[
            { value: "farm", label: TAB(Clapperboard, "Farm Shorts") },
            { value: "shadownet", label: TAB(Shield, "Shadownet Shorts") },
            { value: "longform", label: TAB(Film, "Long Form") },
            { value: "music", label: TAB(Music2, "Music") },
            { value: "settings", label: TAB(Settings2, "Settings") },
          ]}
        />
      </div>

      {section === "farm" && <ShortsWorkspace workspace="farm" />}
      {section === "shadownet" && <ShortsWorkspace workspace="shadownet" />}
      {section === "longform" && <LongForm />}
      {section === "music" && <MusicTab />}
      {section === "settings" && <SettingsTab />}
    </div>
  );
}
