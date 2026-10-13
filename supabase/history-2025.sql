-- Historical collection from 2025-01-01; Nord Pool intentionally excluded.
create table if not exists damas_private.weather_history(model text not null,batch integer not null,month_start date not null,attempted_at timestamptz,finished_at timestamptz,primary key(model,batch,month_start));
alter table damas_private.weather_history enable row level security;
create or replace function public.sync_weather_history(p_model text,p_batch integer,p_month date) returns text language plpgsql security definer set search_path=pg_catalog,public,extensions as $$
declare lats text;lons text;ids integer[];r record;body jsonb;h jsonb; i integer;j integer;stamp timestamptz;temp numeric;n integer:=0;start_day date;
begin
 if p_model not in ('era5','ecmwf_ifs') or p_batch not between 0 and 12 then raise exception 'Invalid model/batch';end if;
 if not pg_try_advisory_xact_lock(71386428) then return 'skipped';end if;
 select string_agg(latitude::text,',' order by id),string_agg(longitude::text,',' order by id),array_agg(id order by id) into lats,lons,ids from public.weather_cities where id between p_batch*5 and p_batch*5+4;
 if p_month<'2025-01-01' or p_month<>date_trunc('month',p_month)::date then raise exception 'Invalid history month';end if;
 start_day:=p_month;
 begin
 perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','30000');
 select * into r from extensions.http_get('https://archive-api.open-meteo.com/v1/archive?latitude='||lats||'&longitude='||lons||'&start_date='||start_day||'&end_date='||least((p_month+interval '1 month'-interval '1 day')::date,(now() at time zone 'Europe/Bucharest')::date-1)||'&hourly=temperature_2m&models='||p_model||'&timezone=Europe%2FBucharest&timeformat=unixtime');
 if r.status<>200 then raise exception 'Weather HTTP %',r.status;end if;
 body:=r.content::jsonb;if jsonb_typeof(body)='object' then body:=jsonb_build_array(body);end if;
 if jsonb_array_length(body)<>array_length(ids,1) then raise exception 'City count mismatch';end if;
 for i in 0..jsonb_array_length(body)-1 loop
 h:=body->i->'hourly';
 if jsonb_typeof(h->'time') is distinct from 'array' or jsonb_typeof(h->'temperature_2m') is distinct from 'array' or jsonb_array_length(h->'time')<>jsonb_array_length(h->'temperature_2m') then raise exception 'Invalid hourly schema';end if;
 for j in 0..jsonb_array_length(h->'time')-1 loop
 stamp:=to_timestamp((h->'time'->>j)::double precision);temp:=(h->'temperature_2m'->>j)::numeric;
 if temp is not null and stamp<date_trunc('hour',now()) then
 insert into public.weather_city_hours values(p_model,ids[i+1],stamp,temp,now()) on conflict(model,city_id,observed_at) do update set temperature_c=excluded.temperature_c,collected_at=excluded.collected_at;n:=n+1;
 end if;end loop;end loop;
 insert into public.weather_runs(model,batch,status,received_rows) values(p_model,p_batch,'ok',n);return 'ok';
 exception when others then insert into public.weather_runs(model,batch,status,error_message) values(p_model,p_batch,'error',left(SQLERRM,200));return 'error';end;
end $$;

revoke all on function public.sync_weather_history(text,integer,date) from public,anon,authenticated;
create or replace function public.tick_weather_history() returns text language plpgsql security definer set search_path=pg_catalog,public as $$
declare q record;result text;
begin
 if pg_database_size(current_database())>7::bigint*1024*1024*1024 then return 'disk_guard';end if;
 perform pg_sleep(15);
 select * into q from damas_private.weather_history where finished_at is null and (attempted_at is null or attempted_at<now()-interval '1 hour') order by attempted_at nulls first,month_start,model,batch limit 1;
 if not found then return 'complete';end if;
 result:=public.sync_weather_history(q.model,q.batch,q.month_start);
 update damas_private.weather_history set attempted_at=clock_timestamp(),finished_at=case when result='ok' then clock_timestamp() else null end where model=q.model and batch=q.batch and month_start=q.month_start;
 return result;
end $$;
revoke all on function public.tick_weather_history() from public,anon,authenticated;
insert into damas_private.weather_history(model,batch,month_start) select model,batch,m::date from unnest(array['era5','ecmwf_ifs']) model cross join generate_series(0,12) batch cross join generate_series('2025-01-01'::timestamp,date_trunc('month',(now() at time zone 'Europe/Bucharest')::date)-interval '1 month',interval '1 month') m on conflict do nothing;
select cron.schedule('weather-history-2025','*/5 * * * *','select public.tick_weather_history();');
insert into damas_private.sen_history(delivery_date) select d::date from generate_series('2025-01-01'::timestamp,((now() at time zone 'Europe/Bucharest')::date-1)::timestamp,interval '1 day') d on conflict do nothing;
insert into damas_private.opcom_backfill(source,delivery_date) select s,d::date from unnest(array['opcom_pzu','opcom_ida']) s cross join generate_series('2025-01-01'::timestamp,((now() at time zone 'Europe/Bucharest')::date-1)::timestamp,interval '1 day') d on conflict do nothing;
insert into damas_private.report_backfill(report,delivery_date) select r,d::date from unnest(array['marginalPricesOverview','finalUnintentionalDeviations','estimatedImbalancePrices','estimatedPowerSystemImbalance','dailyConsumptionOverview','activatedBalancingEnergyOverview','scheduledExchanges']) r cross join generate_series('2025-01-01'::timestamp,((now() at time zone 'Europe/Bucharest')::date-1)::timestamp,interval '1 day') d on conflict do nothing;
insert into damas_private.entsoe_queue(dataset,delivery_date,priority) select p.name,d::date,0 from damas_private.entsoe_profiles p cross join generate_series('2025-01-01'::timestamp,((now() at time zone 'Europe/Bucharest')::date-1)::timestamp,interval '1 day') d where p.schedule<>'annual' or extract(doy from d)=1 on conflict(dataset,delivery_date) do nothing;

-- Limit only historical work; live collection remains available.
do $guard$ declare signature text;definition text;begin
 foreach signature in array array['public.tick_opcom()','public.tick_damas_reports()','public.tick_sen_history()','public.entsoe_worker_claim(text)'] loop
 definition:=pg_get_functiondef(signature::regprocedure);
 if position('pg_database_size(current_database())' in definition)=0 then
 if position('where finished_at is null order by' in definition)=0 then raise exception 'History queue selector differs: %',signature;end if;
 definition:=replace(definition,'where finished_at is null order by','where finished_at is null and (select pg_database_size(current_database()))<7::bigint*1024*1024*1024 order by');
 execute definition;
 end if;end loop;end $guard$;
