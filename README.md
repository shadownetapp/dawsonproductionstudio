# Dawson Content Creations

A standalone app to turn raw short-form clips into posts: **drop a clip →
Claude writes a caption per platform → add a royalty-free music bed (rendered in
your browser) → schedule into daily slots → get a nudge with everything ready to
post** across TikTok, Instagram, YouTube, and Facebook.

Posting is **assisted/manual** — nothing auto-publishes, so there are no platform
API approvals. You download the finished video and captions and post them.

## Stack

- **Frontend:** Vite + React + TypeScript SPA, Tailwind, TanStack Query.
- **Backend:** Supabase — Auth (team sign-in), Postgres + Storage, two Edge
  Functions (Claude captioning + the scheduled nudge), and `pg_cron` for the
  4×/day trigger.
- **Rendering:** `ffmpeg.wasm` in the browser (music mux + optional caption burn-in).
- **Hosting:** Cloudflare Workers static assets (`wrangler deploy`).

This app is fully independent of any other project — its own repo, its own
Supabase project (`pdzpmryxvomnyzzokwfc`), its own deploy.

## Run locally

```bash
npm install
cp .env.example .env      # values already point at the Supabase project
npm run dev               # http://localhost:5173
```

## Deploy the frontend (Cloudflare)

```bash
npm run build
npx wrangler deploy       # serves ./dist as a single-page app
```

Set your deployed URL as `FARM_APP_URL` on the Supabase functions (below) so the
nudge emails can link back to the app.

## Backend setup (one time)

The database schema is already applied (`supabase/migrations/0001_farm_studio_init.sql`).
To finish the backend:

1. **Link the CLI:** `supabase link --project-ref pdzpmryxvomnyzzokwfc`
2. **Set function secrets:**
   ```bash
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...       # captioning
   supabase secrets set FARM_CRON_SECRET=$(openssl rand -hex 24)  # guards the cron
   supabase secrets set RESEND_API_KEY=re_...              # nudge emails (optional)
   supabase secrets set FARM_FROM_EMAIL="Dawson Content Creations <you@yourdomain>"
   supabase secrets set FARM_APP_URL=https://<your-cloudflare-url>
   ```
3. **Deploy functions** (also deployable from the Supabase dashboard):
   ```bash
   supabase functions deploy generate-captions
   supabase functions deploy publish-queue --no-verify-jwt
   ```
   (`generate-captions` keeps JWT verification; `publish-queue` is called by cron
   and is gated by `FARM_CRON_SECRET` instead.)
4. **Schedule the cron:** store the cron secret in Vault, then apply the cron
   migration:
   ```sql
   select vault.create_secret('<same FARM_CRON_SECRET value>', 'FARM_CRON_SECRET');
   ```
   then run `supabase/migrations/0002_publish_cron.sql`.

## Team access

Any signed-in user can use the studio. Control who gets in via the Supabase
dashboard → Authentication:
- Turn **off** open sign-ups, and invite teammates by email, **or**
- leave sign-ups on only while your team registers, then turn them off.

## Music

Five bundled beds are synthesized in the browser (original, royalty-free — no
audio files shipped). Add your own licensed tracks in the **Music** tab.

## Adding real auto-posting later

`farm_posts` already tracks per-platform status and the live URL, so the
assisted "nudge" step can later be swapped for direct platform APIs or an
aggregator (e.g. Ayrshare) without schema changes.
