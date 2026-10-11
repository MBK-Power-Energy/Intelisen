const KEY='intelisen-indicator-cache-v1';
const privateKeys=['ID O','ID H','ID L','ID C','ID VWAP','ID volum buy','ID volum sell','Spread ID VWAP - PZU'];
export function readIndicatorCache(from,to){
 try{const entry=JSON.parse(localStorage.getItem(KEY))?.find(e=>e.from===from&&e.to===to);return entry&&Date.now()-entry.savedAt<7*86400000&&Array.isArray(entry.data.levels)?entry.data:null;}catch{return null;}
}
export function writeIndicatorCache(from,to,dashboard){
 try{
  const data={...dashboard,npAccess:false,contracts:[],levels:dashboard.levels.map(row=>{const copy={...row};for(const key of privateKeys)copy[key]=null;return copy;})};
  const previous=JSON.parse(localStorage.getItem(KEY))||[];
  const entries=[{from,to,savedAt:Date.now(),data},...previous.filter(e=>e.from!==from||e.to!==to)].slice(0,3);
  localStorage.setItem(KEY,JSON.stringify(entries));
 }catch{/* Storage may be disabled or full; live loading remains available. */}
}
