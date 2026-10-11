-- Official EUR/RON reference rate, aligned to the delivery date as in ema.
create table if not exists public.bnr_rates(rate_date date primary key,eur_ron numeric not null check(eur_ron>0),collected_at timestamptz not null default now());
alter table public.bnr_rates enable row level security;
create policy bnr_read on public.bnr_rates for select to anon,authenticated using(true);
grant select on public.bnr_rates to anon,authenticated;
create or replace function public.sync_bnr(p_year integer) returns integer language plpgsql security definer set search_path=pg_catalog,public,extensions as $$
declare r record;x xml;c xml;d date;v numeric;n integer:=0;
begin
 perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','30000');
 select * into r from extensions.http_get('https://curs.bnr.ro/files/xml/years/nbrfxrates'||p_year||'.xml');
 if r.status<>200 then raise exception 'BNR HTTP %',r.status;end if;x:=xmlparse(document r.content);
 foreach c in array xpath('//*[local-name()="Cube"][@date]',x) loop
 d:=(xpath('string(/*/@date)',c))[1]::text::date;
 v:=nullif((xpath('string(/*/*[local-name()="Rate"][@currency="EUR"])',c))[1]::text,'')::numeric;
 if v is not null then insert into public.bnr_rates values(d,v,now()) on conflict(rate_date) do update set eur_ron=excluded.eur_ron,collected_at=excluded.collected_at;n:=n+1;end if;
 end loop;
 if n=0 then raise exception 'No EUR rates';end if;return n;
end $$;
revoke all on function public.sync_bnr(integer) from public,anon,authenticated;
select cron.schedule('bnr-daily','10 12 * * *','select public.sync_bnr(extract(year from now())::integer);');
select public.sync_bnr(2026);
