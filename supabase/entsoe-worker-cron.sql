create extension if not exists pg_net with schema extensions;
create or replace function public.trigger_entsoe_worker() returns bigint language plpgsql security definer set search_path=pg_catalog,public as $$
declare secret text;request_id bigint;
begin
 select decrypted_secret into secret from vault.decrypted_secrets where name='entsoe_worker_secret';
 if secret is null then raise exception 'Missing worker credential';end if;
 select net.http_post(url:='https://squtjqwjnwlnqlvfzlzg.supabase.co/functions/v1/entsoe-collector',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNxdXRqcXdqbndsbnFsdmZ6bHpnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE3MDg3MTAsImV4cCI6MjEwNzI4NDcxMH0.tfIId7XK43iVtkimhmdaP-yrKa9xSwFPxbk_fadKYvw','x-collector-secret',secret),body:='{}'::jsonb,timeout_milliseconds:=120000) into request_id;
 return request_id;
end $$;
revoke all on function public.trigger_entsoe_worker() from public,anon,authenticated;
select cron.alter_job(jobid,active:=false) from cron.job where jobname='entsoe-documents-minute';
select cron.schedule('entsoe-edge-minute','* * * * *','select public.trigger_entsoe_worker();');
select public.trigger_entsoe_worker();
