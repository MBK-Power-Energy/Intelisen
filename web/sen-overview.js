import {publicRows} from './api.js';
import {midnight,localParts,addDays} from './time.js';
const $=id=>document.getElementById(id);
export const SEN_SERIES=[
 ['consumption_mw','Consum','#ff5598'],['hourly_average_consumption_mw','Medie orară consum','#1554e8'],['production_mw','Producție','#7636d0'],['coal_mw','Cărbune','#555555'],['hydrocarbons_mw','Hidrocarburi','#e8aa00'],['hydro_mw','Ape','#00a0c6'],['nuclear_mw','Nuclear','#f43c3c'],['wind_mw','Eolian','#179b19'],['solar_mw','Foto','#a60000'],['biomass_mw','Biomasă','#a06a35'],['balance_mw','Sold','#ca4c79']
];
let rows=[],busy=false,hoverBound=false,currentRow=null,visibleRange=null,ranges=new Map();
export function rangeColor(value,min,max){
 if(!Number.isFinite(value)||!Number.isFinite(min)||!Number.isFinite(max))return null;
 const t=max===min?.5:Math.max(0,Math.min(1,(value-min)/(max-min))),palette=[[233,248,245],[0,168,146],[18,48,90]],a=t<=.5?palette[0]:palette[1],b=t<=.5?palette[1]:palette[2],weight=t<=.5?t*2:(t-.5)*2;
 const rgb=a.map((v,i)=>Math.round(v+(b[i]-v)*weight));
 const luminance=rgb.map(v=>{const c=v/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
 return {background:'rgb('+rgb.join(',')+')',foreground:luminance>.179?'#10233f':'#ffffff'};
}
function updateRanges(){
 ranges=new Map(SEN_SERIES.map(([key])=>{let min=Infinity,max=-Infinity;for(const row of rows){const stamp=Date.parse(row.observed_at),value=row[key];if(visibleRange&&(stamp<visibleRange[0]||stamp>visibleRange[1]))continue;if(Number.isFinite(value)){min=Math.min(min,value);max=Math.max(max,value);}}return [key,[min,max]];}));
}
function showValues(row){
 currentRow=row;
 for(const [key,label]of SEN_SERIES){
  const value=$('senValue-'+key),pill=value.closest('label'),limits=ranges.get(key)||[],color=pill.querySelector('input').checked?rangeColor(row?.[key],...limits):null;
  value.textContent=fmt(row?.[key])+' MW';
  if(color){pill.style.backgroundColor=color.background;pill.style.setProperty('border-color',color.background,'important');pill.style.color=color.foreground;value.style.color=color.foreground;pill.title=label+' · min '+fmt(limits[0])+' MW · max '+fmt(limits[1])+' MW';}
  else{pill.style.removeProperty('background-color');pill.style.removeProperty('border-color');pill.style.removeProperty('color');value.style.removeProperty('color');pill.removeAttribute('title');}
 }
 const label=$('senCursorTime');if(label)label.textContent=row?'Ora valorilor: '+dateTime(row.observed_at)+' · ora locală':'Ora valorilor: —';
}
const fmt=v=>Number.isFinite(v)?v.toLocaleString('ro-RO',{maximumFractionDigits:1}):'—';
const dateTime=t=>($('senFrom').value!==$('senTo').value?new Date(t).toLocaleDateString('ro-RO',{timeZone:'Europe/Bucharest',day:'2-digit',month:'2-digit'})+' ':'')+time(t);
const time=t=>new Date(t).toLocaleTimeString('ro-RO',{timeZone:'Europe/Bucharest',hour:'2-digit',minute:'2-digit'});
function draw(){
 const dark=document.documentElement.dataset.theme==='dark',selected=[...document.querySelectorAll('#senSeries input:checked')].map(el=>el.value),end=rows.at(-1);
 const low=midnight($('senFrom').value,'Europe/Bucharest'),high=midnight(addDays($('senTo').value,1),'Europe/Bucharest'),step=Math.max(3,Math.ceil((high-low)/3600000/8/3)*3)*3600000,ticks=[];for(let t=low;t<high;t+=step)ticks.push(new Date(t).toISOString());ticks.push(new Date(high).toISOString());
 const traces=SEN_SERIES.filter(([key])=>selected.includes(key)).map(([key,label,color])=>{const x=[],y=[],customdata=[];let previous;for(const row of rows){if(previous&&Date.parse(row.observed_at)-Date.parse(previous)>30*60000){x.push(new Date((Date.parse(previous)+Date.parse(row.observed_at))/2).toISOString());y.push(null);customdata.push('');}x.push(row.observed_at);y.push(Number.isFinite(row[key])?row[key]:null);customdata.push(dateTime(row.observed_at));previous=row.observed_at;}return {name:label,x,y,customdata,mode:'lines',type:'scatter',line:{color,width:2.5,shape:key==='hourly_average_consumption_mw'?'hv':'linear'},connectgaps:false,hoverinfo:'none'};});
 Plotly.react('senOverviewChart',traces,{height:510,margin:{t:25,r:25,b:65,l:65},paper_bgcolor:dark?'#131f28':'#fff',plot_bgcolor:dark?'#131f28':'#fff',font:{color:dark?'#e9f1f3':'#172033'},showlegend:false,hovermode:'closest',hoverdistance:-1,spikedistance:-1,uirevision:$('senFrom').value+'|'+$('senTo').value,xaxis:{title:{text:'Ora locală'},showspikes:true,spikemode:'across',spikesnap:'cursor',spikecolor:dark?'#91a6b2':'#65758b',spikethickness:1,spikedash:'dash',type:'date',autorange:false,range:[new Date(midnight($('senFrom').value,'Europe/Bucharest')).toISOString(),new Date(midnight(addDays($('senTo').value,1),'Europe/Bucharest')).toISOString()],tickvals:ticks,ticktext:ticks.map((t,i)=>i===ticks.length-1&&$('senFrom').value===$('senTo').value?'24:00':dateTime(t)),gridcolor:dark?'#293842':'#e5e9ef'},yaxis:{title:{text:'MW'},gridcolor:dark?'#293842':'#e5e9ef',zerolinecolor:dark?'#91a6b2':'#8592a3'}},{responsive:true,displaylogo:false});
 const period=$('senFrom').value+'|'+$('senTo').value;if(draw.period!==period){visibleRange=null;draw.period=period;}updateRanges();showValues(end);
 const chart=$('senOverviewChart');
 if(!hoverBound){
  chart.on('plotly_hover',event=>{const point=event.points?.[0],stamp=point?.data?.x?.[point.pointNumber];if(stamp){const row=rows.find(row=>row.observed_at===stamp);if(row)showValues(row);}});
  chart.on('plotly_unhover',()=>showValues(rows.at(-1)));
  chart.on('plotly_relayout',event=>{const range=event['xaxis.range']||(event['xaxis.range[0]']!==undefined?[event['xaxis.range[0]'],event['xaxis.range[1]']]:null);if(!range&&!event['xaxis.autorange'])return;visibleRange=range?range.map(t=>typeof t==='number'?t:Date.parse(t)):null;updateRanges();showValues(currentRow||rows.at(-1));});
  hoverBound=true;
 }
 $('senEmpty').hidden=selected.length>0;
}
async function refresh(){if(busy)return;const from=$('senFrom').value,to=$('senTo').value;if(!from||!to||from<'2026-10-01'||to<from){$('senOverviewStatus').hidden=false;$('senOverviewStatus').textContent='Selectează un interval valid începând cu 1 octombrie 2026.';return;}busy=true;$('senOverviewStatus').hidden=false;$('senOverviewStatus').textContent='Se încarcă datele SEN…';try{
 const data=await publicRows('sen_observations',{observed_at:'gte.'+new Date(midnight(from,'Europe/Bucharest')).toISOString(),and:`(observed_at.lt.${new Date(midnight(addDays(to,1),'Europe/Bucharest')).toISOString()})`,order:'observed_at'});
 if(from!==$('senFrom').value||to!==$('senTo').value)return;rows=data;
 const end=rows.at(-1);for(const [id,key]of [['liveConsumption','consumption_mw'],['liveProduction','production_mw'],['liveBalance','balance_mw']])$(id).textContent=fmt(end?.[key]);$('liveTime').textContent=end?dateTime(end.observed_at):'—';
 $('senOverviewStatus').hidden=Boolean(end);$('senOverviewStatus').textContent=end?'':'Fără observații pentru intervalul selectat.';draw();window.dispatchEvent(new Event('sen-ready'));
 }catch(error){$('senOverviewStatus').hidden=false;$('senOverviewStatus').textContent='SEN: '+error.message+(rows.length?' · sunt păstrate ultimele date citite':'');}finally{busy=false;if(from!==$('senFrom').value||to!==$('senTo').value)refresh();}}
export function setupSenOverview(){
 const cursorTime=document.createElement('p');cursorTime.id='senCursorTime';cursorTime.className='hint';cursorTime.setAttribute('aria-live','off');$('senOverviewChart').before(cursorTime);
 let rangeTimer;const changed=()=>{clearTimeout(rangeTimer);rangeTimer=setTimeout(refresh,200);};
 const today=localParts(Date.now(),'Europe/Bucharest').day;for(const id of ['senFrom','senTo']){$(id).value=today;$(id).max=today;$(id).addEventListener('input',changed);$(id).addEventListener('change',changed);}

 let saved;try{saved=JSON.parse(localStorage.getItem('intelisen-sen-series'))}catch{}
 for(const [key,label,color]of SEN_SERIES){const item=document.createElement('label');item.className='sen-series-pill';const input=document.createElement('input');input.type='checkbox';input.value=key;input.checked=!Array.isArray(saved)||saved.includes(key);const dot=document.createElement('span');dot.className='sen-series-dot';dot.style.backgroundColor=color;const name=document.createElement('span');name.textContent=label;const value=document.createElement('strong');value.id='senValue-'+key;value.textContent='—';item.append(input,dot,name,value);$('senSeries').append(item);input.onchange=()=>{try{localStorage.setItem('intelisen-sen-series',JSON.stringify([...$('senSeries').querySelectorAll('input:checked')].map(el=>el.value)))}catch{}draw();};}
 $('senSelectAll').onclick=()=>{for(const input of $('senSeries').querySelectorAll('input'))input.checked=true;try{localStorage.removeItem('intelisen-sen-series')}catch{}draw();};window.addEventListener('intelisen-theme-change',draw);setInterval(()=>{if(!document.hidden)refresh()},60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()});refresh();
}
