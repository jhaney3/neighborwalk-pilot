-- Operator-only activation after the worker's authenticated empty-queue check.
-- Provision these two Vault values securely before running; no literal secret
-- belongs in this file, cron.job, source control or command-line arguments.
begin;
do $$
declare worker_secret text; service_origin text;
begin
  select decrypted_secret into strict worker_secret
    from vault.decrypted_secrets where name = 'sendme_push_worker_secret';
  select decrypted_secret into strict service_origin
    from vault.decrypted_secrets where name = 'sendme_service_origin';
  if length(worker_secret) < 32
    or service_origin !~ '^https://[a-z]{20}\.supabase\.co$' then
    raise exception 'Invalid SendMe push scheduler configuration';
  end if;
end $$;

select cron.schedule(
  'sendme-push-delivery', '* * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets
      where name = 'sendme_service_origin') || '/functions/v1/push-delivery',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret
        from vault.decrypted_secrets where name = 'sendme_push_worker_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
  $job$
);
commit;
