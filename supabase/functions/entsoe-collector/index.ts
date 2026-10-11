import { createClient } from "npm:@supabase/supabase-js@2.49.8";
import { unzipSync, strFromU8 } from "npm:fflate@0.8.2";
const db = createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});
Deno.serve(async(req)=>{
 if(req.method!=="POST")return new Response("Method not allowed",{status:405});
 const {data:jobs,error}=await db.rpc("entsoe_worker_claim",{p_secret:req.headers.get("x-collector-secret")||""});
 if(error)return new Response("Unauthorized",{status:401});
 const results=[];
 for(const job of jobs){let status="error",docs:string[]=[];
 try{
 const u=new URL("https://web-api.tp.entsoe.eu/api");for(const [k,v]of Object.entries(job.parameters))u.searchParams.set(k,String(v));
 const response=await fetch(u,{signal:AbortSignal.timeout(30000)});const bytes=new Uint8Array(await response.arrayBuffer());
 if(![200,400].includes(response.status))throw new Error("Source rejected request");
 const candidates=bytes[0]===80&&bytes[1]===75?Object.values(unzipSync(bytes)).map(b=>strFromU8(b)):[strFromU8(bytes)];
 for(const xml of candidates){
 if(xml.includes("Acknowledgement_MarketDocument")){if(!/no matching data|no data found/i.test(xml))throw new Error("Source acknowledgement error");continue;}
 if(!xml.includes("TimeSeries"))throw new Error("Invalid source document");docs.push(xml);
 }
 status=docs.length?"ok":"not_published";
 }catch{status="error";docs=[];}
 let completed=await db.rpc("entsoe_worker_finish",{p_job:job.id,p_documents:docs,p_status:status});
 if(completed.error){status="error";await db.rpc("entsoe_worker_finish",{p_job:job.id,p_documents:[],p_status:"error"});}
 results.push({dataset:job.dataset,status});
 }
 return Response.json({results});
});
