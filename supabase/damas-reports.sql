-- SEN project. Full DAMAS report coverage; raw fields and units retained.
create table if not exists public.damas_report_observations(
 report text not null, interval_start timestamptz not null, interval_end timestamptz not null,
 payload jsonb not null, collected_at timestamptz not null default now(),
 primary key(report,interval_start));
create table if not exists public.damas_report_runs(
 id bigint generated always as identity primary key, report text not null, delivery_date date not null,
 started_at timestamptz not null default now(), finished_at timestamptz, status text not null,
 received_rows integer, error_message text);
alter table public.damas_report_observations enable row level security;
alter table public.damas_report_runs enable row level security;
create policy "public DAMAS reports" on public.damas_report_observations for select to anon,authenticated using(true);
create policy "public DAMAS report runs" on public.damas_report_runs for select to anon,authenticated using(true);
grant select on public.damas_report_observations,public.damas_report_runs to anon,authenticated;
create table if not exists damas_private.report_revisions(
 report text not null,interval_start timestamptz not null,payload jsonb not null,
 collected_at timestamptz not null default now());
alter table damas_private.report_revisions enable row level security;
create table if not exists damas_private.report_backfill(
 report text not null,delivery_date date not null,attempted_at timestamptz,finished_at timestamptz,primary key(report,delivery_date));
alter table damas_private.report_backfill enable row level security;
insert into damas_private.report_backfill(report,delivery_date)
select r,d::date from unnest(array['marginalPricesOverview','finalUnintentionalDeviations','estimatedImbalancePrices','estimatedPowerSystemImbalance','dailyConsumptionOverview','activatedBalancingEnergyOverview','scheduledExchanges']) r
cross join generate_series('2025-01-01'::date,((now() at time zone 'Europe/Bucharest')::date-1)::timestamp,interval '1 day') d
on conflict do nothing;
create or replace function public.sync_damas_report(p_report text,p_day date)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,extensions as $$
declare a timestamptz:=p_day::timestamp at time zone 'Europe/Bucharest';
 b timestamptz:=(p_day+1)::timestamp at time zone 'Europe/Bucharest';
 response record; body jsonb; item jsonb; n integer; run_id bigint; x timestamptz; y timestamptz;
begin
 if p_report<>all(array['marginalPricesOverview','finalUnintentionalDeviations','estimatedImbalancePrices','estimatedPowerSystemImbalance','dailyConsumptionOverview','activatedBalancingEnergyOverview','scheduledExchanges']) then raise exception 'Unknown report';end if;
 if not pg_try_advisory_xact_lock(hashtext(p_report||p_day::text)) then return jsonb_build_object('status','skipped');end if;
 insert into public.damas_report_runs(report,delivery_date,status) values(p_report,p_day,'running') returning id into run_id;
 begin
 perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','15000');
 select * into response from extensions.http_get('https://newmarkets.transelectrica.ro/usy-durom-publicreportg01/00121002500000000000000000000100/publicReport/'||p_report||'?timeInterval.from='||to_char(a at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')||'&timeInterval.to='||to_char(b at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')||'&pageInfo.pageSize=3000');
 if response.status<>200 then raise exception 'HTTP %',response.status;end if;
 body:=response.content::jsonb;
 if jsonb_typeof(body->'itemList') is distinct from 'array' or coalesce(body->'uuAppErrorMap','{}'::jsonb)<>'{}'::jsonb then raise exception 'Invalid report response';end if;
 n:=jsonb_array_length(body->'itemList');
 if body#>>'{pageInfo,total}' is null or (body#>>'{pageInfo,total}')::integer<>n then raise exception 'Incomplete pagination';end if;
 if n<>(select count(distinct e#>>'{timeInterval,from}') from jsonb_array_elements(body->'itemList') e) then raise exception 'Duplicate intervals';end if;
 for item in select value from jsonb_array_elements(body->'itemList') loop
 x:=(item#>>'{timeInterval,from}')::timestamptz;y:=(item#>>'{timeInterval,to}')::timestamptz;
 if x is null or y is null or x<a or y>b or y<=x then raise exception 'Invalid report interval';end if;
 if not exists(select 1 from public.damas_report_observations o where o.report=p_report and o.interval_start=x and o.payload=item) then insert into damas_private.report_revisions values(p_report,x,item,now());end if;
 insert into public.damas_report_observations values(p_report,x,y,item,now()) on conflict(report,interval_start) do update set interval_end=excluded.interval_end,payload=excluded.payload,collected_at=excluded.collected_at;
 end loop;
 update public.damas_report_runs set status=case when n=0 then 'empty' else 'ok' end,received_rows=n,finished_at=clock_timestamp() where id=run_id;
 return jsonb_build_object('status',case when n=0 then 'empty' else 'ok' end,'received',n);
 exception when others then
 update public.damas_report_runs set status='error',error_message=left(SQLERRM,300),finished_at=clock_timestamp() where id=run_id;
 return jsonb_build_object('status','error');
 end;
end $$;
revoke all on function public.sync_damas_report(text,date) from public,anon,authenticated;
create or replace function public.tick_damas_reports() returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare reports text[]:=array['marginalPricesOverview','finalUnintentionalDeviations','estimatedImbalancePrices','estimatedPowerSystemImbalance','dailyConsumptionOverview','activatedBalancingEnergyOverview','scheduledExchanges']; slot integer; i integer; q record; result jsonb;
begin
 if not pg_try_advisory_xact_lock(71386425) then return;end if;
 slot:=mod(floor(extract(epoch from now())/60)::bigint,7)::integer;
 -- Two reports per minute: every report revisited within four minutes.
 for i in 0..1 loop perform public.sync_damas_report(reports[mod(slot*2+i,7)+1],(now() at time zone 'Europe/Bucharest')::date);end loop;
 select * into q from damas_private.report_backfill where finished_at is null and (select pg_database_size(current_database()))<7::bigint*1024*1024*1024 order by attempted_at nulls first,delivery_date,report limit 1;
 if found then result:=public.sync_damas_report(q.report,q.delivery_date);
 update damas_private.report_backfill set attempted_at=now(),finished_at=case when result->>'status' in ('ok','empty') then now() else null end where report=q.report and delivery_date=q.delivery_date;end if;
end $$;
revoke all on function public.tick_damas_reports() from public,anon,authenticated;
select cron.schedule('damas-all-reports-minute','* * * * *','select public.tick_damas_reports();');
select public.tick_damas_reports();
