-- Demo DAMAS. Se ruleaza in SQL Editor al unui proiect Supabase nou.
-- Doar date publice DAMAS sunt accesibile prin API; colectarea este rezervata administratorului.
create extension if not exists http with schema extensions;
create extension if not exists pg_cron;

create table if not exists public.damas_intervals (
 interval_start timestamptz primary key,
 interval_end timestamptz not null,
 source_id text,
 isp integer,
 source_type text,
 estimated_system_imbalance numeric,
 activated_reserve numeric,
 payload jsonb not null,
 first_seen_at timestamptz not null default now(),
 last_seen_at timestamptz not null default now(),
 changed_at timestamptz not null default now(),
 check (interval_end - interval_start = interval '15 minutes')
);
create table if not exists public.damas_runs (
 id bigint generated always as identity primary key,
 started_at timestamptz not null default now(),
 finished_at timestamptz,
 delivery_date date not null,
 status text not null check(status in ('running','ok','partial','error')),
 received_rows integer,
 expected_rows integer,
 changed_rows integer,
 error_message text
);
create schema if not exists damas_private;
create table if not exists damas_private.revisions (
 id bigint generated always as identity primary key,
 interval_start timestamptz not null,
 observed_at timestamptz not null default now(),
 payload jsonb not null
);
alter table public.damas_intervals enable row level security;
alter table public.damas_runs enable row level security;
drop policy if exists "Read public DAMAS observations" on public.damas_intervals;
create policy "Read public DAMAS observations" on public.damas_intervals for select to anon, authenticated using (true);
drop policy if exists "Read DAMAS collection status" on public.damas_runs;
create policy "Read DAMAS collection status" on public.damas_runs for select to anon, authenticated using (true);
grant select on public.damas_intervals, public.damas_runs to anon, authenticated;
revoke all on schema damas_private from public, anon, authenticated;

create or replace function public.sync_damas(p_day date default (now() at time zone 'Europe/Bucharest')::date)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, extensions
as $$
declare
 a timestamptz := p_day::timestamp at time zone 'Europe/Bucharest';
 b timestamptz := (p_day + 1)::timestamp at time zone 'Europe/Bucharest';
 endpoint text := 'https://newmarkets.transelectrica.ro/usy-durom-publicreportg01/00121002500000000000000000000100/publicReport/estimatedPowerSystemImbalance';
 response record; body jsonb; item jsonb; left_at timestamptz; right_at timestamptz;
 run_id bigint; changed integer := 0; received integer; expected integer; n integer;
 state text;
begin
 if not pg_try_advisory_xact_lock(71386422) then
  return jsonb_build_object('status','skipped','reason','collection_in_progress');
 end if;
 expected := extract(epoch from (b-a))::integer / 900;
 insert into public.damas_runs(delivery_date,status,expected_rows) values(p_day,'running',expected) returning id into run_id;
 begin
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','15000');
  select * into response from extensions.http_get(endpoint || '?timeInterval.from=' ||
    to_char(a at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || '&timeInterval.to=' ||
    to_char(b at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || '&pageInfo.pageSize=3000');
  if response.status <> 200 then raise exception 'DAMAS HTTP %', response.status; end if;
  body := response.content::jsonb;
  if jsonb_typeof(body->'itemList') is distinct from 'array' then raise exception 'Missing itemList array'; end if;
  if coalesce(body->'uuAppErrorMap','{}'::jsonb) <> '{}'::jsonb then raise exception 'DAMAS returned API warnings or errors'; end if;
  received := jsonb_array_length(body->'itemList');
  if body #>> '{pageInfo,total}' is null then raise exception 'Missing pagination total'; end if;
  if (body #>> '{pageInfo,total}')::integer <> received then raise exception 'Truncated response'; end if;
  if received > expected then raise exception 'Too many intervals'; end if;
  select count(distinct e #>> '{timeInterval,from}') into n from jsonb_array_elements(body->'itemList') e;
  if n <> received then raise exception 'Duplicate interval starts'; end if;
  for item in select value from jsonb_array_elements(body->'itemList') loop
   left_at := (item #>> '{timeInterval,from}')::timestamptz;
   right_at := (item #>> '{timeInterval,to}')::timestamptz;
   if left_at is null or right_at is null or left_at < a or right_at > b or right_at-left_at <> interval '15 minutes'
     or mod(extract(epoch from (left_at-a))::numeric,900) <> 0 then raise exception 'Invalid interval'; end if;
   if not exists(select 1 from public.damas_intervals d where d.interval_start=left_at and d.payload=item) then
    insert into damas_private.revisions(interval_start,payload) values(left_at,item);
    changed := changed+1;
   end if;
   insert into public.damas_intervals as d(interval_start,interval_end,source_id,isp,source_type,estimated_system_imbalance,activated_reserve,payload)
   values(left_at,right_at,item->>'id',(item->>'ISP')::integer,item->>'type',nullif(nullif(item->>'estimatedSystemImbalance','NaN'),'N/A')::numeric,nullif(nullif(item->>'activatedReserve','NaN'),'N/A')::numeric,item)
   on conflict(interval_start) do update set
    interval_end=excluded.interval_end,source_id=excluded.source_id,isp=excluded.isp,source_type=excluded.source_type,
    estimated_system_imbalance=excluded.estimated_system_imbalance,activated_reserve=excluded.activated_reserve,
    changed_at=case when d.payload is distinct from excluded.payload then now() else d.changed_at end,
    payload=excluded.payload,last_seen_at=now();
  end loop;
  state := case when received=expected then 'ok' else 'partial' end;
  update public.damas_runs set status=state,finished_at=clock_timestamp(),received_rows=received,changed_rows=changed where id=run_id;
  return jsonb_build_object('status',state,'received',received,'expected',expected,'changed',changed);
 exception when others then
  -- Subtransaction rollback prevents any partial replacement of valid observations.
  update public.damas_runs set status='error',finished_at=clock_timestamp(),error_message=left(SQLERRM,500) where id=run_id;
  return jsonb_build_object('status','error','run_id',run_id,'message',SQLERRM);
 end;
end;
$$;
revoke all on function public.sync_damas(date) from public, anon, authenticated;
grant execute on function public.sync_damas(date) to postgres;

-- Initial verification of the day supplied for this demo.
select public.sync_damas((now() at time zone 'Europe/Bucharest')::date);
-- Every minute, re-fetch the live day and yesterday to capture revisions.
-- The named job is updated rather than duplicated when this setup is re-run.
select cron.schedule('damas-imbalance-minute','* * * * *',
 $job$ select public.sync_damas((now() at time zone 'Europe/Bucharest')::date);
 select public.sync_damas((now() at time zone 'Europe/Bucharest')::date - 1); $job$);

-- SEN: schema si colectare. Raspunsul contine randuri separate prin | si 12 campuri separate prin ;.
create table if not exists public.sen_observations (
 observed_at timestamptz primary key,
 source_local_time text not null,
 consumption_mw numeric, hourly_average_consumption_mw numeric,
 production_mw numeric, balance_mw numeric,
 coal_mw numeric, hydrocarbons_mw numeric, hydro_mw numeric, nuclear_mw numeric,
 wind_mw numeric, solar_mw numeric, biomass_mw numeric,
 estimated_fields text[] not null default '{}',
 payload jsonb not null,
 first_seen_at timestamptz not null default now(),
 last_seen_at timestamptz not null default now(),
 changed_at timestamptz not null default now()
);
create table if not exists public.sen_runs (
 id bigint generated always as identity primary key,
 started_at timestamptz not null default now(),finished_at timestamptz,
 status text not null check(status in ('running','ok','partial','error')),
 received_rows integer, changed_rows integer, quarantined_rows integer,
 latest_observed_at timestamptz,error_message text
);
create table if not exists damas_private.sen_revisions (
 id bigint generated always as identity primary key,
 observed_at timestamptz not null, collected_at timestamptz not null default now(),payload jsonb not null
);
create table if not exists damas_private.sen_quarantine (
 raw_row text primary key, reason text not null, first_seen_at timestamptz not null default now(),last_seen_at timestamptz not null default now()
);
alter table public.sen_observations enable row level security;
alter table public.sen_runs enable row level security;
drop policy if exists "Read public SEN observations" on public.sen_observations;
create policy "Read public SEN observations" on public.sen_observations for select to anon, authenticated using (true);
drop policy if exists "Read SEN collection status" on public.sen_runs;
create policy "Read SEN collection status" on public.sen_runs for select to anon, authenticated using (true);
grant select on public.sen_observations, public.sen_runs to anon, authenticated;

create or replace function public.sync_sen()
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, extensions
as $$
declare
 start_local timestamp := (now() - interval '24 hours') at time zone 'Europe/Bucharest';
 end_local timestamp := now() at time zone 'Europe/Bucharest';
 base text := 'https://www.transelectrica.ro/widget/web/tel/sen-grafic?p_p_id=SENGrafic_WAR_SENGraficportlet&p_p_lifecycle=2&p_p_state=maximized&p_p_mode=view&p_p_cacheability=cacheLevelPage&_SENGrafic_WAR_SENGraficportlet_random=random';
 url text; response record; run_id bigint; row_text text; cells text[]; local_at timestamp; utc_at timestamptz;
 received integer := 0; changed integer := 0; quarantined integer := 0; latest timestamptz;
 record_data jsonb; estimates text[]; i integer; stamp timestamp; side text; v numeric[];
 names text[] := array['consumption_mw','hourly_average_consumption_mw','production_mw','balance_mw','coal_mw','hydrocarbons_mw','hydro_mw','nuclear_mw','wind_mw','solar_mw','biomass_mw'];
begin
 if not pg_try_advisory_xact_lock(71386423) then return jsonb_build_object('status','skipped','reason','collection_in_progress'); end if;
 insert into public.sen_runs(status) values('running') returning id into run_id;
 begin
  url := base;
  for i in 1..2 loop
   stamp := case when i=1 then start_local else end_local end;
   side := case when i=1 then 'start' else 'end' end;
   url := url || '&_SENGrafic_WAR_SENGraficportlet_' || side || '_day=' || extract(day from stamp)::integer
     || '&_SENGrafic_WAR_SENGraficportlet_' || side || '_month=' || extract(month from stamp)::integer
     || '&_SENGrafic_WAR_SENGraficportlet_' || side || '_year=' || extract(year from stamp)::integer
     || '&_SENGrafic_WAR_SENGraficportlet_' || side || '_Hour=' || extract(hour from stamp)::integer
     || '&_SENGrafic_WAR_SENGraficportlet_' || side || '_Minute=' || extract(minute from stamp)::integer;
  end loop;
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','15000');
  select * into response from extensions.http_get(url);
  if response.status <> 200 then raise exception 'SEN HTTP %', response.status; end if;
  if response.content ~* '<html|<!doctype' then raise exception 'SEN returned HTML'; end if;
  for row_text in select btrim(value) from unnest(string_to_array(response.content,'|')) value loop
   if row_text='' then continue; end if;
   cells := string_to_array(rtrim(row_text,';'),';');
   if array_length(cells,1)<>12 then raise exception 'SEN schema changed: expected 12 fields'; end if;
   received := received + 1;
   -- Cast ISO-formatted local timestamp after validating the source's exact DD-MM-YYYY format.
   if cells[1] !~ '^\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}$' then raise exception 'Invalid source time'; end if;
   local_at := (substring(cells[1],7,4)||'-'||substring(cells[1],4,2)||'-'||substring(cells[1],1,2)||substring(cells[1],11))::timestamp;
   utc_at := local_at at time zone 'Europe/Bucharest';
   if (utc_at at time zone 'Europe/Bucharest')<>local_at
    or ((utc_at-interval '1 hour') at time zone 'Europe/Bucharest')=local_at
    or ((utc_at+interval '1 hour') at time zone 'Europe/Bucharest')=local_at then
    insert into damas_private.sen_quarantine(raw_row,reason) values(row_text,'ambiguous_or_nonexistent_local_time')
    on conflict(raw_row) do update set last_seen_at=now();
    quarantined := quarantined+1;continue;
   end if;
   if local_at < start_local-interval '1 minute' or local_at > end_local+interval '1 minute' then raise exception 'SEN timestamp outside requested window'; end if;
   v := '{}';estimates := '{}';
   for i in 2..12 loop
    v := array_append(v,nullif(btrim(cells[i]),'')::numeric);
    if cells[i] ~ '\.00$' then estimates:=array_append(estimates,names[i-1]); end if;
   end loop;
   record_data := jsonb_build_object('source_local_time',cells[1],'values',to_jsonb(v),'estimated_fields',to_jsonb(estimates));
   if not exists(select 1 from public.sen_observations s where s.observed_at=utc_at and s.payload=record_data) then
    insert into damas_private.sen_revisions(observed_at,payload) values(utc_at,record_data);changed:=changed+1;
   end if;
   insert into public.sen_observations as s(observed_at,source_local_time,consumption_mw,hourly_average_consumption_mw,production_mw,balance_mw,coal_mw,hydrocarbons_mw,hydro_mw,nuclear_mw,wind_mw,solar_mw,biomass_mw,estimated_fields,payload)
   values(utc_at,cells[1],v[1],v[2],v[3],v[4],v[5],v[6],v[7],v[8],v[9],v[10],v[11],estimates,record_data)
   on conflict(observed_at) do update set
    consumption_mw=excluded.consumption_mw,hourly_average_consumption_mw=excluded.hourly_average_consumption_mw,
    production_mw=excluded.production_mw,balance_mw=excluded.balance_mw,coal_mw=excluded.coal_mw,
    hydrocarbons_mw=excluded.hydrocarbons_mw,hydro_mw=excluded.hydro_mw,nuclear_mw=excluded.nuclear_mw,
    wind_mw=excluded.wind_mw,solar_mw=excluded.solar_mw,biomass_mw=excluded.biomass_mw,
    estimated_fields=excluded.estimated_fields,
    changed_at=case when s.payload is distinct from excluded.payload then now() else s.changed_at end,
    payload=excluded.payload,last_seen_at=now();
   latest := case when latest is null or utc_at>latest then utc_at else latest end;
  end loop;
  if received=0 then raise exception 'SEN returned no observations'; end if;
  update public.sen_runs set status=case when quarantined>0 then 'partial' else 'ok' end,
   finished_at=clock_timestamp(),received_rows=received,changed_rows=changed,quarantined_rows=quarantined,latest_observed_at=latest where id=run_id;
  return jsonb_build_object('status',case when quarantined>0 then 'partial' else 'ok' end,'received',received,'changed',changed,'quarantined',quarantined);
 exception when others then
  update public.sen_runs set status='error',finished_at=clock_timestamp(),error_message=left(SQLERRM,500) where id=run_id;
  return jsonb_build_object('status','error','run_id',run_id,'message',SQLERRM);
 end;
end;
$$;
revoke all on function public.sync_sen() from public, anon, authenticated;
grant execute on function public.sync_sen() to postgres;
select public.sync_sen();
select cron.schedule('sen-live-minute','* * * * *',$job$ select public.sync_sen(); $job$);

-- Historical revisions and quarantined rows stay administrator-only.
alter table damas_private.revisions enable row level security;
alter table damas_private.sen_revisions enable row level security;
alter table damas_private.sen_quarantine enable row level security;
