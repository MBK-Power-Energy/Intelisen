import {cachedRows,privateRows,authorized} from './api.js';
import {SeriesStore,opcom,xmlSeries,numeric,signedImbalance} from './normalize.js';
import {dayRange,midnight,addDays,localParts} from './time.js';

export const MARKETS=['PZU pret','PZU volum tranzactionat','PZU volum buy','PZU volum sell','IDA1 pret','IDA2 pret','IDA3 pret','ID O','ID H','ID L','ID C','ID VWAP','Spread ID VWAP - PZU','ID volum buy','ID volum sell','PZU 15 min (RON/MWh)','PZU 30 min (RON/MWh)','PZU 60 min (RON/MWh)'];
export const FUNDAMENTALS=['Temperatura','Consum DA','Consum Actual','Eroare consum','Solar DA','Solar ID','Solar Actual','Eroare solar DA','Eroare solar ID','Eolian DA','Eolian ID','Eolian Actual','Eroare eolian DA','Eroare eolian ID','Sarcina reziduala DA','Sarcina reziduala ID','Sarcina reziduala Actual','Import DA','Export DA','Import Total','Export Total','Import Actual','Export Actual','Indisponibilitati','ENTSO-E · Dezechilibru (MWh)','ENTSO-E · Statut dezechilibru','DAMAS · Preț dezechilibru deficit (RON/MWh)','DAMAS · Preț dezechilibru excedent (RON/MWh)','ENTSO-E · Preț dezechilibru deficit (RON/MWh)','ENTSO-E · Preț dezechilibru excedent (RON/MWh)','DAMAS · Rezervă activată (brut)','DAMAS · Volum reglaj în sus (brut)','DAMAS · Volum reglaj în jos (brut)','DAMAS · Dezechilibru estimat (brut)'];
const coreDatasets=['load_actual','load_day_ahead','wind_solar_forecast_day_ahead','wind_solar_forecast_intraday','generation_actual','imbalance_volumes','imbalance_prices','outages_production_A05','outages_production_A09','outages_production_A13'];
const labelled={load_actual:'Consum Actual',load_day_ahead:'Consum DA'};
function entsoe(documents,store,low,high){
  const wind=new Map(),outages=new Map();
  for(const document of documents)for(const series of xmlSeries(document.document_xml)){
    const m=series.metadata;let label=labelled[document.dataset];
    if(document.dataset.startsWith('outages_production_')){if(!m.status)m.status=document.dataset.split('_').at(-1);const old=outages.get(m.documentId+'|'+m.resourceId);if(!old||m.revision>old.metadata.revision||(m.revision===old.metadata.revision&&m.created>old.metadata.created))outages.set(m.documentId+'|'+m.resourceId,series);continue;}
    const version=document.dataset==='generation_actual'?'Actual':document.dataset==='wind_solar_forecast_day_ahead'?'DA':document.dataset==='wind_solar_forecast_intraday'?'ID':null;
    if(version&&m.psr==='B16')label='Solar '+version;
    if(version&&['B18','B19'].includes(m.psr))label='Eolian '+version;
    for(const period of series.periods){if(!period.resolution||!['A01','A03',''].includes(m.curve))continue;
      const points=[...period.points].sort((a,b)=>a.position-b.position);
      for(let i=0;i<points.length;i++){const point=points[i],start=period.start+(point.position-1)*period.resolution,end=m.curve==='A03'?Math.min(period.end,i+1<points.length?period.start+(points[i+1].position-1)*period.resolution:period.end):Math.min(period.end,start+period.resolution);if(start<low||start>=high||end<=start)continue;
        if(label&&m.unit==='MAW'){
          if(label.startsWith('Eolian ')){const name=label+'|'+m.psr;if(!wind.has(label))wind.set(label,new Set());wind.get(label).add(name);store.interval(name,start,end,point.quantity);}
          else store.interval(label,start,end,point.quantity,'mean','MW');
        }
        const flow=/^(commercial_exchanges|physical_flows)_([A-Z]+)_(import|export)(?:_(A01|A05))?$/.exec(document.dataset);
        if(flow&&m.unit==='MAW')store.interval((flow[3]==='import'?'Import':'Export')+' '+(flow[1]==='physical_flows'?'Actual':flow[4]==='A05'?'Total':'DA')+'|'+flow[2],start,end,point.quantity);
        if(document.dataset==='imbalance_volumes'&&m.unit==='MWH')store.interval('ENTSO-E · Dezechilibru (MWh)',start,end,signedImbalance(point.quantity,m.direction),'sum','MWh');
        if(document.dataset==='imbalance_prices'&&m.currency==='RON'&&['A04','A05'].includes(point['imbalance_Price.category']))store.interval('ENTSO-E · Preț dezechilibru '+(point['imbalance_Price.category']==='A05'?'deficit':'excedent')+' (RON/MWh)',start,end,point.secondaryPrice,'mean','RON/MWh');
      }
    }
  }
  for(const [label,names]of wind){const sources=[...names].map(n=>store.values.get(n));for(const time of sources[0]?.keys()||[]){const values=sources.map(s=>s.get(time));if(values.every(Number.isFinite))store.put(label,time,values.reduce((a,b)=>a+b,0),'mean','MW');}}
  if(outages.size){const lost=new Map();for(const series of outages.values()){const m=series.metadata;if(m.status!=='A05'||m.unit!=='MAW'||m.capacity===null||!m.resourceId)continue;for(const period of series.periods){const points=[...period.points].sort((a,b)=>a.position-b.position);for(let i=0;i<points.length;i++){const point=points[i];if(point.quantity===null||!period.resolution)continue;const start=Math.max(low,period.start+(point.position-1)*period.resolution),end=Math.min(high,m.curve==='A03'?(i+1<points.length?period.start+(points[i+1].position-1)*period.resolution:period.end):period.start+point.position*period.resolution);for(let t=Math.ceil(start/900000)*900000;t<end;t+=900000){if(!lost.has(t))lost.set(t,new Map());const units=lost.get(t);units.set(m.resourceId,Math.max(units.get(m.resourceId)||0,m.capacity-point.quantity,0));}}}}
    for(const [time,units]of lost)store.put('Indisponibilitati',time,[...units.values()].reduce((a,b)=>a+b,0),'mean','MW');
  }
  for(const kind of ['DA','Total','Actual'])for(const direction of ['Import','Export']){const label=direction+' '+kind,sources=['BG','HU','RS','MD','UA'].map(country=>store.values.get(label+'|'+country));if(sources.some(s=>!s))continue;for(const time of sources[0].keys()){const values=sources.map(s=>s.get(time));if(values.every(Number.isFinite))store.put(label,time,values.reduce((a,b)=>a+b,0),'mean','MW');}}
}
function damas(rows,store){
  for(const row of rows){const p=row.payload,start=Date.parse(row.interval_start),end=Date.parse(row.interval_end);
    if(row.report==='estimatedImbalancePrices')for(const [label,field,mode,unit]of [['DAMAS · Preț dezechilibru deficit (RON/MWh)','estimatedPriceNegativeImbalance','mean','RON/MWh'],['DAMAS · Preț dezechilibru excedent (RON/MWh)','estimatedPricePositiveImbalance','mean','RON/MWh'],['DAMAS · Volum reglaj în sus (brut)','sumQup','mean','unconfirmed'],['DAMAS · Volum reglaj în jos (brut)','sumQdn','mean','unconfirmed']])store.interval(label,start,end,p[field],mode,unit);
    if(row.report==='estimatedPowerSystemImbalance'&&p.type!=='N/A'){store.interval('DAMAS · Rezervă activată (brut)',start,end,p.activatedReserve,'mean','unconfirmed');store.interval('DAMAS · Dezechilibru estimat (brut)',start,end,p.estimatedSystemImbalance,'mean','unconfirmed');}
    if(row.report==='scheduledExchanges')for(const country of ['BG','HU','RS','MD','UA'])for(const direction of ['Import','Export']){
      const field=direction==='Import'?country.toLowerCase()+'ro':'ro'+country.toLowerCase();
      for(const [kind,key]of [['DA','dayAhead'],['Total','commercial']]){const label=direction+' '+kind+'|'+country;if(!store.values.get(label)?.has(start))store.interval(label,start,end,p[field]?.[key],'mean','MW');}
    }
  }
}
const difference=(r,a,b)=>numeric(r[a])===null||numeric(r[b])===null?null:r[a]-r[b];
export async function loadDashboard(from,to){
  if(from<'2026-10-01'||to<from)throw Error('Selectează o perioadă începând cu 1 octombrie 2026.');
  const low=midnight(addDays(from,-1)),high=midnight(addDays(to,1));
  const range={delivery_date:'gte.'+addDays(from,-1),and:`(delivery_date.lte.${addDays(to,1)})`};
  const flowDatasets=['BG','HU','RS','MD','UA'].flatMap(c=>['import','export'].flatMap(d=>[`commercial_exchanges_${c}_${d}_A01`,`commercial_exchanges_${c}_${d}_A05`,`physical_flows_${c}_${d}`]));
  const [tables,rates,documents,reports,weather,npAccess]=await Promise.all([
    cachedRows('opcom_tables',{...range,order:'delivery_date,source,dataset'},r=>r.source+'|'+r.delivery_date+'|'+r.dataset),cachedRows('bnr_rates',{order:'rate_date'},r=>r.rate_date),
    cachedRows('entsoe_documents',{...range,dataset:'in.('+[...coreDatasets,...flowDatasets].join(',')+')',order:'dataset,delivery_date'},r=>r.dataset+'|'+r.delivery_date),
    cachedRows('damas_report_observations',{interval_start:'gte.'+new Date(low).toISOString(),and:`(interval_start.lt.${new Date(high).toISOString()})`,order:'report,interval_start'},r=>r.report+'|'+r.interval_start),
    cachedRows('weather_weighted_hours',{observed_at:'gte.'+new Date(low).toISOString(),and:`(observed_at.lt.${new Date(high).toISOString()})`,order:'observed_at'},r=>r.observed_at),authorized()
  ]);
  const store=new SeriesStore(),{ida}=opcom(tables,rates,store);
  damas(reports,store);entsoe(documents,store,low,high);
  for(const hour of weather)store.interval('Temperatura',Date.parse(hour.observed_at),Date.parse(hour.observed_at)+3600000,hour.temperature_c,'mean','°C');
  let contracts=[];
  if(npAccess){const records=await privateRows('nordpool_contracts',q=>q.eq('area','TEL').gte('delivery_date',from).lte('delivery_date',to).order('delivery_start').order('contract_id'));
    contracts=records.filter(r=>Date.parse(r.payload.deliveryEnd)-Date.parse(r.payload.deliveryStart)===3600000).map(r=>{const p=r.payload,t=Date.parse(p.deliveryStart),parts=localParts(t);return {...p,zi:parts.day,ph:parts.hour+1,start_local:parts.day+'T'+String(parts.hour).padStart(2,'0')+':00:00'};});
    for(const c of contracts)if(numeric(c.volume)>0)for(const [label,field]of [['ID O','openPrice'],['ID H','highPrice'],['ID L','lowPrice'],['ID C','closePrice'],['ID VWAP','averagePrice'],['ID volum buy','buyVolume'],['ID volum sell','sellVolume']])store.interval(label,Date.parse(c.deliveryStart),Date.parse(c.deliveryEnd),c[field]);
  }
  const hourly=store.hourly(from,to),levels=[];
  for(const day of dayRange(from,to))for(let ph=1;ph<=24;ph++){const r={Data:day,PH:ph,...hourly.get(day+'|'+ph)};
    for(const key of [...MARKETS,...FUNDAMENTALS])if(!(key in r))r[key]=null;
    r['Eroare consum']=difference(r,'Consum Actual','Consum DA');
    for(const component of ['Solar','Eolian'])for(const version of ['DA','ID'])r[`Eroare ${component==='Solar'?'solar':'eolian'} ${version}`]=difference(r,component+' Actual',component+' '+version);
    for(const version of ['DA','ID','Actual']){const keys=[version==='Actual'?'Consum Actual':'Consum DA','Solar '+version,'Eolian '+version];r['Sarcina reziduala '+version]=keys.every(k=>numeric(r[k])!==null)?r[keys[0]]-r[keys[1]]-r[keys[2]]:null;}
    r['Spread ID VWAP - PZU']=difference(r,'ID VWAP','PZU pret');const net=r['ENTSO-E · Dezechilibru (MWh)'];r['ENTSO-E · Statut dezechilibru']=net===null?null:Math.sign(net);levels.push(r);
  }
  return {levels,contracts,ida,npAccess,units:Object.fromEntries(store.units),collectedAt:new Date().toISOString(),coverage:{opcom:tables.length,entsoe:documents.length,damas:reports.length,weather:weather.length}};
}
export async function loadTrades(contracts,days,ph){
  const ids=contracts.filter(c=>days.includes(c.zi)&&c.ph===ph).map(c=>c.contractId);if(!ids.length)return [];
  const rows=await privateRows('nordpool_trades',q=>q.eq('area','TEL').in('contract_id',ids).order('trade_time').order('trade_id'));
  return rows.filter(r=>r.state==='Completed'&&numeric(r.payload.price)!==null&&numeric(r.payload.volume)>0).map(r=>r.payload);
}
