export const MARKET_ZONE='Europe/Brussels';
export function localParts(time,zone=MARKET_ZONE){
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(time)).map(x=>[x.type,x.value]));
  return {day:`${p.year}-${p.month}-${p.day}`,hour:Number(p.hour),minute:Number(p.minute)};
}
export function midnight(day,zone=MARKET_ZONE){
  const target=Date.parse(day+'T00:00:00Z');let time=target;
  for(let i=0;i<3;i++){const p=localParts(time,zone),local=Date.parse(p.day+'T00:00:00Z')+(p.hour*60+p.minute)*60000;time+=target-local;}
  return time;
}
export function addDays(day,n){return new Date(Date.parse(day+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);}
export function dayRange(from,to){const days=[];for(let d=from;d<=to;d=addDays(d,1))days.push(d);return days;}
export function duration(text){const p=/^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(text||'');return p?(((Number(p[1]||0)*7+Number(p[2]||0))*24+Number(p[3]||0))*60+Number(p[4]||0))*60000+Number(p[5]||0)*1000:null;}
export function boundary(start,resolution,position){
  const calendar=/^P(\d+)([YM])$/.exec(resolution||'');if(!calendar){const step=duration(resolution);return step?start+position*step:NaN;}
  const d=new Date(start),months=d.getUTCFullYear()*12+d.getUTCMonth()+position*Number(calendar[1])*(calendar[2]==='Y'?12:1),year=Math.floor(months/12),month=months%12,day=Math.min(d.getUTCDate(),new Date(Date.UTC(year,month+1,0)).getUTCDate());
  return Date.UTC(year,month,day,d.getUTCHours(),d.getUTCMinutes(),d.getUTCSeconds());
}
