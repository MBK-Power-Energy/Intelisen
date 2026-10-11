import {publicRows} from './api.js';
import {midnight,localParts,addDays} from './time.js';
const $=id=>document.getElementById(id);
export const SEN_SERIES=[
 ['consumption_mw','Consum','#ff5598'],['hourly_average_consumption_mw','Medie orară consum','#1554e8'],['production_mw','Producție','#7636d0'],['coal_mw','Cărbune','#555555'],['hydrocarbons_mw','Hidrocarburi','#e8aa00'],['hydro_mw','Ape','#00a0c6'],['nuclear_mw','Nuclear','#f43c3c'],['wind_mw','Eolian','#179b19'],['solar_mw','Foto','#a60000'],['biomass_mw','Biomasă','#a06a35'],['balance_mw','Sold','#ca4c79']
];
let rows=[],busy=false,hoverBound=false;
function showValues(row){for(const [key]of SEN_SERIES)$('senValue-'+key).textContent=fmt(row?.[key])+' MW';}
const fmt=v=>Number.isFinite(v)?v.toLocaleString('ro-RO',{maximumFractionDigits:1}):'—';
const dateTime=t=>($('senFrom').value!==$('senTo').value?new Date(t).toLocaleDateString('ro-RO',{timeZone:'Europe/Bucharest',day:'2-digit',month:'2-digit'})+' ':'')+time(t);
const time=t=>new Date(t).toLocaleTimeString('ro-RO',{timeZone:'Europe/Bucharest',hour:'2-digit',minute:'2-digit'});
function draw(){
 const dark=document.documentElement.dataset.theme==='dark',selected=[...document.querySelectorAll('#senSeries input:checked')].map(el=>el.value),end=rows.at(-1);
 const low=midnight($('senFrom').value,'Europe/Bucharest'),high=midnight(addDays($('senTo').value,1),'Europe/Bucharest'),step=Math.max(3,Math.ceil((high-low)/3600000/8/3)*3)*3600000,ticks=[];for(let t=low;t<high;t+=step)ticks.push(new Date(t).toISOString());ticks.push(new Date(high).toISOString());
 const traces=SEN_SERIES.filter(([key])=>selected.includes(key)).map(([key,label,color])=>{const x=[],y=[],customdata=[];let previous;for(const row of rows){if(previous&&Date.parse(row.observed_at)-Date.parse(previous)>30*60000){x.push(new Date((Date.parse(previous)+Date.parse(row.observed_at))/2).toISOString());y.push(null);customdata.push('');}x.push(row.observed_at);y.push(Number.isFinite(row[key])?row[key]:null);customdata.push(dateTime(row.observed_at));previous=row.observed_at;}return {name:label,x,y,customdata,mode:'lines',type:'scatter',line:{color,width:2.5,shape:key==='hourly_average_consumption_mw'?'hv':'linear'},connectgaps:false,hoverinfo:'none'};});
 Plotly.react('senOverviewChart',traces,{height:510,margin:{t:25,r:25,b:65,l:65},paper_bgcolor:dark?'#131f28':'#fff',plot_bgcolor:dark?'#131f28':'#fff',font:{color:dark?'#e9f1f3':'#172033'},showlegend:false,hovermode:'closest',hoverdistance:-1,spikedistance:-1,uirevision:$('senFrom').value+'|'+$('senTo').value,xaxis:{title:{text:'Ora locală'},showspikes:true,spikemode:'across',spikesnap:'cursor',spikecolor:dark?'#91a6b2':'#65758b',spikethickness:1,spikedash:'dash',type:'date',autorange:false,range:[new Date(midnight($('senFrom').value,'Europe/Bucharest')).toISOString(),new Date(midnight(addDays($('senTo').value,1),'Europe/Bucharest')).toISOString()],tickvals:ticks,ticktext:ticks.map((t,i)=>i===ticks.length-1&&$('senFrom').value===$('senTo').value?'24:00':dateTime(t)),gridcolor:dark?'#293842':'#e5e9ef'},yaxis:{title:{text:'MW'},gridcolor:dark?'#293842':'#e5e9ef',zerolinecolor:dark?'#91a6b2':'#8592a3'}},{responsive:true,displaylogo:false});
 showValues(end);
 const chart=$('senOverviewChart');
 if(!hoverBound){
  chart.on('plotly_hover',event=>{const point=event.points?.[0],stamp=point?.data?.x?.[point.pointNumber];if(stamp){const row=rows.find(row=>row.observed_at===stamp);if(row)showValues(row);}});
  chart.on('plotly_unhover',()=>showValues(rows.at(-1)));
  hoverBound=true;
 }
 $('senEmpty').hidden=selected.length>0;
}
async function refresh(){if(busy)return;const from=$('senFrom').value,to=$('senTo').value;if(!from||!to||from<'2026-10-01'||to<from){$('senOverviewStatus').textContent='Selectează un interval valid începând cu 1 octombrie 2026.';return;}busy=true;$('senOverviewStatus').textContent='Se încarcă intervalul '+from+' – '+to+'…';try{
 const data=await publicRows('sen_observations',{observed_at:'gte.'+new Date(midnight(from,'Europe/Bucharest')).toISOString(),and:`(observed_at.lt.${new Date(midnight(addDays(to,1),'Europe/Bucharest')).toISOString()})`,order:'observed_at'});
 if(from!==$('senFrom').value||to!==$('senTo').value)return;rows=data;
 const end=rows.at(-1);for(const [id,key]of [['liveConsumption','consumption_mw'],['liveProduction','production_mw'],['liveBalance','balance_mw']])$(id).textContent=fmt(end?.[key]);$('liveTime').textContent=end?dateTime(end.observed_at):'—';
 $('senOverviewStatus').textContent=from+' – '+to+' · '+(end?'ultima observație: '+new Date(end.observed_at).toLocaleString('ro-RO',{timeZone:'Europe/Bucharest'}):'fără observații pentru intervalul selectat')+' · verificare automată la 60 secunde';draw();
 }catch(error){$('senOverviewStatus').textContent='SEN: '+error.message+(rows.length?' · sunt păstrate ultimele date citite':'');}finally{busy=false;if(from!==$('senFrom').value||to!==$('senTo').value)refresh();}}
export function setupSenOverview(){
 let rangeTimer;const changed=()=>{clearTimeout(rangeTimer);rangeTimer=setTimeout(refresh,200);};
 const today=localParts(Date.now(),'Europe/Bucharest').day;for(const id of ['senFrom','senTo']){$(id).value=today;$(id).max=today;$(id).addEventListener('input',changed);$(id).addEventListener('change',changed);}

 let saved;try{saved=JSON.parse(localStorage.getItem('intelisen-sen-series'))}catch{}
 for(const [key,label,color]of SEN_SERIES){const item=document.createElement('label');item.className='sen-series-pill';const input=document.createElement('input');input.type='checkbox';input.value=key;input.checked=!Array.isArray(saved)||saved.includes(key);const dot=document.createElement('span');dot.className='sen-series-dot';dot.style.backgroundColor=color;const name=document.createElement('span');name.textContent=label;const value=document.createElement('strong');value.id='senValue-'+key;value.textContent='—';item.append(input,dot,name,value);$('senSeries').append(item);input.onchange=()=>{try{localStorage.setItem('intelisen-sen-series',JSON.stringify([...$('senSeries').querySelectorAll('input:checked')].map(el=>el.value)))}catch{}draw();};}
 $('senSelectAll').onclick=()=>{for(const input of $('senSeries').querySelectorAll('input'))input.checked=true;try{localStorage.removeItem('intelisen-sen-series')}catch{}draw();};window.addEventListener('intelisen-theme-change',draw);setInterval(()=>{if(!document.hidden)refresh()},60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()});refresh();
}
