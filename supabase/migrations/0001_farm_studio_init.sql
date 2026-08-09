-- 6th Day Farm Content — standalone schema. Team auth: any authenticated user
-- (sign-ups are invite-controlled in the Supabase dashboard).
-- Already applied to the linked project; kept here as source of truth.

insert into storage.buckets (id, name, public) values
  ('farm-uploads','farm-uploads',false),
  ('farm-renders','farm-renders',false),
  ('farm-music','farm-music',false)
on conflict (id) do nothing;

do $$
declare b text;
begin
  foreach b in array array['farm-uploads','farm-renders','farm-music'] loop
    execute format($f$drop policy if exists %I on storage.objects$f$, 'farm read '||b);
    execute format($f$create policy %I on storage.objects for select to authenticated using (bucket_id = %L)$f$, 'farm read '||b, b);
    execute format($f$drop policy if exists %I on storage.objects$f$, 'farm insert '||b);
    execute format($f$create policy %I on storage.objects for insert to authenticated with check (bucket_id = %L)$f$, 'farm insert '||b, b);
    execute format($f$drop policy if exists %I on storage.objects$f$, 'farm update '||b);
    execute format($f$create policy %I on storage.objects for update to authenticated using (bucket_id = %L) with check (bucket_id = %L)$f$, 'farm update '||b, b, b);
    execute format($f$drop policy if exists %I on storage.objects$f$, 'farm delete '||b);
    execute format($f$create policy %I on storage.objects for delete to authenticated using (bucket_id = %L)$f$, 'farm delete '||b, b);
  end loop;
end $$;

create table if not exists public.farm_music (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  kind text not null default 'upload' check (kind in ('procedural','upload')),
  preset_key text,
  storage_path text,
  mood text,
  license text not null default 'Original / royalty-free',
  duration_sec numeric,
  is_active boolean not null default true,
  sort_order int not null default 100,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.farm_videos (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'Untitled short',
  description text,
  status text not null default 'draft'
    check (status in ('draft','captioned','rendering','ready','scheduled','published','archived','failed')),
  source_path text not null,
  source_mime text,
  source_size bigint,
  duration_sec numeric,
  width int,
  height int,
  thumbnail_path text,
  music_id uuid references public.farm_music(id) on delete set null,
  burn_caption boolean not null default false,
  overlay_text text,
  render_path text,
  render_error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists farm_videos_status_idx on public.farm_videos (status, created_at desc);

create table if not exists public.farm_captions (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.farm_videos(id) on delete cascade,
  platform text not null check (platform in ('tiktok','instagram','youtube','facebook')),
  title text,
  caption text not null default '',
  hashtags text[] not null default '{}',
  updated_at timestamptz not null default now(),
  unique (video_id, platform)
);

create table if not exists public.farm_posts (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.farm_videos(id) on delete cascade,
  platform text not null check (platform in ('tiktok','instagram','youtube','facebook')),
  scheduled_at timestamptz not null,
  status text not null default 'queued' check (status in ('queued','ready','posted','skipped','failed')),
  notified_at timestamptz,
  posted_at timestamptz,
  posted_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (video_id, platform)
);
create index if not exists farm_posts_due_idx on public.farm_posts (status, scheduled_at);

create table if not exists public.farm_settings (
  id text primary key default 'default',
  timezone text not null default 'America/New_York',
  daily_slots text[] not null default array['08:00','12:00','16:00','20:00'],
  platforms text[] not null default array['tiktok','instagram','youtube','facebook'],
  notify_email text,
  notify_phone text,
  updated_at timestamptz not null default now()
);
insert into public.farm_settings (id) values ('default') on conflict (id) do nothing;

create or replace function public.farm_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists farm_videos_touch on public.farm_videos;
create trigger farm_videos_touch before update on public.farm_videos for each row execute function public.farm_touch_updated_at();
drop trigger if exists farm_captions_touch on public.farm_captions;
create trigger farm_captions_touch before update on public.farm_captions for each row execute function public.farm_touch_updated_at();
drop trigger if exists farm_posts_touch on public.farm_posts;
create trigger farm_posts_touch before update on public.farm_posts for each row execute function public.farm_touch_updated_at();
drop trigger if exists farm_settings_touch on public.farm_settings;
create trigger farm_settings_touch before update on public.farm_settings for each row execute function public.farm_touch_updated_at();

alter table public.farm_music enable row level security;
alter table public.farm_videos enable row level security;
alter table public.farm_captions enable row level security;
alter table public.farm_posts enable row level security;
alter table public.farm_settings enable row level security;

do $$
declare t text;
begin
  foreach t in array array['farm_music','farm_videos','farm_captions','farm_posts','farm_settings'] loop
    execute format($f$drop policy if exists %I on public.%I$f$, t||'_auth_all', t);
    execute format($f$create policy %I on public.%I for all to authenticated using (true) with check (true)$f$, t||'_auth_all', t);
  end loop;
end $$;

insert into public.farm_music (title, kind, preset_key, mood, duration_sec, sort_order, license) values
  ('Sunrise Pasture','procedural','sunrise','calm',60,10,'Original / royalty-free'),
  ('Golden Hour','procedural','golden','warm',60,20,'Original / royalty-free'),
  ('Gentle Trot','procedural','trot','upbeat',60,30,'Original / royalty-free'),
  ('Barn Morning','procedural','barn','calm',60,40,'Original / royalty-free'),
  ('Open Fields','procedural','fields','bright',60,50,'Original / royalty-free')
on conflict do nothing;
