import {localParts,midnight,duration} from './time.js?v=20261012-speed';
export const numeric=v=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?null:Number(v);
// Matches ema's exported A86 rows: A02 deficit, A01 surplus.
export function signedImbalance(value,direction){value=numeric(value);return value===null?null:direction==='A02'?Math.abs(value):direction==='A01'?-Math.abs(value):null;}
export function romanianNumber(v){const s=String(v??'').trim().replace(/\s/g,'');if(!/^-?\d+(?:\.\d{3})*(?:,\d+)?$/.test(s))return null;return numeric(s.replaceAll('.','').replace(',','.'));}
const descendants=(node,name)=>[...node.getElementsByTagNameNS('*',name)];
const text=(node,name)=>descendants(node,name)[0]?.textContent?.trim()||'';
const suffixText=(node,name)=>[...node.getElementsByTagName('*')].find(el=>el.localName===name||el.localName.endsWith('.'+name))?.textContent?.trim()||'';
function flatXml(node,prefix='',out={}){for(const child of node.children){const key=prefix?prefix+'.'+child.localName:child.localName;if(child.children.length)flatXml(child,key,out);else out[key]=child.textContent?.trim();}return out;}
export function xmlSeries(document){
  const root=new DOMParser().parseFromString(document,'application/xml');if(root.getElementsByTagName('parsererror').length)throw Error('Document ENTSO-E XML invalid');
  return descendants(root,'TimeSeries').map(series=>({
    metadata:{psr:suffixText(series,'psrType'),business:text(series,'businessType'),direction:text(series,'flowDirection.direction'),unit:text(series,'quantity_Measure_Unit.name'),currency:text(series,'currency_Unit.name'),curve:text(series,'curveType'),id:text(series,'mRID'),resource:suffixText(series,'powerSystemResources.name')||suffixText(series,'registeredResource.name')||suffixText(series,'production_RegisteredResource.name'),resourceId:suffixText(series,'powerSystemResources.mRID')||suffixText(series,'registeredResource.mRID')||suffixText(series,'production_RegisteredResource.mRID'),capacity:numeric(suffixText(series,'nominalP')),status:text(series.parentElement,'docStatus.value')||text(series.parentElement,'value'),documentId:text(series.parentElement,'mRID'),revision:numeric(text(series.parentElement,'revisionNumber')),created:text(series.parentElement,'createdDateTime')},
    periods:[...descendants(series,'Period'),...descendants(series,'Available_Period')].map(period=>({
      start:Date.parse(text(period,'start')),
      end:Date.parse(text(period,'end')),
      resolution:duration(text(period,'resolution')),
      resolutionText:text(period,'resolution'),
      points:descendants(period,'Point').map(point=>({
        ...flatXml(point),
        position:numeric(text(point,'position')),
        quantity:numeric(text(point,'quantity')),
        price:numeric(text(point,'price.amount')),
        secondaryPrice:numeric(text(point,'imbalance_Price.amount'))
      }))
    }))
  }));
}
export class SeriesStore{
  constructor(){this.values=new Map();this.modes=new Map();this.units=new Map();}
  put(name,time,value,mode='mean',unit=''){value=numeric(value);if(value===null||!Number.isFinite(time))return;if(!this.values.has(name))this.values.set(name,new Map());this.values.get(name).set(time,value);this.modes.set(name,mode);if(unit)this.units.set(name,unit);}
  interval(name,start,end,value,mode='mean',unit=''){
    value=numeric(value);if(value===null||end<=start||!Number.isFinite(start+end))return;
    const count=(end-start)/900000;if(!Number.isInteger(count)||count<1||count>40000)return;
    for(let time=start;time<end;time+=900000)this.put(name,time,mode==='sum'?value/count:value,mode,unit);
  }
  hourly(from,to){
    const result=new Map(),parts=new Map();
    const hourParts=hour=>{if(!parts.has(hour))parts.set(hour,localParts(hour));return parts.get(hour);};
    for(const [name,points]of this.values){const hours=new Map();for(const [time,value]of points){const hour=Math.floor(time/3600000)*3600000;if(!hours.has(hour))hours.set(hour,new Map());hours.get(hour).set(time,value);}
      const ambiguity=new Map();for(const hour of hours.keys()){const p=hourParts(hour),key=p.day+'|'+(p.hour+1);ambiguity.set(key,(ambiguity.get(key)||0)+1);}
      for(const [hour,quarters]of hours){const p=hourParts(hour),key=p.day+'|'+(p.hour+1);if(p.day<from||p.day>to||quarters.size!==4||ambiguity.get(key)!==1)continue;
        if(![0,1,2,3].every(i=>quarters.has(hour+i*900000)))continue;
        const total=[...quarters.values()].reduce((a,b)=>a+b,0);if(!result.has(key))result.set(key,{Data:p.day,PH:p.hour+1});result.get(key)[name]=this.modes.get(name)==='sum'?total:total/4;
      }
    }return result;
  }
}
export function opcom(tables,rates,store){
  const ida=[],raw=[];const sorted=[...rates].sort((a,b)=>a.rate_date.localeCompare(b.rate_date));
  for(const table of tables){const start=midnight(table.delivery_date),rate=sorted.filter(r=>r.rate_date<=localParts(start,'Europe/Bucharest').day).at(-1)?.eur_ron;
    const minutes=table.source==='opcom_ida'?15:Number(table.dataset.match(/\d+/)?.[0]);
    for(const cells of table.rows){const index=table.source==='opcom_pzu'&&table.dataset==='rez15min'?1:0,slot=numeric(cells[index]);if(!Number.isInteger(slot)||slot<1)continue;
      const time=start+(slot-1)*minutes*60000,end=time+minutes*60000,price=romanianNumber(cells[index+1]);
      raw.push({...table,rows:undefined,interval:slot,start:new Date(time).toISOString(),values:cells});
      if(table.source==='opcom_ida'){store.interval(table.dataset+' pret',time,end,price,'mean','EUR/MWh');ida.push({delivery_date:table.delivery_date,auction:table.dataset,interval:slot,price_eur_per_MWh:price});}
      else{
        store.interval(`PZU ${minutes} min (RON/MWh)`,time,end,price,'mean','RON/MWh');
        if(minutes===60&&numeric(rate)>0)store.interval('PZU pret',time,end,price===null?null:price/Number(rate),'mean','EUR/MWh');
        if(minutes===15)for(const [label,col]of [['PZU volum tranzactionat',3],['PZU volum buy',4],['PZU volum sell',5]]){const power=romanianNumber(cells[col]);store.interval(label,time,end,power===null?null:power*minutes/60,'sum','MWh');}
      }
    }
  }return {ida,raw};
}
