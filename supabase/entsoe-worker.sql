-- Edge worker handles both XML and ZIP, while credentials remain in Vault.
alter table public.entsoe_documents add column if not exists documents_xml jsonb;
create table if not exists damas_private.entsoe_worker_jobs(id bigint generated always as identity primary key,dataset text not null,delivery_date date not null,claimed_at timestamptz not null default now(),finished_at timestamptz);
alter table damas_private.entsoe_worker_jobs enable row level security;
select vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'entsoe_worker_secret') where not exists(select 1 from vault.secrets where name='entsoe_worker_secret');
alter table damas_private.entsoe_queue add column if not exists priority integer not null default 0;
create or replace function public.entsoe_worker_claim(p_secret text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare expected text;token text;p record;q record;d date;a timestamptz;b timestamptz;j bigint;out jsonb:='[]';
begin
 select decrypted_secret into expected from vault.decrypted_secrets where name='entsoe_worker_secret';
 if expected is null or p_secret is distinct from expected then raise exception 'Unauthorized worker';end if;
 select decrypted_secret into token from vault.decrypted_secrets where name='entsoe_token';
 if token is null then raise exception 'Missing source credential';end if;
 if exists(select 1 from damas_private.entsoe_worker_jobs where finished_at is null and claimed_at>now()-interval '2 minutes') then return '[]'::jsonb;end if;
 select * into p from damas_private.entsoe_profiles where id=mod(floor(extract(epoch from now())/60)::bigint,54);
 d:=(now() at time zone 'Europe/Bucharest')::date;
 for q in select p.name as dataset,d as delivery_date union all select p.name,d+1 where p.name in ('load_day_ahead','generation_day_ahead','wind_solar_forecast_day_ahead','wind_solar_forecast_intraday','wind_solar_forecast_current') or p.name like 'commercial_exchanges_%' union all (select dataset,delivery_date from damas_private.entsoe_queue where finished_at is null order by priority desc,attempted_at nulls first,delivery_date,dataset limit 3) loop
 select * into p from damas_private.entsoe_profiles where name=q.dataset;
 a:=q.delivery_date::timestamp at time zone 'Europe/Bucharest';b:=(q.delivery_date+1)::timestamp at time zone 'Europe/Bucharest';
 if p.schedule='annual' then a:=make_date(extract(year from q.delivery_date)::integer,1,1)::timestamp at time zone 'Europe/Bucharest';b:=make_date(extract(year from q.delivery_date)::integer+1,1,1)::timestamp at time zone 'Europe/Bucharest';end if;
 insert into damas_private.entsoe_worker_jobs(dataset,delivery_date) values(q.dataset,q.delivery_date) returning id into j;
 update damas_private.entsoe_queue set attempted_at=now() where dataset=q.dataset and delivery_date=q.delivery_date;
 out:=out||jsonb_build_array(jsonb_build_object('id',j,'dataset',q.dataset,'delivery_date',q.delivery_date,'parameters',p.parameters||jsonb_build_object('periodStart',to_char(a at time zone 'UTC','YYYYMMDDHH24MI'),'periodEnd',to_char(b at time zone 'UTC','YYYYMMDDHH24MI'),'securityToken',token)));
 end loop;return out;
end $$;
create or replace function public.entsoe_worker_finish(p_job bigint,p_documents jsonb,p_status text) returns text language plpgsql security definer set search_path=pg_catalog,public as $$
declare q record;s text;x xml;cnt integer:=0;wrapped text:='<Documents>';
begin
 select * into strict q from damas_private.entsoe_worker_jobs where id=p_job and finished_at is null;
 if p_status='ok' then
 if jsonb_typeof(p_documents) is distinct from 'array' or jsonb_array_length(p_documents)=0 then raise exception 'Missing documents';end if;
 for s in select jsonb_array_elements_text(p_documents) loop
 x:=xmlparse(document s);cnt:=cnt+coalesce(array_length(xpath('//*[local-name()="TimeSeries"]',x),1),0);wrapped:=wrapped||regexp_replace(s,'<\?xml[^>]*\?>','','g');end loop;
 if cnt=0 then raise exception 'No TimeSeries';end if;wrapped:=wrapped||'</Documents>';
 insert into public.entsoe_documents(dataset,delivery_date,document_xml,documents_xml) values(q.dataset,q.delivery_date,wrapped,p_documents) on conflict(dataset,delivery_date) do update set document_xml=excluded.document_xml,documents_xml=excluded.documents_xml,collected_at=now();
 elsif p_status not in ('not_published','error') then raise exception 'Invalid completion status';end if;
 insert into public.entsoe_runs(dataset,delivery_date,status,series_count,error_message) values(q.dataset,q.delivery_date,p_status,cnt,case when p_status='error' then 'Source fetch or validation failed; previous document retained' end);
 update damas_private.entsoe_worker_jobs set finished_at=now() where id=p_job;
 update damas_private.entsoe_queue set finished_at=case when p_status in ('ok','not_published') then now() else null end where dataset=q.dataset and delivery_date=q.delivery_date;
 return p_status;
end $$;
revoke all on function public.entsoe_worker_claim(text),public.entsoe_worker_finish(bigint,jsonb,text) from public,anon,authenticated;
grant execute on function public.entsoe_worker_claim(text),public.entsoe_worker_finish(bigint,jsonb,text) to service_role;
select 'Worker database ready' as result;

update damas_private.entsoe_queue set priority=200 where finished_at is null and dataset in ('load_actual','generation_actual','load_day_ahead','wind_solar_forecast_day_ahead','wind_solar_forecast_intraday');
