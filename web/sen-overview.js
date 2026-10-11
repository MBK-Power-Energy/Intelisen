import {publicRows,PROJECTS} from './api.js';
const $=id=>document.getElementById(id);
export const SEN_SERIES=[
 ['consumption_mw','Consum','#ff5598'],['hourly_average_consumption_mw','Medie orară consum','#1554e8'],['production_mw','Producție','#7636d0'],['coal_mw','Cărbune','#555555'],['hydrocarbons_mw','Hidrocarburi','#e8aa00'],['hydro_mw','Ape','#00a0c6'],['nuclear_mw','Nuclear','#f43c3c'],['wind_mw','Eolian','#179b19'],['solar_mw','Foto','#a60000'],['biomass_mw','Biomasă','#a06a35'],['balance_mw','Sold','#ca4c79']
];
let rows=[],busy=false;
const fmt=v=>Number.isFinite(v)?v.toLocaleString('ro-RO',{maximumFractionDigits:1}):'—';
const time=t=>new Date(t).toLocaleTimeString('ro-RO',{timeZone:'Europe/Bucharest',hour:'2-digit',minute:'2-digit'});
function draw(){
 const dark=document.documentElement.dataset.theme==='dark',selected=[...document.querySelectorAll('#senSeries input:checked')].map(el=>el.value),end=rows.at(-1),ticks=rows.filter((_,i)=>i%Math.max(1,Math.ceil(rows.length/8))===0);
 const traces=SEN_SERIES.filter(([key])=>selected.includes(key)).map(([key,label,color])=>{const x=[],y=[],customdata=[];let previous;for(const row of rows){if(previous&&Date.parse(row.observed_at)-Date.parse(previous)>30*60000){x.push(new Date((Date.parse(previous)+Date.parse(row.observed_at))/2).toISOString());y.push(null);customdata.push('');}x.push(row.observed_at);y.push(Number.isFinite(row[key])?row[key]:null);customdata.push(time(row.observed_at));previous=row.observed_at;}return {name:label,x,y,customdata,mode:'lines',type:'scatter',line:{color,width:2.5,shape:key==='hourly_average_consumption_mw'?'hv':'linear'},connectgaps:false,hovertemplate:'%{customdata} · București<br>'+label+': %{y:.1f} MW<extra></extra>'};});
 Plotly.react('senOverviewChart',traces,{height:510,margin:{t:25,r:25,b:65,l:65},paper_bgcolor:dark?'#131f28':'#fff',plot_bgcolor:dark?'#131f28':'#fff',font:{color:dark?'#e9f1f3':'#172033'},showlegend:false,hovermode:'x',uirevision:'sen-live',xaxis:{title:{text:'Ora București'},type:'date',tickvals:ticks.map(r=>r.observed_at),ticktext:ticks.map(r=>time(r.observed_at)),gridcolor:dark?'#293842':'#e5e9ef'},yaxis:{title:{text:'MW'},gridcolor:dark?'#293842':'#e5e9ef',zerolinecolor:dark?'#91a6b2':'#8592a3'}},{responsive:true,displaylogo:false});
 for(const [key]of SEN_SERIES)$('senValue-'+key).textContent=fmt(end?.[key])+' MW';
 $('senEmpty').hidden=selected.length>0;
}
async function refresh(){if(busy)return;busy=true;try{
 const response=await fetch(PROJECTS.sen.url+'/rest/v1/sen_observations?select=observed_at&order=observed_at.desc&limit=1',{headers:{apikey:PROJECTS.sen.key},cache:'no-store',signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('HTTP '+response.status);const latest=await response.json();
 if(!latest.length){$('senOverviewStatus').textContent='Nu există încă observații SEN.';return;}
 const last=Date.parse(latest[0].observed_at),low=new Date(last-24*3600000).toISOString();
 rows=await publicRows('sen_observations',{observed_at:'gte.'+low,and:`(observed_at.lte.${new Date(last).toISOString()})`,order:'observed_at'});
 const end=rows.at(-1);for(const [id,key]of [['liveConsumption','consumption_mw'],['liveProduction','production_mw'],['liveBalance','balance_mw']])$(id).textContent=fmt(end?.[key]);$('liveTime').textContent=end?time(end.observed_at):'—';
 const age=(Date.now()-last)/60000;$('senOverviewStatus').textContent='Ultimele 24 de ore disponibile · observație: '+new Date(last).toLocaleString('ro-RO',{timeZone:'Europe/Bucharest'})+(age>15?' · observația are peste 15 minute':'')+' · verificare automată la 60 secunde';draw();
 }catch(error){$('senOverviewStatus').textContent='SEN: '+error.message+(rows.length?' · sunt păstrate ultimele date citite':'');}finally{busy=false;}}
export function setupSenOverview(){
 let saved;try{saved=JSON.parse(localStorage.getItem('intelisen-sen-series'))}catch{}
 for(const [key,label,color]of SEN_SERIES){const item=document.createElement('label');item.className='sen-series-pill';const input=document.createElement('input');input.type='checkbox';input.value=key;input.checked=!Array.isArray(saved)||saved.includes(key);const dot=document.createElement('span');dot.className='sen-series-dot';dot.style.backgroundColor=color;const name=document.createElement('span');name.textContent=label;const value=document.createElement('strong');value.id='senValue-'+key;value.textContent='—';item.append(input,dot,name,value);$('senSeries').append(item);input.onchange=()=>{try{localStorage.setItem('intelisen-sen-series',JSON.stringify([...$('senSeries').querySelectorAll('input:checked')].map(el=>el.value)))}catch{}draw();};}
 $('senSelectAll').onclick=()=>{for(const input of $('senSeries').querySelectorAll('input'))input.checked=true;try{localStorage.removeItem('intelisen-sen-series')}catch{}draw();};window.addEventListener('intelisen-theme-change',draw);setInterval(()=>{if(!document.hidden)refresh()},60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()});refresh();
}
