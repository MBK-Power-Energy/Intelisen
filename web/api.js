export const PROJECTS={sen:{url:'https://squtjqwjnwlnqlvfzlzg.supabase.co',key:'sb_publishable_yW7kn9Ut89ir2sTNTueDDw_S5vO3eUU'},nordpool:{url:'https://qumxkyavlavixzaevipw.supabase.co',key:'sb_publishable_mL3Wbt0duI8TslUErFWzVg_FOpQxctS'}};
export const nordpool=supabase.createClient(PROJECTS.nordpool.url,PROJECTS.nordpool.key);
export async function publicRows(table,parameters={}){
  const rows=[];
  for(let offset=0;;offset+=1000){
    const query=new URLSearchParams({...parameters,limit:'1000',offset:String(offset)});
    const response=await fetch(PROJECTS.sen.url+'/rest/v1/'+table+'?'+query,{headers:{apikey:PROJECTS.sen.key},cache:'no-store',signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw Error(table+': HTTP '+response.status);
    const page=await response.json();rows.push(...page);if(page.length<1000)return rows;
    if(rows.length>=250000)throw Error('Perioada selectată este prea mare.');
  }
}
export async function privateRows(table,filter){
  const rows=[];
  for(let offset=0;;offset+=1000){const {data,error}=await filter(nordpool.from(table).select('*')).range(offset,offset+999);if(error)throw error;rows.push(...data);if(data.length<1000)return rows;if(rows.length>=250000)throw Error('Selectează mai puține zile pentru tranzacții.');}
}
export async function authorized(){const {data:{session}}=await nordpool.auth.getSession();if(!session)return false;const {data,error}=await nordpool.rpc('nordpool_authorized');return !error&&data===true;}
const sourceCache=new Map();
export async function cachedRows(table,parameters,identity,timestamp='collected_at'){
  const key=table+'|'+JSON.stringify(parameters),previous=sourceCache.get(key);
  const query={...parameters};if(previous?.cursor)query[timestamp]='gte.'+new Date(previous.cursor-120000).toISOString();
  const incoming=await publicRows(table,query),rows=new Map(previous?.rows||[]);
  for(const row of incoming)rows.set(identity(row),row);
  const cursor=incoming.reduce((max,row)=>Math.max(max,Date.parse(row[timestamp])||0),previous?.cursor||0);
  sourceCache.set(key,{rows,cursor});if(sourceCache.size>24)sourceCache.delete(sourceCache.keys().next().value);
  return [...rows.values()];
}
