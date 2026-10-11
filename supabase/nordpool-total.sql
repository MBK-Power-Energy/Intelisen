-- Nordpool project. Total statistics are distinct from TEL ByAreas.
create table if not exists public.nordpool_total_statistics(
 delivery_date date primary key,payload jsonb not null,collected_at timestamptz not null default now());
alter table public.nordpool_total_statistics enable row level security;
create policy np_total_read on public.nordpool_total_statistics for select to authenticated using(public.nordpool_authorized());
revoke all on public.nordpool_total_statistics from anon;
grant select on public.nordpool_total_statistics to authenticated;
create or replace function public.sync_nordpool_total(p_day date default (now() at time zone 'Europe/Oslo')::date)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,extensions as $$
declare username text;password text;subscription text;token text;r record;body jsonb;g jsonb;
begin
 if not pg_try_advisory_xact_lock(71386424) then return jsonb_build_object('status','skipped');end if;
 select decrypted_secret into username from vault.decrypted_secrets where name='np_username';
 select decrypted_secret into password from vault.decrypted_secrets where name='np_password';
 select decrypted_secret into subscription from vault.decrypted_secrets where name='np_subscription_key';
 if username is null or password is null then raise exception 'Nord Pool credentials missing in Vault';end if;
 perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','30000');
 select * into r from extensions.http(('POST','https://sts.nordpoolgroup.com/connect/token',
 array[extensions.http_header('Authorization','Basic '||replace(encode(convert_to('client_marketdata_api:client_marketdata_api','UTF8'),'base64'),E'\n',''))],
 'application/x-www-form-urlencoded','grant_type=password&scope=marketdata_api&username='||extensions.urlencode(username)||'&password='||extensions.urlencode(password))::extensions.http_request);
 if r.status<>200 then raise exception 'Nord Pool authentication HTTP %',r.status;end if;
 token:=r.content::jsonb->>'access_token';if token is null then raise exception 'Missing access token';end if;

 body:=nordpool_private.request('/api/v2/Intraday/ContractStatistics/Total?date='||p_day,token,subscription);
 if jsonb_typeof(body)='object' then body:=jsonb_build_array(body);end if;
 if jsonb_typeof(body) is distinct from 'array' then raise exception 'Invalid Total schema';end if;
 for g in select value from jsonb_array_elements(body) loop
 if g->>'status'='Missing' then continue;end if;
 if g->>'status' is distinct from 'Available' or (g->>'deliveryDateCET')::date is distinct from p_day or jsonb_typeof(g->'contracts') is distinct from 'array' then raise exception 'Invalid Total date/status';end if;
 end loop;
 insert into public.nordpool_total_statistics values(p_day,body,now()) on conflict(delivery_date) do update set payload=excluded.payload,collected_at=excluded.collected_at;
 return jsonb_build_object('status','ok');
end $$;
revoke all on function public.sync_nordpool_total(date) from public,anon,authenticated;
select cron.schedule('nordpool-total-quarter-hour','2,17,32,47 * * * *',$job$select public.sync_nordpool_total((now() at time zone 'Europe/Oslo')::date-1);select public.sync_nordpool_total((now() at time zone 'Europe/Oslo')::date);select public.sync_nordpool_total((now() at time zone 'Europe/Oslo')::date+1);$job$);
