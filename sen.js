import {setupSenOverview} from './web/sen-overview.js?v=20261012-pill-ranges';
import {setupImbalanceOverview} from './web/imbalance-overview.js';
setupSenOverview();
setupImbalanceOverview();
if(location.hash==='#indicatori'||location.hash==='#comparisons')location.replace('indicatori/');
window.addEventListener('sen-ready',()=>{
 const preload=async()=>{
  if(navigator.connection?.saveData)return;
  for(const href of ['indicatori/','app.js']){const link=document.createElement('link');link.rel='prefetch';link.href=href;document.head.append(link);}
  try{
   const [{loadDashboard},{localParts,addDays}]=await Promise.all([import('./web/dashboard-data.js'),import('./web/time.js')]);
   const anchor=new Date(localParts(Date.now()).day+'T12:00:00Z');anchor.setUTCDate(anchor.getUTCDate()-((anchor.getUTCDay()+6)%7));
   const monday=anchor.toISOString().slice(0,10);
   await loadDashboard([addDays(monday,-7),'2026-10-01'].sort().at(-1),addDays(monday,6),true);
  }catch{/* Preloading is optional; Indicatori retries on navigation. */}
 };
 if('requestIdleCallback' in window)requestIdleCallback(preload,{timeout:10000});else setTimeout(preload,3000);
},{once:true});
