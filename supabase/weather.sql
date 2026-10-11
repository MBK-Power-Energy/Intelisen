create table if not exists public.weather_cities(id integer primary key,name text not null,population bigint not null,latitude numeric not null,longitude numeric not null);
alter table public.weather_cities enable row level security;
create policy weather_cities_read on public.weather_cities for select to anon,authenticated using(true);
grant select on public.weather_cities to anon,authenticated;
insert into public.weather_cities values(0,'Alba Iulia',64227,46.0733,23.5805) on conflict(id) do nothing;
insert into public.weather_cities values(1,'Alexandria',40390,43.97,25.3333) on conflict(id) do nothing;
insert into public.weather_cities values(2,'Arad',145078,46.1866,21.3123) on conflict(id) do nothing;
insert into public.weather_cities values(3,'Bacau',136087,46.567,26.9146) on conflict(id) do nothing;
insert into public.weather_cities values(4,'Baia Mare',108759,47.6573,23.5681) on conflict(id) do nothing;
insert into public.weather_cities values(5,'Bistrita',78877,47.1333,24.5) on conflict(id) do nothing;
insert into public.weather_cities values(6,'Botosani',90010,47.7486,26.6694) on conflict(id) do nothing;
insert into public.weather_cities values(7,'Braila',154686,45.2692,27.9575) on conflict(id) do nothing;
insert into public.weather_cities values(8,'Brasov',237589,45.658,25.6012) on conflict(id) do nothing;
insert into public.weather_cities values(9,'Bucuresti',1716961,44.4268,26.1025) on conflict(id) do nothing;
insert into public.weather_cities values(10,'Buzau',103481,45.15,26.8333) on conflict(id) do nothing;
insert into public.weather_cities values(11,'Calarasi',58211,44.206,27.3306) on conflict(id) do nothing;
insert into public.weather_cities values(12,'Cluj-Napoca',286598,46.7712,23.6236) on conflict(id) do nothing;
insert into public.weather_cities values(13,'Constanta',263688,44.1598,28.6348) on conflict(id) do nothing;
insert into public.weather_cities values(14,'Craiova',234140,44.3302,23.7949) on conflict(id) do nothing;
insert into public.weather_cities values(15,'Deva',53113,45.8833,22.9) on conflict(id) do nothing;
insert into public.weather_cities values(16,'Drobeta-Turnu Severin',79865,44.6369,22.6597) on conflict(id) do nothing;
insert into public.weather_cities values(17,'Focsani',66648,45.6961,27.1864) on conflict(id) do nothing;
insert into public.weather_cities values(18,'Galati',217851,45.4353,28.008) on conflict(id) do nothing;
insert into public.weather_cities values(19,'Giurgiu',54551,43.9037,25.9699) on conflict(id) do nothing;
insert into public.weather_cities values(20,'Iasi',271692,47.1585,27.6014) on conflict(id) do nothing;
insert into public.weather_cities values(21,'Miercurea Ciuc',34484,46.36,25.8025) on conflict(id) do nothing;
insert into public.weather_cities values(22,'Oradea',183105,47.0465,21.9189) on conflict(id) do nothing;
insert into public.weather_cities values(23,'Piatra Neamt',79679,46.9275,26.3708) on conflict(id) do nothing;
insert into public.weather_cities values(24,'Pitesti',141275,44.8565,24.8692) on conflict(id) do nothing;
insert into public.weather_cities values(25,'Ploiesti',180540,44.9469,26.0367) on conflict(id) do nothing;
insert into public.weather_cities values(26,'Ramnicu Valcea',93151,45.1047,24.3754) on conflict(id) do nothing;
insert into public.weather_cities values(27,'Resita',58393,45.3008,21.8892) on conflict(id) do nothing;
insert into public.weather_cities values(28,'Satu Mare',91520,47.79,22.885) on conflict(id) do nothing;
insert into public.weather_cities values(29,'Sfantu Gheorghe',50080,45.8667,25.7833) on conflict(id) do nothing;
insert into public.weather_cities values(30,'Sibiu',134309,45.7983,24.1256) on conflict(id) do nothing;
insert into public.weather_cities values(31,'Slatina',63487,44.43,24.3708) on conflict(id) do nothing;
insert into public.weather_cities values(32,'Slobozia',41550,44.5647,27.3661) on conflict(id) do nothing;
insert into public.weather_cities values(33,'Suceava',84322,47.6635,26.2732) on conflict(id) do nothing;
insert into public.weather_cities values(34,'Targoviste',66965,44.925,25.4567) on conflict(id) do nothing;
insert into public.weather_cities values(35,'Targu Jiu',73545,45.0372,23.2746) on conflict(id) do nothing;
insert into public.weather_cities values(36,'Targu Mures',116033,46.5425,24.5579) on conflict(id) do nothing;
insert into public.weather_cities values(37,'Timisoara',250849,45.7489,21.2087) on conflict(id) do nothing;
insert into public.weather_cities values(38,'Tulcea',65624,45.1717,28.7914) on conflict(id) do nothing;
insert into public.weather_cities values(39,'Vaslui',63035,46.6407,27.7276) on conflict(id) do nothing;
insert into public.weather_cities values(40,'Zalau',52359,47.1911,23.0572) on conflict(id) do nothing;
insert into public.weather_cities values(41,'Bârlad',52475,46.23175,27.66907) on conflict(id) do nothing;
insert into public.weather_cities values(42,'Hunedoara',50457,45.75,22.9) on conflict(id) do nothing;
insert into public.weather_cities values(43,'Roman',48644,46.92119,26.92646) on conflict(id) do nothing;
insert into public.weather_cities values(44,'Turda',43319,46.56667,23.78333) on conflict(id) do nothing;
insert into public.weather_cities values(45,'Mediaș',39505,46.16667,24.35) on conflict(id) do nothing;
insert into public.weather_cities values(46,'Lugoj',35450,45.68861,21.90306) on conflict(id) do nothing;
insert into public.weather_cities values(47,'Medgidia',34612,44.25,28.28333) on conflict(id) do nothing;
insert into public.weather_cities values(48,'Onești',34005,46.25,26.75) on conflict(id) do nothing;
insert into public.weather_cities values(49,'Tecuci',32801,45.84973,27.43441) on conflict(id) do nothing;
insert into public.weather_cities values(50,'Sighetu Marmației',32793,47.93195,23.88603) on conflict(id) do nothing;
insert into public.weather_cities values(51,'Mangalia',31950,43.81623,28.57656) on conflict(id) do nothing;
insert into public.weather_cities values(52,'Dej',31475,47.15,23.86667) on conflict(id) do nothing;
insert into public.weather_cities values(53,'Odorheiu Secuiesc',31335,46.3,25.3) on conflict(id) do nothing;
insert into public.weather_cities values(54,'Petroșani',31044,45.41667,23.36667) on conflict(id) do nothing;
insert into public.weather_cities values(55,'Săcele',30920,45.61674,25.71101) on conflict(id) do nothing;
insert into public.weather_cities values(56,'Pașcani',30766,47.2469,26.72291) on conflict(id) do nothing;
insert into public.weather_cities values(57,'Râmnicu Sărat',29774,45.38333,27.05) on conflict(id) do nothing;
insert into public.weather_cities values(58,'Reghin',29742,46.7742,24.70216) on conflict(id) do nothing;
insert into public.weather_cities values(59,'Câmpina',28993,45.12619,25.73496) on conflict(id) do nothing;
insert into public.weather_cities values(60,'Câmpulung',27574,45.26667,25.05) on conflict(id) do nothing;
create table if not exists public.weather_city_hours(model text not null,city_id integer not null references public.weather_cities(id),observed_at timestamptz not null,temperature_c numeric not null,collected_at timestamptz not null default now(),primary key(model,city_id,observed_at));
alter table public.weather_city_hours enable row level security;
create policy weather_hours_read on public.weather_city_hours for select to anon,authenticated using(true);
grant select on public.weather_city_hours to anon,authenticated;
create table if not exists public.weather_runs(id bigint generated always as identity primary key,model text not null,batch integer not null,status text not null,received_rows integer,finished_at timestamptz not null default now(),error_message text);
alter table public.weather_runs enable row level security;
create policy weather_runs_read on public.weather_runs for select to anon,authenticated using(true);
grant select on public.weather_runs to anon,authenticated;
create or replace function public.sync_weather_batch(p_model text,p_batch integer) returns text language plpgsql security definer set search_path=pg_catalog,public,extensions as $$
declare lats text;lons text;ids integer[];r record;body jsonb;h jsonb; i integer;j integer;stamp timestamptz;temp numeric;n integer:=0;start_day date;
begin
 if p_model not in ('era5','ecmwf_ifs') or p_batch not between 0 and 12 then raise exception 'Invalid model/batch';end if;
 if not pg_try_advisory_xact_lock(71386428) then return 'skipped';end if;
 select string_agg(latitude::text,',' order by id),string_agg(longitude::text,',' order by id),array_agg(id order by id) into lats,lons,ids from public.weather_cities where id between p_batch*5 and p_batch*5+4;
 start_day:=greatest('2026-10-01'::date,(now() at time zone 'UTC')::date-10);
 begin
 perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','30000');
 select * into r from extensions.http_get('https://archive-api.open-meteo.com/v1/archive?latitude='||lats||'&longitude='||lons||'&start_date='||start_day||'&end_date='||(now() at time zone 'UTC')::date||'&hourly=temperature_2m&models='||p_model||'&timezone=UTC&timeformat=unixtime');
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
revoke all on function public.sync_weather_batch(text,integer) from public,anon,authenticated;
-- Completeness is checked per model/hour; weights never change for missing cities.
create or replace view public.weather_weighted_hours with(security_invoker=true) as
with means as (
 select h.model,h.observed_at,sum(h.temperature_c*c.population)/sum(c.population) as mean_c,max(h.collected_at) as collected_at
 from public.weather_city_hours h join public.weather_cities c on c.id=h.city_id group by h.model,h.observed_at having count(distinct h.city_id)=61 and sum(c.population)=7094441
),picked as(select distinct on(observed_at) * from means order by observed_at,case model when 'era5' then 0 else 1 end)
select model,observed_at,mean_c,
 case when mean_c-floor(mean_c)=0.5 then case when mod(floor(mean_c)::numeric,2)=0 then floor(mean_c) else ceil(mean_c) end else round(mean_c) end as temperature_c,collected_at from picked;
grant select on public.weather_weighted_hours to anon,authenticated;
select cron.schedule('weather-cities-minute','* * * * *',$job$select public.sync_weather_batch(case when mod(floor(extract(epoch from now())/60)::bigint,26)<13 then 'era5' else 'ecmwf_ifs' end,mod(floor(extract(epoch from now())/60)::bigint,13)::integer);$job$);
select public.sync_weather_batch('era5',0);
