import {readIndicatorCache} from './web/indicator-cache.js';
import {loadDashboard,loadTrades,MARKETS,FUNDAMENTALS} from './web/dashboard-data.js';
import {nordpool} from './web/api.js';
import {localParts,addDays} from './web/time.js';
'use strict';
const $=id=>document.getElementById(id), S={ph:1}, STATUS='ENTSO-E · Statut dezechilibru', COLORS=['#2563eb','#ea580c','#7c3aed','#16a34a','#dc2626','#0891b2','#c026d3'];
const CONFIG={responsive:true,displaylogo:false}, nf=v=>v==null?'':Number(v).toFixed(1), num=v=>v===''||v==null?null:Number(v), dayfmt=d=>d.split('-').reverse().join('.');
function indicatorLabel(k){
 return fullIndicatorLabel(k)
  .replace('ENTSO-E / DAMAS · ','E/D · ').replace('Nord Pool / OPCOM · ','N/O · ')
  .replace('ENTSO-E · ','E · ').replace('DAMAS · ','D · ')
  .replace('OPCOM · ','O · ').replace('Nord Pool · ','N · ').replace('Open-Meteo · ','M · ')
  .replace('Preț dezechilibru','Dezechilibru').replace('Preț ','')
  .replace('day-ahead','DA').replaceAll('intraday','ID')
  .replace('mediu ponderat ID','VWAP ID').replace('comercial total','Total')
  .replace('fizic real','Actual').replace('real','Actual')
  .replace('Putere indisponibilă','Indisponibilități');
}
function fullIndicatorLabel(k){
 const marketLabels={
 'PZU pret':'OPCOM · Preț PZU (EUR/MWh)',
 'PZU volum tranzactionat':'OPCOM · Volum tranzacționat PZU (MWh)',
 'PZU volum buy':'OPCOM · Volum cumpărare PZU (MWh)',
 'PZU volum sell':'OPCOM · Volum vânzare PZU (MWh)',
 'IDA1 pret':'OPCOM · Preț IDA1 (EUR/MWh)',
 'IDA2 pret':'OPCOM · Preț IDA2 (EUR/MWh)',
 'IDA3 pret':'OPCOM · Preț IDA3 (EUR/MWh)',
 'ID O':'Nord Pool · Preț deschidere intraday (EUR/MWh)',
 'ID H':'Nord Pool · Preț maxim intraday (EUR/MWh)',
 'ID L':'Nord Pool · Preț minim intraday (EUR/MWh)',
 'ID C':'Nord Pool · Preț închidere intraday (EUR/MWh)',
 'ID VWAP':'Nord Pool · Preț mediu ponderat intraday (EUR/MWh)',
 'Spread ID VWAP - PZU':'Nord Pool / OPCOM · Diferență intraday VWAP − PZU (EUR/MWh)',
 'ID volum buy':'Nord Pool · Volum cumpărare intraday',
 'ID volum sell':'Nord Pool · Volum vânzare intraday',
 'PZU 15 min (RON/MWh)':'OPCOM · Preț PZU 15 min (RON/MWh)',
 'PZU 30 min (RON/MWh)':'OPCOM · Preț PZU 30 min (RON/MWh)',
 'PZU 60 min (RON/MWh)':'OPCOM · Preț PZU 60 min (RON/MWh)'
 };
 if(marketLabels[k])return marketLabels[k];
 if(!FUNDAMENTALS.includes(k)||k.includes(' · '))return k;
 if(k==='Temperatura')return 'Open-Meteo · Temperatură (°C)';
 if(k==='Indisponibilitati')return 'ENTSO-E · Putere indisponibilă (MW)';
 const text=k.replace('Sarcina reziduala','Sarcină reziduală').replace('Eroare','Eroare').replace('Actual','real').replace('DA','day-ahead').replace('ID','intraday');
 if(/^(Import|Export)/.test(k))return 'ENTSO-E / DAMAS · '+text.replace('Total','comercial total').replace('real','fizic real')+' (MW)';
 return 'ENTSO-E · '+text+' (MW)';
}
function selected(id){return [...$(id).selectedOptions].map(o=>o.value);}
function indicators(){return [...selected('markets'),...selected('sen')];}
function dates(){return [...$('dayOptions').querySelectorAll('input:checked')].map(input=>input.value).sort();}
function prior(d){let t=new Date(d+'T12:00:00Z');t.setUTCDate(t.getUTCDate()-1);if($('baseline').value==='work')while([0,6].includes(t.getUTCDay()))t.setUTCDate(t.getUTCDate()-1);return t.toISOString().slice(0,10);}
function level(d,ph,k){return S.levels.get(d+'|'+ph)?.[k]??null;}
function value(d,ph,k){const cur=level(d,ph,k),old=level(prior(d),ph,k);if(k===STATUS||$('mode').value==='value')return cur;if(cur==null||old==null)return null;return $('mode').value==='delta'?cur-old:old===0?null:100*(cur-old)/Math.abs(old);}
function missingReason(d,k){if(k.startsWith('ID ')||k==='Spread ID VWAP - PZU'){if(!S.npAccess)return 'Login';}if(level(d,S.ph,k)==null)return 'Lipsă';if($('mode').value!=='value'&&level(prior(d),S.ph,k)==null)return 'Fără reper';if($('mode').value==='pct'&&level(prior(d),S.ph,k)===0)return 'Bază 0';return '—';}
function status(v){return v==null?'':v>0?'Deficit':v<0?'Excedent':'Echilibrat';}
function fillSelect(id,keys,defaults){$(id).replaceChildren(...keys.map(k=>{let o=document.createElement('option');o.textContent=indicatorLabel(k);o.value=k;o.selected=defaults.includes(k);return o;}));}
function layout(title,height=480){return {title:{text:title,x:0,xanchor:'left',y:.98,font:{size:18}},height,margin:{t:70,b:125,l:105,r:105},paper_bgcolor:document.documentElement.dataset.theme==='dark'?'#131f28':'#fff',plot_bgcolor:document.documentElement.dataset.theme==='dark'?'#131f28':'#fff',font:{family:'system-ui',color:document.documentElement.dataset.theme==='dark'?'#e9f1f3':'#172033'},legend:{orientation:'h',y:-.22,yanchor:'top',x:0,xanchor:'left',font:{size:12}},autosize:true,hovermode:'x unified'};}
function render(){if(!S.data)return;const ds=dates(),ks=indicators();$('interactive').hidden=!$('plot').checked;$('manual-label').hidden=$('axis').value!=='Doua axe (manual)';if(!ds.length||!ks.length){$('loading').textContent='Selecteaza o perioada valida si cel putin un indicator.';return;}$('loading').textContent='';
 const z=ds.map(d=>ks.map(k=>k===STATUS?null:value(d,S.ph,k))),text=ds.map(d=>ks.map(k=>k===STATUS?'':nf(value(d,S.ph,k)))),hover=ds.map(d=>ks.map(k=>`${dayfmt(d)} · ${indicatorLabel(k)}<br>Anterior: ${nf(level(prior(d),S.ph,k))}<br>Curent: ${nf(level(d,S.ph,k))}`));
 const groups=[['Piețe',selected('markets')],['SEN',selected('sen')]].map(([name,keys])=>({name,indices:keys.filter(k=>k!==STATUS).map(k=>ks.indexOf(k))})).filter(g=>g.indices.length);
 const relative=true;
 const ranges=ks.map((_,i)=>{const values=z.map(row=>row[i]).filter(Number.isFinite);return values.length?[Math.min(...values),Math.max(...values)]:[0,0];});
 const colorValue=(v,i)=>v==null?null:relative?(ranges[i][1]===ranges[i][0]?.5:(v-ranges[i][0])/(ranges[i][1]-ranges[i][0])):v;
 const tr=groups.map((g,index)=>({type:'heatmap',name:g.name,x:g.indices,y:ds.map(dayfmt),z:z.map(row=>g.indices.map(i=>colorValue(row[i],i))),text:text.map(row=>g.indices.map(i=>row[i])),texttemplate:'%{text}',customdata:hover.map((row,r)=>g.indices.map(i=>row[i]+'<br>Afisat: '+text[r][i])),hovertemplate:'%{customdata}<extra></extra>',colorscale:relative?[[0,'#e9f8f5'],[.5,'#00a892'],[1,'#12305a']]:'RdBu',reversescale:!relative,zmin:relative?0:undefined,zmax:relative?1:undefined,zmid:relative?undefined:0,showscale:!relative||index===0,colorbar:{title:{text:relative?'Min–Max':g.name+'<br>'+($('mode').value==='pct'?'%':'Valoare')},tickvals:relative?[0,.5,1]:undefined,ticktext:relative?['Minim','Mediu','Maxim']:undefined,x:1.03,y:relative||groups.length===1?.5:index===0?.76:.24,len:relative||groups.length===1?1:.44,thickness:18}}));
 $('heatmapScaleNote').textContent='Culorile arată poziția între minimul și maximul fiecărui indicator în perioada selectată. Cifrele reprezintă '+($('mode').value==='value'?'valorile reale.':'variația calculată.');$('limit').closest('label').hidden=true;
 const missing=ds.flatMap(d=>ks.map((k,i)=>({d,k,i})).filter(({k})=>k!==STATUS&&value(d,S.ph,k)==null));if(missing.length)tr.push({type:'scatter',mode:'text',x:missing.map(m=>m.i),y:missing.map(m=>dayfmt(m.d)),text:missing.map(m=>missingReason(m.d,m.k)),textfont:{size:11,color:document.documentElement.dataset.theme==='dark'?'#91a6b2':'#58677b'},hoverinfo:'skip',showlegend:false});if(ks.includes(STATUS)){tr.push({type:'heatmap',x:[ks.indexOf(STATUS)],y:ds.map(dayfmt),z:ds.map(d=>[level(d,S.ph,STATUS)]),text:ds.map(d=>[status(level(d,S.ph,STATUS))]),texttemplate:'%{text}',hovertemplate:'%{y}<br>%{text}<extra></extra>',zmin:-1,zmax:1,colorscale:[[0,'#81c784'],[.5,'#eee'],[1,'#ef9a9a']],showscale:false});}
 const l=layout(`PH-${String(S.ph).padStart(2,'0')} · ${$('mode').selectedOptions[0].text}`,Math.max(410,ds.length*48+190));l.margin={t:190,b:35,l:125,r:120};l.xaxis={automargin:true,tickangle:-35,side:'top',tickmode:'array',tickvals:ks.map((_,i)=>i),ticktext:ks.map(indicatorLabel),range:[-.5,ks.length-.5]};l.yaxis={autorange:'reversed',automargin:true};Plotly.react('heatmap',tr,l,CONFIG);
 $('table').innerHTML='<table><thead><tr><th>Data</th>'+ks.map(k=>'<th>'+indicatorLabel(k)+'</th>').join('')+'</tr></thead><tbody>'+ds.map(d=>'<tr><td>'+dayfmt(d)+'</td>'+ks.map(k=>'<td>'+(k===STATUS?status(value(d,S.ph,k)):nf(value(d,S.ph,k)))+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
 const numeric=ks.filter(k=>k!==STATUS),saved=selected('right');fillSelect('right',numeric,saved);if($('plot').checked)renderSeries(ds,numeric);renderTrades(ds);
}
function renderSeries(ds,ks){let right=new Set(selected('right'));if($('axis').value==='O singura axa')right.clear();if($('axis').value==='Automat'){right.clear();const scales=ks.map(k=>{let a=ds.map(d=>Math.abs(value(d,S.ph,k))).filter(v=>v>0).sort((a,b)=>a-b);return [a.length?a[Math.floor((a.length-1)*.9)]:0,k];}).filter(x=>x[0]>0).sort((a,b)=>a[0]-b[0]);let ratio=0,idx=0;for(let i=0;i<scales.length-1;i++)if(scales[i+1][0]/scales[i][0]>ratio){ratio=scales[i+1][0]/scales[i][0];idx=i;}if(ratio>=10)right=new Set(scales.slice(idx+1).map(x=>x[1]));}
 const kind=$('kind').value,tr=ks.map((k,i)=>({x:ds,y:ds.map(d=>value(d,S.ph,k)),name:indicatorLabel(k),yaxis:right.has(k)?'y2':'y',type:kind.startsWith('Bare')?'bar':'scatter',mode:kind==='Puncte'?'markers':kind==='Linie si puncte'?'lines+markers':'lines',marker:{color:COLORS[i%COLORS.length]},line:{color:COLORS[i%COLORS.length]},connectgaps:false})),l=layout('Indicatori selectati · PH-'+S.ph,540);l.barmode=kind==='Bare suprapuse'?'relative':'group';l.xaxis={type:'date',rangeslider:{visible:true},tickformat:'%d.%m'};l.yaxis={automargin:true,title:{text:$('mode').value==='pct'?'Modificare (%)':$('mode').value==='delta'?'Diferenta absoluta':'Valoare · axa stanga',standoff:18}};l.yaxis2={automargin:true,title:{text:$('mode').value==='pct'?'Modificare (%)':'Valoare · axa dreapta',standoff:18},overlaying:'y',side:'right',showgrid:false,visible:right.size>0};Plotly.react('timeseries',tr,l,CONFIG);}
function bounds(d,ph,a){const q=S.ida.filter(r=>r.delivery_date===d&&r.auction===a&&Math.ceil(Number(r.interval)/4)===ph).map(r=>num(r.price_eur_per_MWh)).filter(v=>v!=null);return q.length===4?[Math.min(...q),Math.max(...q)]:null;}
function ema(values,n){if(!values.length)return [];let v=values[0];return values.map((x,i)=>v=i?2/(n+1)*x+(1-2/(n+1))*v:x);}
function aggregate(trades,minutes){const map=new Map();for(const r of [...trades].sort((a,b)=>Date.parse(a.tradeTime)-Date.parse(b.tradeTime))){const time=Math.floor(Date.parse(r.tradeTime)/(minutes*60000))*minutes*60000,p=Number(r.price);if(!map.has(time))map.set(time,{time,o:p,h:p,l:p,c:p,v:0});let b=map.get(time);b.h=Math.max(b.h,p);b.l=Math.min(b.l,p);b.c=p;b.v+=Number(r.volume);}return [...map.values()].sort((a,b)=>a.time-b.time);}
function marketLabel(time){return new Intl.DateTimeFormat('ro-RO',{timeZone:'Europe/Brussels',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(time));}
function atr(bars,n){const out=bars.map(()=>null),tr=bars.map((b,i)=>i?Math.max(b.h-b.l,Math.abs(b.h-bars[i-1].c),Math.abs(b.l-bars[i-1].c)):b.h-b.l);if(bars.length>=n){out[n-1]=tr.slice(0,n).reduce((a,b)=>a+b,0)/n;for(let i=n;i<bars.length;i++)out[i]=((n-1)*out[i-1]+tr[i])/n;}return out;}
function renderTrades(ds){const summaryMode=$('scope').value==='PH sumar';const priceValues=[];for(const day of ds){for(const c of S.contracts.filter(c=>c.zi===day&&(summaryMode||Number(c.ph)===S.ph)))priceValues.push(num(c.lowPrice),num(c.highPrice));for(const ph of (summaryMode?Array.from({length:24},(_,i)=>i+1):[S.ph])){if($('pzu').checked)priceValues.push(level(day,ph,'PZU pret'));for(const a of ['IDA1','IDA2','IDA3'])if($(a.toLowerCase()).checked)priceValues.push(...(bounds(day,ph,a)||[]));}}const validPrices=priceValues.filter(v=>v!=null&&Number.isFinite(v));const sharedPriceRange=validPrices.length?(()=>{const lo=Math.min(...validPrices),hi=Math.max(...validPrices),pad=Math.max(5,(hi-lo)*.07);return [lo-pad,hi+pad];})():undefined;$('resolution-label').hidden=$('scope').value==='PH sumar';$('tradecharts').replaceChildren();if(!$('showtrades').checked)return;for(const d of ds){const container=document.createElement('div');container.className='chart';$('tradecharts').append(container);const summary=$('scope').value==='PH sumar',cs=S.contracts.filter(c=>c.zi===d&&(summary||Number(c.ph)===S.ph)).sort((a,b)=>a.ph-b.ph);let bars=[],labels=[],ph=[];
 if(summary){bars=cs.filter(c=>num(c.openPrice)!=null).map(c=>({time:Number(c.ph),o:Number(c.openPrice),h:Number(c.highPrice),l:Number(c.lowPrice),c:Number(c.closePrice),v:Number(c.volume)}));labels=bars.map(b=>'PH-'+String(b.time).padStart(2,'0'));ph=bars.map(b=>b.time);}else{const ids=new Set(cs.map(c=>c.contractId));bars=aggregate(S.trades.filter(t=>ids.has(t.contractId)),Number($('resolution').value));labels=bars.map(b=>marketLabel(b.time));ph=bars.map(()=>S.ph);}if(!bars.length){container.textContent=dayfmt(d)+' · Fara tranzactii';continue;}
 const x=bars.map((_,i)=>i),tr=[{x,name:'ID',type:$('trade-kind').value==='Lumanari'?'candlestick':'scatter',open:bars.map(b=>b.o),high:bars.map(b=>b.h),low:bars.map(b=>b.l),close:bars.map(b=>b.c),y:bars.map(b=>b.c),mode:'lines',increasing:{line:{color:'#26a69a'}},decreasing:{line:{color:'#ef5350'}},showlegend:true,customdata:labels,hovertext:labels},{x,y:bars.map(b=>b.v),type:'bar',name:'Volum ID (MW)',yaxis:'y2',marker:{color:bars.map(b=>b.c>=b.o?'#a5d6c7':'#f6b0ad')},showlegend:false}];
 if($('pzu').checked)tr.push({x,y:ph.map(p=>level(d,p,'PZU pret')),name:'PZU',type:'scatter',mode:'lines',line:{color:'#2962ff',dash:'dash',shape:'hv'},connectgaps:false});
 for(const [a,color,fill] of [['IDA1','#bdbdbd','rgba(189,189,189,.15)'],['IDA2','#f5a623','rgba(245,166,35,.15)'],['IDA3','#9b72cf','rgba(155,114,207,.15)']]){if(!$(a.toLowerCase()).checked)continue;const range=ph.map(p=>bounds(d,p,a));tr.push({x,y:range.map(b=>b?.[0]??null),name:a+' min',type:'scatter',mode:'lines',line:{color,shape:'hv',width:1},showlegend:false,connectgaps:false});tr.push({x,y:range.map(b=>b?.[1]??null),name:a+' min–max',type:'scatter',mode:'lines',line:{color,shape:'hv',width:1},fill:'tonexty',fillcolor:fill,connectgaps:false});}
 if(!summary&&$('ema').checked)for(const [n,color] of [[Number($('fast').value),'#2962ff'],[Number($('slow').value),'#ef5350']])tr.push({x,y:ema(bars.map(b=>b.c),Math.max(1,n)),name:'EMA '+n,type:'scatter',mode:'lines',line:{color,width:1}});
 const l=layout(dayfmt(d)+' · '+(summary?'PH sumar':`PH-${String(S.ph).padStart(2,'0')} trades`),630);l.xaxis={automargin:true,tickangle:-25,tickvals:x.filter((_,i)=>i%Math.max(1,Math.ceil(x.length/10))===0),ticktext:labels.filter((_,i)=>i%Math.max(1,Math.ceil(x.length/10))===0),rangeslider:{visible:false},title:{text:summary?'PH de livrare CET/CEST':'Moment tranzactie CET/CEST'}};l.hovermode='closest';l.hoverlabel={namelength:-1,font:{size:12}};l.yaxis={range:sharedPriceRange,domain:[.30,1],automargin:true,title:{text:'EUR/MWh',standoff:18}};l.yaxis2={domain:[0,.19],automargin:true,title:{text:'Volum MW',standoff:18}};Plotly.newPlot(container,tr,l,CONFIG);
 const volumeChart=document.createElement('div');volumeChart.className='chart';$('tradecharts').append(volumeChart);const vl=layout('Volume intraday · '+dayfmt(d),320);vl.margin={t:65,b:90,l:105,r:40};vl.xaxis={tickvals:l.xaxis.tickvals,ticktext:l.xaxis.ticktext,automargin:true,tickangle:-25};vl.yaxis={title:{text:'Volum (MW)',standoff:18},automargin:true,rangemode:'tozero'};vl.showlegend=false;Plotly.newPlot(volumeChart,[{x,y:bars.map(b=>b.v),type:'bar',name:'Volum tranzactionat',marker:{color:bars.map(b=>b.c>=b.o?'#26a69a':'#ef5350')},customdata:labels,hovertemplate:'%{customdata}<br>Volum: %{y:.2f} MW<extra></extra>'}],vl,CONFIG);
 const totals=document.createElement('div');totals.className='chart';$('tradecharts').append(totals);const tl=layout('Volume Buy / Sell · '+dayfmt(d),300);tl.barmode='group';tl.margin={t:65,b:100,l:105,r:40};tl.yaxis={title:{text:'Volum Nord Pool',standoff:18},automargin:true,rangemode:'tozero'};tl.xaxis={title:{text:'PH de livrare CET/CEST'},automargin:true};Plotly.newPlot(totals,[['buyVolume','Buy','#26a69a'],['sellVolume','Sell','#ef5350']].map(([field,name,color])=>({x:cs.map(c=>'PH-'+String(c.ph).padStart(2,'0')),y:cs.map(c=>num(c[field])),name,type:'bar',marker:{color}})),tl,CONFIG);
 if(!summary&&$('atr').checked){const el=document.createElement('div');$('tradecharts').append(el);Plotly.newPlot(el,[{x,y:atr(bars,Math.max(2,Number($('atrperiod').value))),name:'ATR Wilder',type:'scatter',mode:'lines',connectgaps:false}],{...layout('ATR · '+dayfmt(d),250),xaxis:l.xaxis,yaxis:{title:{text:'EUR/MWh'}}},CONFIG);}}
}
function download(name,text,type){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function csvCell(v){return '"'+String(v??'').replaceAll('"','""')+'"';}
function exportCsv(){const rows=[['Data','PH','Indicator','Anterior','Curent','Afisat','Mod','Reper']];for(const d of dates())for(let ph=1;ph<=24;ph++)for(const k of indicators())rows.push([d,ph,k,level(prior(d),ph,k),level(d,ph,k),value(d,ph,k),$('mode').value,$('baseline').value]);download('intelisen_'+$('from').value+'_'+$('to').value+'.csv','\ufeff'+rows.map(r=>r.map(csvCell).join(',')).join('\n'),'text/csv');}
async function exportHtml(){let plotly=document.getElementById('plotly-bundle')?.textContent;if(!plotly){const response=await fetch('vendor/plotly.min.js');if(!response.ok)throw Error('Nu pot incarca biblioteca pentru export');plotly=await response.text();}const charts=[...document.querySelectorAll('.js-plotly-plot')].filter(el=>!el.closest('[hidden]'));let body='<h1>Intelisen · Dashboard</h1><p>PH '+S.ph+' · '+$('mode').selectedOptions[0].text+' · CET/CEST</p>';charts.forEach((c,i)=>{body+=`<div id="export${i}"></div><script>Plotly.newPlot('export${i}',${JSON.stringify(c.data).replaceAll('<','\\u003c')},${JSON.stringify(c.layout).replaceAll('<','\\u003c')},{responsive:true});<\/script>`;});download('intelisen_dashboard.html','<!doctype html><html><head><meta charset="utf-8"><title>Intelisen</title><script>'+plotly.replaceAll('</script>','<\\/script>')+'<\/script></head><body>'+body+'</body></html>','text/html');}
let loading=false,pending=false,tradeSelection='';
function clearPrivate(){S.contracts=[];S.trades=[];S.npAccess=false;tradeSelection='';for(const row of S.levels?.values()||[])for(const key of ['ID O','ID H','ID L','ID C','ID VWAP','Spread ID VWAP - PZU','ID volum buy','ID volum sell'])row[key]=null;}
function applyDashboard(dashboard,from,to){
 S.data=dashboard;S.levels=new Map(dashboard.levels.map(r=>[r.Data+'|'+r.PH,r]));S.dates=[...new Set(dashboard.levels.map(r=>r.Data))];S.contracts=dashboard.contracts;S.ida=dashboard.ida;S.npAccess=dashboard.npAccess;
 S.snapshot={created_at_utc:dashboard.collectedAt,period_start:from,period_end:to};
}
let customDays=false,dayPickerToday='';
function updateRollingPeriod(){
 const today=localParts(Date.now(),'Europe/Bucharest').day;
 if(dayPickerToday!==today){
  const chosen=new Set(customDays?dates():Array.from({length:7},(_,i)=>addDays(today,i-5)));
  const labels=[];
  for(let day='2026-10-01';day<=addDays(today,1);day=addDays(day,1)){
   const label=document.createElement('label'),input=document.createElement('input');
   input.type='checkbox';input.value=day;input.checked=chosen.has(day);label.style.cssText='display:flex;flex-direction:row;align-items:center;gap:8px';label.append(input,document.createTextNode(dayfmt(day)));labels.push(label);
  }
  $('dayOptions').replaceChildren(...labels);dayPickerToday=today;
 }
 const days=dates();$('from').value=days[0]||today;$('to').value=days.at(-1)||today;
 $('daySummary').textContent='Zile afișate · '+days.length;
}
async function refreshOnline(){
 updateRollingPeriod();
 if(!dates().length){$('loading').textContent='Selectează cel puțin o zi.';return;}
 if(loading){pending=true;return;}loading=true;
 try{
  const from=$('from').value,to=$('to').value;
  const low=[addDays(from,-7),'2026-10-01'].sort().at(-1);
  if(!S.data||S.snapshot?.period_start!==from||S.snapshot?.period_end!==to){const cached=readIndicatorCache(low,to);if(cached){applyDashboard(cached,from,to);render();$('loading').textContent='Date salvate · '+new Date(cached.collectedAt).toLocaleString('ro-RO')+' · se actualizează…';}}
  const dashboard=await loadDashboard(low,to);
  if(from!==$('from').value||to!==$('to').value){pending=true;return;}
  applyDashboard(dashboard,from,to);
  $('loginHint').textContent=dashboard.npAccess?'Nord Pool: acces autorizat · tranzacțiile au aproximativ 20 min întârziere la publicare.':'Autentifică-te cu Login pentru indicatorii și graficele Nord Pool.';
  $('loading').className='';$('loading').textContent='';await refreshSelectedTrades();render();
 }catch(error){$('loading').className='error';$('loading').textContent='Citirea online a eșuat: '+error.message+'. Ultimele date valide sunt păstrate.';}
 finally{loading=false;if(pending){pending=false;refreshOnline();}}
}
async function refreshSelectedTrades(){
 if(!S.npAccess||!$('showtrades').checked||$('scope').value==='PH sumar'){S.trades=[];return;}
 const selection=dates().join(',')+'|'+S.ph,ticket=selection;tradeSelection=ticket;
 try{const trades=await loadTrades(S.contracts,dates(),S.ph);if(ticket===tradeSelection&&S.npAccess)S.trades=trades;}
 catch(error){$('loginHint').textContent='Tranzacțiile nu au putut fi actualizate: '+error.message;}
}
async function init(){
 updateRollingPeriod();
 $('dayOptions').addEventListener('change',()=>{customDays=true;updateRollingPeriod();render();refreshOnline();});
 fillSelect('markets',MARKETS,['PZU pret']);fillSelect('sen',FUNDAMENTALS,['Temperatura','Consum DA','Solar DA','Eolian DA','Import DA','Export DA']);
 $('mode').value='value';$('baseline').value='calendar';
 S.trades=[];S.contracts=[];S.ida=[];
 for(let ph=1;ph<=24;ph++){const b=document.createElement('button');b.textContent='PH-'+String(ph).padStart(2,'0');b.classList.toggle('active',ph===1);b.onclick=async()=>{S.ph=ph;[...$('tabs').children].forEach(x=>x.classList.toggle('active',x===b));S.trades=[];render();await refreshSelectedTrades();render();};$('tabs').append(b);}
 document.querySelectorAll('input,select').forEach(e=>{if(!['from','to'].includes(e.id)&&!e.closest('#dayOptions'))e.addEventListener('change',async()=>{render();if(['showtrades','scope'].includes(e.id)){await refreshSelectedTrades();render();}})});
 $('csv').onclick=exportCsv;$('html').onclick=()=>exportHtml().catch(error=>alert(error.message));
 window.addEventListener('intelisen-theme-change',render);
 nordpool.auth.onAuthStateChange((event,session)=>{if(!session){clearPrivate();render();}else setTimeout(refreshOnline,0);});
 await refreshOnline();
}
init().catch(error=>{$('loading').textContent=error.message;});
setInterval(()=>{if(!document.hidden)refreshOnline()},60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshOnline()});
