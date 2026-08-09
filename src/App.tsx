import { Tractor, LogOut } from "lucide-react";
import { supabase } from "./supabase";
import { AuthGate, useAuth } from "./auth";
import { Button } from "./components/ui";
import { Studio } from "./components/studio";

export function App() {
  return (
    <AuthGate>
      <Shell />
    </AuthGate>
  );
}

function Shell() {
  const { session } = useAuth();
  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-green-700 text-white">
            <Tractor className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-green-900">Dawson Content Creations</h1>
            <p className="text-sm text-green-900/60">
              Drop a short — captions, music, and scheduling across TikTok, Instagram, YouTube &amp; Facebook.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-green-900/50 sm:inline">{session?.user.email}</span>
          <Button variant="ghost" onClick={() => supabase.auth.signOut()}>
            <LogOut className="size-4" /> Sign out
          </Button>
        </div>
      </header>
      <Studio />
    </div>
  );
}
