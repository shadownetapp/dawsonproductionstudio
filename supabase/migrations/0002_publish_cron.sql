-- Schedule the assisted-posting nudge every 15 minutes via pg_cron + pg_net.
-- The edge function only acts on slots whose time has actually arrived, so the
-- 15-min cadence just needs to be fine enough to hit each daily slot promptly.
--
-- PREREQUISITES (do these first):
--   1. Deploy the `publish-queue` edge function.
--   2. Set the function secret FARM_CRON_SECRET (supabase secrets set FARM_CRON_SECRET=...).
--   3. Store the SAME value in Vault so this cron can send it:
--        select vault.create_secret('<same-value>', 'FARM_CRON_SECRET');
--   4. Then run this migration.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'farm-publish-queue') then
    perform cron.unschedule('farm-publish-queue');
  end if;
end $$;

select cron.schedule(
  'farm-publish-queue',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://pdzpmryxvomnyzzokwfc.supabase.co/functions/v1/publish-queue',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'FARM_CRON_SECRET' limit 1)
    ),
    body := '{}'::jsonb
  );
  $$
);
