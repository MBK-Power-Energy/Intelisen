export const VOLUME_SERIES=['PZU-O','PZU-N','IDA1-N','IDA2-N','IDA3-N','ID'];
const markets={DayAhead:'PZU-N',SIDC_IntradayAuction1:'IDA1-N',SIDC_IntradayAuction2:'IDA2-N',SIDC_IntradayAuction3:'IDA3-N'};
const numeric=v=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?null:Number(v);
export function volumeComparison(store,auctions,contracts,minutes,side){
 const points=new Map(VOLUME_SERIES.map(name=>[name,new Map()]));
 const put=(name,time,v)=>{v=numeric(v);if(v!==null&&Number.isFinite(time))points.get(name).set(time,v);};
 // OPCOM quarterly volume is energy (MWh); divide by 0.25 h to compare power (MW).
 for(const [time,value]of store.values.get('PZU volum '+side)||[])put('PZU-O',time,value*4);
 for(const row of auctions){const name=markets[row.market];if(!name||!['Final','Preliminary'].includes(row.status))continue;const start=Date.parse(row.interval_start),end=Date.parse(row.interval_end);for(let t=start;t<end;t+=900000)put(name,t,row[side+'_mw']);}
 // Sum power from every contract covering each quarter, then average into the selected period.
 for(const row of contracts){const p=row.payload,start=Date.parse(p.deliveryStart),end=Date.parse(p.deliveryEnd),value=numeric(p[side==='buy'?'buyVolume':'sellVolume']);if(value===null||!Number.isFinite(start+end)||end<=start||(end-start)%900000!==0)continue;for(let t=start;t<end;t+=900000)put('ID',t,(points.get('ID').get(t)??0)+value);}
 const step=minutes*60000,slots=new Set();for(const series of points.values())for(const t of series.keys())slots.add(Math.floor(t/step)*step);
 return [...slots].sort((a,b)=>a-b).map(time=>({time,...Object.fromEntries(VOLUME_SERIES.map(name=>{const series=points.get(name),values=Array.from({length:minutes/15},(_,i)=>series.get(time+i*900000));return [name,name==='ID'?(values.some(Number.isFinite)?values.reduce((a,b)=>a+(b??0),0)/values.length:null):values.every(Number.isFinite)?values.reduce((a,b)=>a+b,0)/values.length:null];}))}));
}

export function volumeShares(values){
 const total=VOLUME_SERIES.reduce((sum,name)=>sum+(numeric(values[name])??0),0);
 return Object.fromEntries(VOLUME_SERIES.map(name=>[name,total>0&&numeric(values[name])!==null?100*Number(values[name])/total:null]));
}
