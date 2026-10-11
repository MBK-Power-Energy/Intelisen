export const number=v=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?null:Number(v);
export const timestamp=v=>Math.floor(Date.parse(v)/1000);
export function overview(rows){
 const chosen=new Map();
 for(const r of rows){const p=r.payload, t=timestamp(p.deliveryStart);if(!Number.isFinite(t))continue;
 const old=chosen.get(t);if(!old || timestamp(p.updatedAt)>timestamp(old.updatedAt))chosen.set(t,p);}
 const contracts=[...chosen.values()].sort((a,b)=>timestamp(a.deliveryStart)-timestamp(b.deliveryStart));
 const candles=contracts.filter(p=>['openPrice','highPrice','lowPrice','closePrice'].every(k=>number(p[k])!==null)).map(p=>({time:timestamp(p.deliveryStart),open:number(p.openPrice),high:number(p.highPrice),low:number(p.lowPrice),close:number(p.closePrice)}));
 const lines=Object.fromEntries(['averagePrice','averagePriceLast3H','averagePriceLast1H'].map(k=>[k,contracts.filter(p=>number(p[k])!==null).map(p=>({time:timestamp(p.deliveryStart),value:number(p[k])}))]));
 const volumes=contracts.filter(p=>number(p.volume)!==null).map(p=>({time:timestamp(p.deliveryStart),value:number(p.volume),color:number(p.closePrice)>=number(p.openPrice)?'#26a69a':'#ef5350'}));
 return {candles,lines,volumes,contracts};
}
export function tradeBars(rows,minutes=5,period=20){
 const latest=new Map();for(const r of rows){const p=r.payload,key=p.contractId+':'+p.tradeId,prev=latest.get(key);if(!prev || Number(p.revisionNumber)>Number(prev.revisionNumber)||(Number(p.revisionNumber)===Number(prev.revisionNumber)&&String(p.tradeUpdatedAt)>=String(prev.tradeUpdatedAt)))latest.set(key,p);}
 const trades=[...latest.values()].filter(p=>p.tradeState==='Completed'&&number(p.price)!==null&&number(p.volume)>0&&Number.isFinite(timestamp(p.tradeTime))).sort((a,b)=>timestamp(a.tradeTime)-timestamp(b.tradeTime)||String(a.tradeId).localeCompare(String(b.tradeId)));
 const grouped=new Map();let totalPV=0,totalV=0;
 for(const p of trades){const t=Math.floor(timestamp(p.tradeTime)/(minutes*60))*minutes*60,price=number(p.price),volume=number(p.volume);let bar=grouped.get(t);if(!bar){bar={time:t,open:price,high:price,low:price,close:price,volume:0};grouped.set(t,bar);}bar.high=Math.max(bar.high,price);bar.low=Math.min(bar.low,price);bar.close=price;bar.volume+=volume;totalPV+=price*volume;totalV+=volume;bar.vwap=totalPV/totalV;}
 let ema=null;const bars=[...grouped.values()], alpha=2/(period+1);for(const b of bars){ema=ema===null?b.close:alpha*b.close+(1-alpha)*ema;b.ema=ema;}
 return {candles:bars.map(({time,open,high,low,close})=>({time,open,high,low,close})),volumes:bars.map(b=>({time:b.time,value:b.volume,color:b.close>=b.open?'#26a69a':'#ef5350'})),vwap:bars.map(b=>({time:b.time,value:b.vwap})),ema:bars.map(b=>({time:b.time,value:b.ema})),trades};
}
