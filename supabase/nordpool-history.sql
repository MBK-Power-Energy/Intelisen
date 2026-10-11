create table if not exists nordpool_private.history_queue(delivery_date date not null,slot integer not null,attempted_at timestamptz,finished_at timestamptz,error_message text,primary key(delivery_date,slot));
alter table nordpool_private.history_queue enable row level security;
insert into nordpool_private.history_queue(delivery_date,slot) select d::date,s from generate_series('2026-10-01'::timestamp,((now() at time zone 'Europe/Oslo')::date-1)::timestamp,interval '1 day') d cross join generate_series(0,3) s on conflict do nothing;
create or replace function public.tick_nordpool_history() returns text language plpgsql security definer set search_path=pg_catalog,public,extensions as $$
declare q record;username text;password text;subscription text;token text;r record;body jsonb;g jsonb;c jsonb;a timestamptz;b timestamptz;n integer;
begin
 if not pg_try_advisory_xact_lock(71386424) then return 'skipped';end if;
 -- Keep a margin below the Free database quota; do not delete historical data.
 if pg_database_size(current_database())>450*1024*1024 then return 'capacity_limit';end if;
 select * into q from nordpool_private.history_queue where finished_at is null order by (slot=0) desc,attempted_at nulls first,delivery_date,slot limit 1;
 if not found then return 'complete';end if;
 begin
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

 if q.slot=0 then
 body:=nordpool_private.request('/api/v2/Intraday/ContractStatistics/ByAreas?areas=TEL&date='||q.delivery_date,token,subscription);
 if jsonb_typeof(body) is distinct from 'array' then raise exception 'Invalid statistics response';end if;
 for g in select value from jsonb_array_elements(body) loop
 if g->>'status' is distinct from 'Available' or g->>'deliveryArea' is distinct from 'TEL' or (g->>'deliveryDateCET')::date is distinct from q.delivery_date then raise exception 'Statistics unavailable';end if;
 for c in select value from jsonb_array_elements(g->'contracts') loop
 insert into public.nordpool_contracts as old(area,contract_id,delivery_start,delivery_date,payload) values('TEL',c->>'contractId',(c->>'deliveryStart')::timestamptz,q.delivery_date,(g-'contracts')||c) on conflict(area,contract_id) do update set payload=excluded.payload,collected_at=now() where coalesce(excluded.payload->>'updatedAt','')>=coalesce(old.payload->>'updatedAt','');
 end loop;end loop;
 perform public.sync_nordpool_total(q.delivery_date);
 end if;
 a:=q.delivery_date::timestamp at time zone 'Europe/Oslo';a:=a+q.slot*interval '6 hours';b:=case when q.slot=3 then (q.delivery_date+1)::timestamp at time zone 'Europe/Oslo' else least(a+interval '6 hours',(q.delivery_date+1)::timestamp at time zone 'Europe/Oslo') end;
 body:=nordpool_private.request('/api/v2/Intraday/Trades/ByDeliveryStart?areas=TEL&deliveryStartFrom='||to_char(a at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')||'&deliveryStartTo='||to_char(b at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),token,subscription);
 n:=nordpool_private.ingest_trades(body);
 update nordpool_private.history_queue set finished_at=now(),attempted_at=now(),error_message=null where delivery_date=q.delivery_date and slot=q.slot;return 'ok';
 exception when others then update nordpool_private.history_queue set attempted_at=now(),error_message='Collection failed; previous data retained' where delivery_date=q.delivery_date and slot=q.slot;return 'error';end;
end $$;
revoke all on function public.tick_nordpool_history() from public,anon,authenticated;
select cron.schedule('nordpool-history-5min','3-58/5 * * * *','select public.tick_nordpool_history();');
select public.tick_nordpool_history();
