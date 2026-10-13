-- Nord Pool public Data Portal endpoint, used by the linked DA/IDA volume pages.
-- These volumes cover Nord Pool trades only, not the whole market.
-- Nord Pool TEL auction volumes. Interval Buy/Sell values are MW; daily totals remain MWh in raw payload.
create table if not exists public.nordpool_auction_volumes(
 market text not null,delivery_date date not null,area text not null default 'TEL',
 interval_start timestamptz not null,interval_end timestamptz not null,
 buy_mw numeric not null check(buy_mw>=0),sell_mw numeric not null check(sell_mw>=0),
 source_updated_at timestamptz,status text not null,unit text not null default 'MW' check(unit='MW'),
 collected_at timestamptz not null default clock_timestamp(),primary key(market,area,interval_start),check(interval_end>interval_start));
alter table public.nordpool_auction_volumes enable row level security;
do $$ begin if not exists(select 1 from pg_policies where schemaname='public' and tablename='nordpool_auction_volumes' and policyname='np_auction_volumes_read') then create policy np_auction_volumes_read on public.nordpool_auction_volumes for select to authenticated using(public.nordpool_authorized());end if;end $$;
revoke all on public.nordpool_auction_volumes from anon;
grant select on public.nordpool_auction_volumes to authenticated;
create table if not exists nordpool_private.auction_volume_documents(market text not null,delivery_date date not null,payload jsonb not null,collected_at timestamptz not null default clock_timestamp(),primary key(market,delivery_date));
create table if not exists nordpool_private.auction_volume_runs(id bigint generated always as identity primary key,market text not null,delivery_date date not null,status text not null,rows_received integer,finished_at timestamptz not null default clock_timestamp(),error_message text);
create table if not exists nordpool_private.auction_volume_queue(delivery_date date primary key,finished_at timestamptz,attempted_at timestamptz);
alter table nordpool_private.auction_volume_documents enable row level security;
alter table nordpool_private.auction_volume_runs enable row level security;
alter table nordpool_private.auction_volume_queue enable row level security;
create or replace function public.sync_nordpool_auction_volumes(p_day date) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,extensions as $$
declare r record;body jsonb;g jsonb;v jsonb;m text;state text;n integer;result jsonb:='[]';expected integer;
begin
 if p_day<'2026-10-01' then raise exception 'History starts 2026-10-01';end if;
 if not pg_try_advisory_xact_lock(71386425) then return jsonb_build_object('status','skipped');end if;
 perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','25000');
 foreach m in array array['DayAhead','SIDC_IntradayAuction1','SIDC_IntradayAuction2','SIDC_IntradayAuction3'] loop
 begin
 perform pg_sleep(1.05);
 select * into r from extensions.http_get('https://dataportal-api.nordpoolgroup.com/api/DayAheadVolumes/multiple?date='||p_day||'&market='||m||'&deliveryAreas=TEL');
 n:=0;state:='Missing';
 if r.status=200 then
 body:=r.content::jsonb;
 if jsonb_typeof(body) is distinct from 'object' then raise exception 'Unexpected portal response';end if;
 if (body->>'deliveryDateCET')::date is distinct from p_day or body->>'market' is distinct from m then raise exception 'Unexpected auction date/market';end if;
 select x->>'state' into state from jsonb_array_elements(body->'areaStates') x where x->'areas' ? 'TEL';
 g:=jsonb_build_object('deliveryDateCET',body->>'deliveryDateCET','market',m,'unit',body->>'unit','updatedAt',body->>'updatedAt','volumes',(select coalesce(jsonb_agg(jsonb_build_object('deliveryStart',entry->>'deliveryStart','deliveryEnd',entry->>'deliveryEnd','buy',entry->'entryPerArea'->'TEL'->'buy','sell',entry->'entryPerArea'->'TEL'->'sell')),'[]'::jsonb) from jsonb_array_elements(body->'multiAreaEntries') as items(entry)));
 elsif r.status<>204 then raise exception 'Nord Pool portal HTTP %',r.status;end if;
 if state in ('Final','Preliminary') then
 if g->>'unit' is distinct from 'MW' or jsonb_typeof(g->'volumes') is distinct from 'array' then raise exception 'Expected interval volumes in MW';end if;
 expected:=case when m='SIDC_IntradayAuction3' then 48 else extract(epoch from (((p_day+1)::timestamp at time zone 'Europe/Oslo')-(p_day::timestamp at time zone 'Europe/Oslo')))/900 end;
 if jsonb_array_length(g->'volumes')<>expected then raise exception 'Incomplete auction intervals';end if;
 for v in select value from jsonb_array_elements(g->'volumes') loop
 if (v->>'deliveryEnd')::timestamptz-(v->>'deliveryStart')::timestamptz<>interval '15 minutes' or ((v->>'deliveryStart')::timestamptz at time zone 'Europe/Oslo')::date<>p_day then raise exception 'Invalid delivery interval';end if;
 insert into public.nordpool_auction_volumes(market,delivery_date,area,interval_start,interval_end,buy_mw,sell_mw,source_updated_at,status)
 values(m,p_day,'TEL',(v->>'deliveryStart')::timestamptz,(v->>'deliveryEnd')::timestamptz,(v->>'buy')::numeric,(v->>'sell')::numeric,(g->>'updatedAt')::timestamptz,state)
 on conflict(market,area,interval_start) do update set interval_end=excluded.interval_end,buy_mw=excluded.buy_mw,sell_mw=excluded.sell_mw,source_updated_at=excluded.source_updated_at,status=excluded.status,collected_at=clock_timestamp();n:=n+1;
 end loop;
 insert into nordpool_private.auction_volume_documents values(m,p_day,body,clock_timestamp()) on conflict(market,delivery_date) do update set payload=excluded.payload,collected_at=excluded.collected_at;
 elsif state='Cancelled' then
 insert into nordpool_private.auction_volume_documents values(m,p_day,body,clock_timestamp()) on conflict(market,delivery_date) do update set payload=excluded.payload,collected_at=clock_timestamp();
 update public.nordpool_auction_volumes set status='Cancelled',collected_at=clock_timestamp() where market=m and delivery_date=p_day;
 elsif state is distinct from 'Missing' then raise exception 'Unknown auction status';end if;
 insert into nordpool_private.auction_volume_runs(market,delivery_date,status,rows_received) values(m,p_day,state,n);
 result:=result||jsonb_build_array(jsonb_build_object('market',m,'status',state,'rows',n));
 exception when others then
 insert into nordpool_private.auction_volume_runs(market,delivery_date,status,error_message) values(m,p_day,'error',left(SQLERRM,200));
 result:=result||jsonb_build_array(jsonb_build_object('market',m,'status','error','error',left(SQLERRM,200)));
 end;
 end loop;return result;
end $$;
revoke all on function public.sync_nordpool_auction_volumes(date) from public,anon,authenticated;
insert into nordpool_private.auction_volume_queue(delivery_date) select d::date from generate_series('2026-10-01'::timestamp,((now() at time zone 'Europe/Oslo')::date-1)::timestamp,interval '1 day') d on conflict do nothing;
create or replace function public.tick_nordpool_auction_volumes() returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare d date;q date;result jsonb;
begin
 if not pg_try_advisory_xact_lock(71386425) then return;end if;
 d:=(now() at time zone 'Europe/Oslo')::date;
 insert into nordpool_private.auction_volume_queue(delivery_date) values(d-1) on conflict do nothing;
 select delivery_date into q from nordpool_private.auction_volume_queue where finished_at is null order by attempted_at nulls first,delivery_date limit 1;
 if q is not null then
 result:=public.sync_nordpool_auction_volumes(q);
 update nordpool_private.auction_volume_queue set attempted_at=now(),finished_at=case when jsonb_array_length(result)=4 and not exists(select 1 from jsonb_array_elements(result) x where x->>'status' not in ('Final','Cancelled')) then now() else null end where delivery_date=q;
 end if;
 perform public.sync_nordpool_auction_volumes(d+mod(floor(extract(epoch from now())/900)::bigint,2)::integer);
end $$;
revoke all on function public.tick_nordpool_auction_volumes() from public,anon,authenticated;
select cron.schedule('nordpool-auction-volumes','7,22,37,52 * * * *',$job$select public.tick_nordpool_auction_volumes();$job$);
select cron.alter_job(jobid,active:=true) from cron.job where jobname='nordpool-auction-volumes';
