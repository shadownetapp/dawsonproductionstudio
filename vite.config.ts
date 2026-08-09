import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Note: we use the single-threaded @ffmpeg/core (not -mt), so cross-origin
// isolation (COOP/COEP) is intentionally NOT set — enabling COEP would block
// the cross-origin core fetch from the CDN.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
});
