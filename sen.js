import {setupSenOverview} from './web/sen-overview.js?v=20261012-pill-ranges';
import {setupImbalanceOverview} from './web/imbalance-overview.js';
setupSenOverview();
setupImbalanceOverview();
if(location.hash==='#indicatori'||location.hash==='#comparisons')location.replace('indicatori/');
window.addEventListener('sen-ready',()=>{
 const preload=async()=>{
  if(navigator.connection?.saveData)return;
  for(const href of ['indicatori/','app.js?v=20261012-speed']){const link=document.createElement('link');link.rel='prefetch';link.href=href;document.head.append(link);}
  try{
   const [{loadDashboard},{localParts,addDays}]=await Promise.all([import('./web/dashboard-data.js?v=20261012-speed'),import('./web/time.js?v=20261012-speed')]);
   const today=localParts(Date.now(),'Europe/Bucharest').day;
   await loadDashboard([addDays(today,-8),'2026-10-01'].sort().at(-1),addDays(today,1),true);
  }catch{/* Preloading is optional; Indicatori retries on navigation. */}
 };
 if('requestIdleCallback' in window)requestIdleCallback(preload,{timeout:10000});else setTimeout(preload,3000);
},{once:true});
