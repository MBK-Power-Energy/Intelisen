-- Nord Pool TEL: acces exclusiv utilizatorilor autorizati, fara acces anon.
create extension if not exists http with schema extensions;
create extension if not exists pg_cron;
create schema if not exists nordpool_private;
revoke all on schema nordpool_private from public, anon, authenticated;
create table if not exists nordpool_private.allowed_emails(email text primary key);
alter table nordpool_private.allowed_emails enable row level security;
create or replace function public.nordpool_authorized() returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from nordpool_private.allowed_emails where email=lower(auth.jwt()->>'email'))
$$;
revoke all on function public.nordpool_authorized() from public,anon;
grant execute on function public.nordpool_authorized() to authenticated;
create table if not exists public.nordpool_contracts(
 area text not null, contract_id text not null, delivery_start timestamptz not null,
 delivery_date date not null, payload jsonb not null, collected_at timestamptz not null default now(), primary key(area,contract_id));
create table if not exists public.nordpool_trades(
 area text not null, contract_id text not null, trade_id text not null,
 delivery_start timestamptz not null, trade_time timestamptz not null,
 revision integer not null, state text not null, payload jsonb not null,
 collected_at timestamptz not null default now(), primary key(area,contract_id,trade_id));
create index if not exists nordpool_trades_contract on public.nordpool_trades(contract_id,trade_time);
create index if not exists nordpool_contracts_date on public.nordpool_contracts(delivery_date);
create table if not exists public.nordpool_runs(id bigint generated always as identity primary key,
 started_at timestamptz not null default now(), finished_at timestamptz, status text not null,
 contracts_count integer default 0, trades_count integer default 0, error_message text);
alter table public.nordpool_contracts enable row level security;
alter table public.nordpool_trades enable row level security;
alter table public.nordpool_runs enable row level security;
revoke all on public.nordpool_contracts,public.nordpool_trades,public.nordpool_runs from anon,authenticated;
grant select on public.nordpool_contracts,public.nordpool_trades,public.nordpool_runs to authenticated;
drop policy if exists np_contracts_read on public.nordpool_contracts;
create policy np_contracts_read on public.nordpool_contracts for select to authenticated using(public.nordpool_authorized());
drop policy if exists np_trades_read on public.nordpool_trades;
create policy np_trades_read on public.nordpool_trades for select to authenticated using(public.nordpool_authorized());
drop policy if exists np_runs_read on public.nordpool_runs;
create policy np_runs_read on public.nordpool_runs for select to authenticated using(public.nordpool_authorized());
-- Credentials must be stored in Supabase Vault: np_username, np_password,
-- optionally np_subscription_key. No credentials are included in this script.
create or replace function nordpool_private.request(path text, token text, subscription text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,extensions as $$
declare response record; headers extensions.http_header[];
begin
 perform pg_sleep(1.05);
 headers:=array[extensions.http_header('Authorization','Bearer '||token),extensions.http_header('Accept','application/json')];
 if nullif(subscription,'') is not null then headers:=array_append(headers,extensions.http_header('Ocp-Apim-Subscription-Key',subscription)); end if;
 perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','30000');
 select * into response from extensions.http(('GET','https://data-api.nordpoolgroup.com'||path,headers,null,null)::extensions.http_request);
 if response.status=204 then return jsonb_build_object('contracts','[]'::jsonb); end if;
 if response.status<>200 then raise exception 'Nord Pool HTTP %',response.status; end if;
 return response.content::jsonb;
end $$;
create or replace function nordpool_private.ingest_trades(body jsonb) returns integer
language plpgsql security definer set search_path=pg_catalog,public as $$
declare c jsonb;t jsonb;n integer:=0;
begin
 if jsonb_typeof(body->'contracts') is distinct from 'array' then raise exception 'Missing contracts';end if;
 for c in select value from jsonb_array_elements(body->'contracts') loop
 for t in select value from jsonb_array_elements(c->'trades') loop
 if t->>'tradeId' is null or t->>'tradeTime' is null or t->>'revisionNumber' is null then raise exception 'Invalid trade';end if;
 if not exists(select 1 from jsonb_array_elements(t->'legs') l where l->>'deliveryArea'='TEL') then raise exception 'Invalid trade area';end if;
 insert into public.nordpool_trades as old(area,contract_id,trade_id,delivery_start,trade_time,revision,state,payload)
 values('TEL',c->>'contractId',t->>'tradeId',(c->>'deliveryStart')::timestamptz,(t->>'tradeTime')::timestamptz,(t->>'revisionNumber')::integer,t->>'tradeState',(c-'trades')||t||jsonb_build_object('volumeUnit',body->>'volumeUnit'))
 on conflict(area,contract_id,trade_id) do update set payload=excluded.payload,revision=excluded.revision,state=excluded.state,trade_time=excluded.trade_time,collected_at=now()
 where excluded.revision>old.revision or (excluded.revision=old.revision and coalesce(excluded.payload->>'tradeUpdatedAt','')>=coalesce(old.payload->>'tradeUpdatedAt',''));
 n:=n+1;
 end loop;end loop;return n;
end $$;
create or replace function public.sync_nordpool() returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,extensions as $$
declare username text;password text;subscription text;token text;r record;body jsonb;g jsonb;c jsonb;
 day date:=(now() at time zone 'Europe/Oslo')::date;d date;rid bigint;nc integer:=0;nt integer:=0;
 a timestamptz;b timestamptz;slot integer;window_end timestamptz;slots integer;
begin
 if not pg_try_advisory_xact_lock(71386424) then return jsonb_build_object('status','skipped');end if;
 insert into public.nordpool_runs(status) values('running') returning id into rid;
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
 -- Statistics: 15-minute publication; re-read adjacent days for final corrections.
 if extract(minute from now())::integer%15<5 or not exists(select 1 from public.nordpool_contracts) then
 for d in select generate_series(day-1,day+2,interval '1 day')::date loop
 body:=nordpool_private.request('/api/v2/Intraday/ContractStatistics/ByAreas?areas=TEL&date='||d,token,subscription);
 if jsonb_typeof(body) is distinct from 'array' then raise exception 'Invalid statistics response';end if;
 for g in select value from jsonb_array_elements(body) loop
 if g->>'status'='Missing' then continue;end if;
 if g->>'status' is distinct from 'Available' or g->>'deliveryArea' is distinct from 'TEL' or (g->>'deliveryDateCET')::date is distinct from d then raise exception 'Invalid statistics date/area';end if;
 for c in select value from jsonb_array_elements(g->'contracts') loop
 insert into public.nordpool_contracts as old(area,contract_id,delivery_start,delivery_date,payload)
 values('TEL',c->>'contractId',(c->>'deliveryStart')::timestamptz,d,(g-'contracts')||c)
 on conflict(area,contract_id) do update set payload=excluded.payload,collected_at=now()
 where coalesce(excluded.payload->>'updatedAt','')>=coalesce(old.payload->>'updatedAt','');nc:=nc+1;
 end loop;end loop;end loop;end if;
 -- Overlap protects against publication delay and revised trades.
 a:=date_trunc('minute',now())-interval '2 hours';b:=date_trunc('minute',now());
 body:=nordpool_private.request('/api/v2/Intraday/Trades/ByTradeTime?areas=TEL&tradeTimeFrom='||to_char(a at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')||'&tradeTimeTo='||to_char(b at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),token,subscription);
 nt:=nt+nordpool_private.ingest_trades(body);
 -- Rotate eight 6h delivery windows: yesterday and today fully reconciled in 40min.
 window_end:=((day+1)::timestamp at time zone 'Europe/Oslo');
 slots:=ceil(extract(epoch from (window_end-((day-1)::timestamp at time zone 'Europe/Oslo')))/21600)::integer;
 slot:=mod(floor(extract(epoch from now())/300)::integer,slots);
 a:=((day-1)::timestamp at time zone 'Europe/Oslo')+slot*interval '6 hours';b:=least(a+interval '6 hours',window_end);
 body:=nordpool_private.request('/api/v2/Intraday/Trades/ByDeliveryStart?areas=TEL&deliveryStartFrom='||to_char(a at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')||'&deliveryStartTo='||to_char(b at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),token,subscription);
 nt:=nt+nordpool_private.ingest_trades(body);
 update public.nordpool_runs set status='ok',finished_at=clock_timestamp(),contracts_count=nc,trades_count=nt where id=rid;
 exception when others then
 -- Never return remote response bodies or credentials in error logs.
 update public.nordpool_runs set status='error',finished_at=clock_timestamp(),error_message=case when sqlerrm like 'Nord Pool %' then sqlerrm else 'Collection failed; previous data retained' end where id=rid;
 end;
 return(select to_jsonb(x) from public.nordpool_runs x where id=rid);
end $$;
revoke all on all functions in schema nordpool_private from public,anon,authenticated;
revoke all on function public.sync_nordpool() from public,anon,authenticated;
select cron.schedule('nordpool-tel-5min','*/5 * * * *','select public.sync_nordpool();');
