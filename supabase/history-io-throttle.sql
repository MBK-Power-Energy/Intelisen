do $throttle$ declare spec record;definition text;needle text:='where finished_at is null and (select pg_database_size(current_database()))<';begin
 for spec in select * from (values ('public.tick_opcom()',2),('public.tick_damas_reports()',3),('public.entsoe_worker_claim(text)',4)) s(signature,minute_slot) loop
 definition:=pg_get_functiondef(spec.signature::regprocedure);
 if position('history_io_throttle' in definition)>0 then continue;end if;
 if position(needle in definition)=0 then raise exception 'Unexpected history selector in %',spec.signature;end if;
 definition:=replace(definition,needle,'where finished_at is null and mod(extract(minute from now())::integer,10)='||spec.minute_slot||' /* history_io_throttle */ and (attempted_at is null or attempted_at<now()-interval ''1 hour'') and (select pg_database_size(current_database()))<');
 execute definition;
 end loop;
end $throttle$;
select cron.schedule('sen-history-minute','8,28,48 * * * *','select public.tick_sen_history();');
select cron.schedule('weather-history-2025','7,27,47 * * * *','select public.tick_weather_history();');
select jobname,schedule,active from cron.job where jobname in ('sen-history-minute','weather-history-2025');
