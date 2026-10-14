-- OPCOM collection runs online in SEN. Tables retain source headers and cells.
create table if not exists public.opcom_tables(source text not null,delivery_date date not null,dataset text not null,rows jsonb not null,collected_at timestamptz not null default now(),primary key(source,delivery_date,dataset));
alter table public.opcom_tables enable row level security;
create policy opcom_public_read on public.opcom_tables for select to anon,authenticated using(true);
grant select on public.opcom_tables to anon,authenticated;
create table if not exists public.opcom_runs(id bigint generated always as identity primary key,source text not null,delivery_date date not null,status text not null,finished_at timestamptz not null default now(),rows_received integer,error_message text);
alter table public.opcom_runs enable row level security;
create policy opcom_runs_public_read on public.opcom_runs for select to anon,authenticated using(true);
grant select on public.opcom_runs to anon,authenticated;
create table if not exists damas_private.opcom_backfill(source text not null,delivery_date date not null,attempted_at timestamptz,finished_at timestamptz,primary key(source,delivery_date));
alter table damas_private.opcom_backfill enable row level security;
insert into damas_private.opcom_backfill(source,delivery_date) select s,d::date from unnest(array['opcom_pzu','opcom_ida']) s cross join generate_series('2025-01-01'::timestamp,(now() at time zone 'Europe/Bucharest')::date::timestamp,interval '1 day') d on conflict do nothing;
create or replace function public.sync_opcom(p_source text,p_day date) returns text language plpgsql security definer set search_path=pg_catalog,public,extensions as $$
declare cookies text;url text;token text;r record;body text;form text;date_field text;ids text[];label text;block text;rowmatch text[];cellmatch text[];rowdata jsonb;tabledata jsonb;numrows integer;totalrows integer:=0;expected integer;
begin
 if p_source='opcom_pzu' then url:='https://www.opcom.ro/grafice-ip-raportPIP-si-volumTranzactionat/ro';date_field:='trading_for';ids:=case when p_day<'2025-10-01' then array['rez60min'] else array['rez15min','rez30min','rez60min'] end;
 elsif p_source='opcom_ida' then url:='https://www.opcom.ro/rapoarte-ida-rezultate-cuplare/ro';date_field:='data_calendar_ro';ids:=array['IDA1','IDA2','IDA3'];else raise exception 'Unknown source';end if;
 if not pg_try_advisory_xact_lock(hashtext(p_source)) then return 'skipped';end if;
 begin
 perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','25000');
 select * into r from extensions.http_get(url);
 if r.status<>200 then raise exception 'Initial GET failed';end if;
 select string_agg(split_part(h.value,';',1),'; ') into cookies from unnest(r.headers) h where lower(h.field)='set-cookie';
 token:=substring(r.content from 'name="_token"[^>]*value="([^"]+)"');
 if token is null then raise exception 'Missing CSRF token';end if;
 form:='_token='||extensions.urlencode(token)||'&'||date_field||'='||extensions.urlencode(to_char(p_day,'DD/MM/YYYY'))||'&buton=Refresh';
 if p_source='opcom_pzu' then form:=form||'&action=trading_for&limba=ro';else form:=form||'&lang=ro';end if;
 select * into r from extensions.http(('POST',url,array[extensions.http_header('Accept','text/html'),extensions.http_header('Cookie',coalesce(cookies,''))],'application/x-www-form-urlencoded',form)::extensions.http_request);
 if r.status<>200 then raise exception 'POST failed';end if;
 body:=r.content;
 if body !~ ('name="'||date_field||'"[^>]*value="'||to_char(p_day,'DD/MM/YYYY')||'"') then raise exception 'Requested date not confirmed';end if;
 foreach label in array ids loop
 block:=substring(body from ('(?is)id="'||label||'"(.*?)</table>'));
 if block is null and p_source='opcom_pzu' and p_day<'2025-10-01' then
 block:=substring(body from '(?is)(<table[^>]*class="border_table"[^>]*>.*?)</table>');
 end if;
 if block is null then raise exception 'Missing market table';end if;
 tabledata:='[]'::jsonb;numrows:=0;
 for rowmatch in select regexp_matches(block,'(?is)<tr[^>]*?>(.*?)</tr>','g') loop
 rowdata:='[]'::jsonb;
 for cellmatch in select regexp_matches(rowmatch[1],'(?is)<t[dh][^>]*?>(.*?)</t[dh]>','g') loop
 rowdata:=rowdata||jsonb_build_array(btrim(regexp_replace(replace(replace(regexp_replace(cellmatch[1],'<[^>]+>',' ','g'),'&nbsp;',' '),'&amp;','&'),'\s+',' ','g')));
 end loop;
 if jsonb_array_length(rowdata)>0 then tabledata:=tabledata||jsonb_build_array(rowdata);end if;
 if (rowdata->>0)~'^\d+$' or (rowdata->>1)~'^\d+$' then numrows:=numrows+1;end if;
 end loop;
 expected:=extract(epoch from (((p_day+1)::timestamp at time zone 'Europe/Bucharest') - (p_day::timestamp at time zone 'Europe/Bucharest')))::integer/900;
 if p_source='opcom_pzu' then expected:=expected*15/substr(label,4,length(label)-6)::integer;
 elsif label='IDA3' then expected:=48;end if;
 if numrows=0 and p_day<=(now() at time zone 'Europe/Bucharest')::date-2 then continue;end if;
 if numrows=0 and p_day<=(now() at time zone 'Europe/Bucharest')::date then raise exception 'No numeric rows: dataset %, rows %, sample %',label,jsonb_array_length(tabledata),left(tabledata::text,180);end if;
 if numrows<>expected and numrows<>0 then raise exception 'Partial or unexpected market intervals';end if;
 if numrows>0 then insert into public.opcom_tables values(p_source,p_day,label,tabledata,now()) on conflict(source,delivery_date,dataset) do update set rows=excluded.rows,collected_at=excluded.collected_at;end if;
 totalrows:=totalrows+numrows;
 end loop;
 insert into public.opcom_runs(source,delivery_date,status,rows_received) values(p_source,p_day,case when totalrows=0 then 'not_published' else 'ok' end,totalrows);
 return case when totalrows=0 then 'not_published' else 'ok' end;
 exception when others then insert into public.opcom_runs(source,delivery_date,status,error_message) values(p_source,p_day,'error',left(SQLERRM,200));return 'error';end;
end $$;
revoke all on function public.sync_opcom(text,date) from public,anon,authenticated;
create or replace function public.tick_opcom() returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare q record;result text;day date:=(now() at time zone 'Europe/Bucharest')::date;
begin
 if not pg_try_advisory_xact_lock(71386427) then return;end if;
 if extract(minute from now())::integer%15=1 then
 perform public.sync_opcom('opcom_pzu',day-1);perform public.sync_opcom('opcom_ida',day-1);
 end if;
 if extract(minute from now())::integer%5=0 then
 perform public.sync_opcom('opcom_pzu',day);perform public.sync_opcom('opcom_ida',day);
 perform public.sync_opcom('opcom_pzu',day+1);perform public.sync_opcom('opcom_ida',day+1);
 end if;
 select * into q from damas_private.opcom_backfill where finished_at is null and mod(extract(minute from now())::integer,10)=2 /* history_io_throttle */ and (attempted_at is null or attempted_at<now()-interval '1 hour') and (select pg_database_size(current_database()))<7::bigint*1024*1024*1024 order by attempted_at nulls first,delivery_date,source limit 1;
 if found then result:=public.sync_opcom(q.source,q.delivery_date);update damas_private.opcom_backfill set attempted_at=now(),finished_at=case when result in ('ok','not_published') then now() else null end where source=q.source and delivery_date=q.delivery_date;end if;
end $$;
revoke all on function public.tick_opcom() from public,anon,authenticated;
select cron.schedule('opcom-scraping-minute','* * * * *','select public.tick_opcom();');
select public.sync_opcom('opcom_pzu','2026-10-11');
select public.sync_opcom('opcom_ida','2026-10-11');
