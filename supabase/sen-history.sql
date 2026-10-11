create table if not exists damas_private.sen_history(delivery_date date primary key,attempted_at timestamptz,finished_at timestamptz);
alter table damas_private.sen_history enable row level security;
insert into damas_private.sen_history(delivery_date) select d::date from generate_series('2026-10-01'::timestamp,((now() at time zone 'Europe/Bucharest')::date-1)::timestamp,interval '1 day') d on conflict do nothing;
create or replace function public.sync_sen_day(p_day date)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, extensions
as $$
declare
 start_local timestamp := p_day::timestamp;
 end_local timestamp := (p_day+1)::timestamp;
 base text := 'https://www.transelectrica.ro/widget/web/tel/sen-grafic?p_p_id=SENGrafic_WAR_SENGraficportlet&p_p_lifecycle=2&p_p_state=maximized&p_p_mode=view&p_p_cacheability=cacheLevelPage&_SENGrafic_WAR_SENGraficportlet_random=random';
 url text; response record; run_id bigint; row_text text; cells text[]; local_at timestamp; utc_at timestamptz;
 received integer := 0; changed integer := 0; quarantined integer := 0; latest timestamptz;
 record_data jsonb; estimates text[]; i integer; stamp timestamp; side text; v numeric[];
 names text[] := array['consumption_mw','hourly_average_consumption_mw','production_mw','balance_mw','coal_mw','hydrocarbons_mw','hydro_mw','nuclear_mw','wind_mw','solar_mw','biomass_mw'];
begin
 if not pg_try_advisory_xact_lock(71386429) then return jsonb_build_object('status','skipped','reason','collection_in_progress'); end if;
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
revoke all on function public.sync_sen_day(date) from public,anon,authenticated;
create or replace function public.tick_sen_history() returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare q record;r jsonb;
begin
 select * into q from damas_private.sen_history where finished_at is null order by attempted_at nulls first,delivery_date limit 1;
 if not found then return jsonb_build_object('status','complete');end if;
 r:=public.sync_sen_day(q.delivery_date);
 update damas_private.sen_history set attempted_at=now(),finished_at=case when r->>'status' in ('ok','partial') then now() else null end where delivery_date=q.delivery_date;
 return r;
end $$;
revoke all on function public.tick_sen_history() from public,anon,authenticated;
select cron.schedule('sen-history-minute','* * * * *','select public.tick_sen_history();');
select public.tick_sen_history();
