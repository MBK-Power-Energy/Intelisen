const KEY='intelisen-indicator-cache-v1';
const privateKeys=['ID O','ID H','ID L','ID C','ID VWAP','ID volum buy','ID volum sell','Spread ID VWAP - PZU'];
export function readIndicatorCache(from,to){
 try{
  const entries=JSON.parse(localStorage.getItem(KEY));if(!Array.isArray(entries))return null;
  const entry=entries.filter(e=>e.from<=from&&e.to>=to&&Date.now()-e.savedAt<7*86400000&&Array.isArray(e.data?.levels)).sort((a,b)=>b.savedAt-a.savedAt)[0];
  return entry?{...entry.data,levels:entry.data.levels.filter(row=>row.Data>=from&&row.Data<=to)}:null;
 }catch{return null;}
}
export function writeIndicatorCache(from,to,dashboard){
 try{
  const data={...dashboard,npAccess:false,contracts:[],levels:dashboard.levels.map(row=>{const copy={...row};for(const key of privateKeys)copy[key]=null;return copy;})};
  const previous=JSON.parse(localStorage.getItem(KEY))||[];
  const entries=[{from,to,savedAt:Date.now(),data},...previous.filter(e=>e.from!==from||e.to!==to)].slice(0,3);
  localStorage.setItem(KEY,JSON.stringify(entries));
 }catch{/* Storage may be disabled or full; live loading remains available. */}
}
