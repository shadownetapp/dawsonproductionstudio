import { createClient } from "@supabase/supabase-js";

// Publishable/anon keys are designed to ship in the browser bundle, so these
// defaults are safe to commit. Override via .env if you point at another project.
const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ?? "https://pdzpmryxvomnyzzokwfc.supabase.co";
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ?? "sb_publishable_Xz9m3jG1fxv32jAsEaZtuA_wVkDnIMF";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

export const SUPABASE_FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;
