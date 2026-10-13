import {volumeComparison,volumeShares,VOLUME_SERIES} from './volume-data.js?v=20261013-volume-shares';
import {createMarketChart} from './market-chart.js?v=20261012-contract-titles';
import {TradesWorkspace,synchronizeCharts} from './trades-workspace.js?v=20261013-qh-multiple';
import {marketReference,contractReference,emaLine} from './market-reference.js';
import {overview,tradeBars,number,timestamp} from './chart-data.js';
const $=id=>document.getElementById(id),url='https://qumxkyavlavixzaevipw.supabase.co',key='sb_publishable_mL3Wbt0duI8TslUErFWzVg_FOpQxctS';
const client=supabase.createClient(url,key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}}),fmt=v=>number(v)===null?'—':new Intl.NumberFormat('ro-RO',{maximumFractionDigits:3}).format(v),clock=v=>new Date(v).toLocaleString('ro-RO',{timeZone:'Europe/Bucharest',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZoneName:'short'});
let session=null,contracts=[],charts=[],generation=0,busy=false,lastSelection='',lastBars=null,market=null,tradeViews=[];
const tradeCache=new Map();let volumeRows=[];
const workspace=new TradesWorkspace($('tradesWorkspace'),()=>{$('tradeLayout').value=workspace.state.layout;load();},()=>showTradeTable());
$('tradeLayout').value=workspace.state.layout;$('syncCharts').checked=workspace.state.sync;
$('tradeLayout').onchange=()=>workspace.setLayout($('tradeLayout').value);
$('syncCharts').onchange=()=>workspace.setSync($('syncCharts').checked);
let otherPeriod=null;
function selectView(value){const wasVolume=$('view').value==='volumes';if(value==='volumes'&&!wasVolume){otherPeriod={from:$('from').value,to:$('to').value,duration:$('duration').value};$('volumeDay').value=$('from').value;$('volumeSide').value='both';}else if(wasVolume&&value!=='volumes'&&otherPeriod){$('from').value=otherPeriod.from;$('to').value=otherPeriod.to;$('duration').value=otherPeriod.duration;}$('view').value=value;for(const tab of $('viewTabs').querySelectorAll('[role=tab]')){const active=tab.dataset.view===value;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;}load();}
$('viewTabs').addEventListener('click',e=>{const tab=e.target.closest('[role=tab]');if(tab)selectView(tab.dataset.view);});
$('viewTabs').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const tabs=[...$('viewTabs').querySelectorAll('[role=tab]')],current=tabs.indexOf(document.activeElement),index=e.key==='Home'?0:e.key==='End'?tabs.length-1:(current+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;tabs[index].focus();selectView(tabs[index].dataset.view);});
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Bucharest',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());$('from').value=today;$('to').value=today;$('volumeDay').value=today;
const message=t=>$('message').textContent=t;
async function allRows(table,filters){let rows=[];for(let start=0;;start+=1000){let q=client.from(table).select('*').range(start,start+999);q=filters(q);const {data,error}=await q;if(error)throw Error(error.message);rows.push(...data);if(data.length<1000)return rows;if(rows.length>250000)throw Error('Interval prea mare. Selectează mai puține zile.');}}
function clearPrivate(){generation++;contracts=[];volumeRows=[];Plotly.purge($('auctionVolumesChart'));Plotly.purge($('auctionSharesChart'));lastBars=null;tradeViews=[];tradeCache.clear();for(const c of charts)c.remove();charts=[];$('rows').replaceChildren();$('head').replaceChildren();$('status').textContent='';$('cursor').textContent='';for(const pane of workspace.nodes)for(const name of ['chartTitle','cursor','legend'])pane.querySelector('[data-control="'+name+'"]').replaceChildren();$('private').hidden=true;$('login').hidden=false;$('loginShortcut').hidden=!!session;$('logout').hidden=!session;}
async function auth(next){session=next;if(!session){clearPrivate();message('Autentifică-te pentru a vedea datele Nord Pool.');return;}
 const {data,error}=await client.rpc('nordpool_authorized').abortSignal(AbortSignal.timeout(15000));if(error||data!==true){clearPrivate();message('Acest cont nu are acces la Nord Pool.');return;}$('login').hidden=true;$('private').hidden=false;$('loginShortcut').hidden=true;$('logout').hidden=false;await load();}
$('loginForm').onsubmit=async e=>{
 e.preventDefault();const button=e.target.querySelector('button'),feedback=$('loginFeedback');
 const show=(text,state)=>{feedback.hidden=false;feedback.textContent=text;feedback.dataset.state=state;};
 button.disabled=true;show('Se trimite linkul de autentificare…','pending');
 try{const {error}=await client.auth.signInWithOtp({email:$('email').value.trim(),options:{emailRedirectTo:location.origin+location.pathname}});if(error)throw error;show('Cererea a fost trimisă. Verifică ultimul email primit. Dacă acesta conține un cod, introdu-l mai jos pentru autentificare.','success');}
 catch(error){show('Linkul nu a putut fi trimis. '+error.message,'error');}
 finally{button.disabled=false;}
};
$('codeForm').onsubmit=async event=>{
 event.preventDefault();if(!$('email').reportValidity())return;
 const button=event.target.querySelector('button'),feedback=$('codeFeedback');button.disabled=true;feedback.hidden=false;feedback.textContent='Verific codul…';
 try{const {data,error}=await client.auth.verifyOtp({email:$('email').value.trim(),token:$('emailCode').value.trim(),type:'email'});if(error)throw error;history.replaceState(null,'',location.pathname+location.search);$('emailCode').value='';feedback.textContent='Autentificare confirmată.';await auth(data.session);}
 catch{feedback.textContent='Codul este invalid, expirat sau deja folosit. Solicită un cod nou și introdu-l din ultimul email.';}
 finally{button.disabled=false;}
};
$('logout').onclick=async()=>{await client.auth.signOut();session=null;clearPrivate();message('Sesiune închisă.');};
async function load(){if(!session)return;if($('view').value==='volumes'){$('from').value=$('volumeDay').value;$('to').value=$('volumeDay').value;$('duration').value='60';}if(busy){generation++;return;}busy=true;const ticket=++generation;
 try{if($('from').value>$('to').value)throw Error('Data de început trebuie să fie înaintea datei de sfârșit.');
 const all=await allRows('nordpool_contracts',q=>q.eq('area','TEL').gte('delivery_date',$('from').value).lte('delivery_date',$('to').value).order('delivery_start').order('contract_id'));
 if(ticket!==generation)return;contracts=all;
 const {data:runs,error}=await client.from('nordpool_runs').select('*').order('id',{ascending:false}).limit(1);if(error)throw error;
 if(ticket!==generation)return;const run=runs[0];$('status').textContent=run?'Ultima actualizare: '+clock(run.finished_at||run.started_at):'Fără colectări Nord Pool încă.';
 message(run?.finished_at&&Date.now()-Date.parse(run.finished_at)>600000?'Nu există o colectare Nord Pool recentă. Datele afișate pot fi vechi.':run?.status==='error'?'Colectarea Nord Pool a eșuat. Datele anterioare pot fi vechi.':!run?'Colectarea Nord Pool nu este încă activată.':'Colectare cloud la 5 minute · tranzacții publicate cu aproximativ 20 min întârziere.');
 market=await marketReference($('from').value,$('to').value);if(ticket!==generation)return;await render(ticket);
 }catch(e){message('Citirea Nord Pool a eșuat: '+e.message);}finally{busy=false;if(ticket!==generation&&session)load();}}
async function render(ticket){
 const trades=$('view').value==='trades',volumes=$('view').value==='volumes';
 $('volumesSection').hidden=!volumes;$('contractVolumesSection').hidden=true;
 $('from').closest('label').hidden=volumes;$('to').closest('label').hidden=volumes;$('volumeDayLabel').hidden=!volumes;$('volumeSide').closest('label').hidden=volumes;
 $('productLabel').hidden=trades||volumes;$('workspaceControls').hidden=!trades;$('tradesWorkspace').hidden=!trades;$('overviewChartSection').hidden=trades||volumes;
 document.body.classList.toggle('multi-trades',trades&&workspace.state.layout!=='1');
 if(volumes){message('Volume DA/IDA: colectare cloud la 30 minute · ID: colectare la 5 minute. Datele se actualizează automat.');const rows=await allRows('nordpool_auction_volumes',q=>q.eq('area','TEL').gte('delivery_date',$('from').value).lte('delivery_date',$('to').value).order('interval_start').order('market'));if(ticket!==generation||!session)return;disposeCharts();volumeRows=rows;drawVolumeComparison();return;}
 if(trades){await renderTrades(ticket);return;}
 const b=overview(contracts.filter(r=>(timestamp(r.payload.deliveryEnd)-timestamp(r.payload.deliveryStart))/60===Number($('duration').value)));
let data;data={...b,details:b.contracts.map(p=>({contract:p,candles:b.candles.filter(c=>c.time===timestamp(p.deliveryStart)),volumes:b.volumes.filter(c=>c.time===timestamp(p.deliveryStart)),ref:contractReference(market,p)})),lines:{VWAP:b.lines.averagePrice,VWAP3H:b.lines.averagePriceLast3H,VWAP1H:b.lines.averagePriceLast1H,PZU:b.contracts.flatMap(p=>{const r=contractReference(market,p);return r.pzu===null?[{time:timestamp(p.deliveryStart)}]:[{time:timestamp(p.deliveryStart),value:r.pzu}];})}};
 $('tableTitle').textContent='Contracte · OHLC / VWAP';table(['Contract · livrare EET/EEST','Open','High','Low','Close','VWAP','Buy MW','Sell MW','Volum MW'],b.contracts.map(p=>[p.contractName+' · '+clock(p.deliveryStart),...['openPrice','highPrice','lowPrice','closePrice','averagePrice','buyVolume','sellVolume','volume'].map(k=>fmt(p[k]))]));
if(ticket!==generation)return;draw(data);
}
function table(headers,rows){const tr=document.createElement('tr');headers.forEach(x=>{const th=document.createElement('th');th.textContent=x;tr.append(th);});$('head').replaceChildren(tr);$('rows').replaceChildren(...rows.map(values=>{const tr=document.createElement('tr');values.forEach(x=>{const td=document.createElement('td');td.textContent=x;tr.append(td);});return tr;}));}
function disposeCharts(){for(const c of charts)c.remove();charts=[];}
function draw(data){
 const selection=[$('view').value,$('from').value,$('to').value,$('duration').value].join('|');
 const oldRange=selection===lastSelection?charts[0]?.price.timeScale().getVisibleLogicalRange():null;
 disposeCharts();lastSelection=selection;lastBars=data;drawContractVolumes(data);
 charts=[createMarketChart(data,{title:'Overview · TEL · '+$('from').value+' – '+$('to').value+' · '+(data.details?.length||0)+' contracte',oldRange})];
}
function selectedContracts(settings){return contracts.filter(r=>(timestamp(r.payload.deliveryEnd)-timestamp(r.payload.deliveryStart))/60===settings.duration&&(settings.qhContracts||[settings.contract]).includes(Number(r.ph??r.payload.contractName.match(/-(\d+)$/)?.[1])));}
function buildTradeView(chosen,rows,settings){
 const ids=new Set(chosen.map(r=>r.contract_id));rows=rows.filter(r=>ids.has(r.contract_id));
 const groups=chosen.map(r=>({contract:r,b:tradeBars(rows.filter(t=>t.contract_id===r.contract_id),settings.resolution),ref:contractReference(market,r.payload)})).filter(g=>g.b.candles.length);
 const total=tradeBars(rows,settings.resolution),data={candles:groups[0]?.b.candles||[],extraCandles:groups.slice(1).map(g=>({name:g.contract.payload.contractName,points:g.b.candles})),volumes:total.volumes,contractTotals:chosen.map(r=>r.payload),bands:[],details:groups.map(g=>({contract:g.contract.payload,candles:g.b.candles,volumes:g.b.volumes,ref:g.ref})),lines:{}};
 for(const {contract,b,ref}of groups){const suffix=' · '+contract.payload.contractName;data.lines['VWAP'+suffix]=b.vwap;data.lines['EMA '+settings.ema1+suffix]=emaLine(b.candles,settings.ema1);data.lines['EMA '+settings.ema2+suffix]=emaLine(b.candles,settings.ema2);if(ref.pzu!==null)data.lines['PZU'+suffix]=b.candles.map(c=>({time:c.time,value:ref.pzu}));data.bands.push(...ref.ida.map(band=>({...band,name:band.name+suffix,times:b.candles.map(c=>c.time)})));}
 return {data,chosen,total,settings};
}
async function renderTrades(ticket){
 const chosen=workspace.settings.map(selectedContracts),ids=[...new Set(chosen.flat().map(r=>r.contract_id))].sort();
 const cacheKey=ids.join('|');let cached=tradeCache.get(cacheKey),rows=[];
 if(ids.length){if(!cached||Date.now()-cached.at>45000){rows=await allRows('nordpool_trades',q=>q.eq('area','TEL').in('contract_id',ids).order('trade_time').order('trade_id'));if(ticket!==generation||!session)return;cached={at:Date.now(),rows};tradeCache.set(cacheKey,cached);if(tradeCache.size>3)tradeCache.delete(tradeCache.keys().next().value);}else rows=cached.rows;}
 if(ticket!==generation||!session)return;
 const period=$('from').value+'|'+$('to').value;
 const oldRanges=new Map(charts.map(c=>[c.selection,c.price.timeScale().getVisibleLogicalRange()]));
 disposeCharts();tradeViews=chosen.map((list,i)=>buildTradeView(list,rows,workspace.settings[i]));
 tradeViews.forEach((view,i)=>{const {settings,data}=view,root=workspace.nodes[i],prefix={60:'PH',30:'HH',15:'QH'}[settings.duration],label=settings.qhContracts?settings.qhContracts.map(n=>'QH-'+String(n).padStart(2,'0')).join(' / ')||'QH · fără selecție':prefix+'-'+String(settings.contract).padStart(2,'0');
 root.querySelector('[data-control="volumeChart"]').hidden=!settings.showVolume;
 const selection=period+'|'+label+'|'+settings.resolution;
 const runtime=createMarketChart(data,{root,title:label+' · TEL · '+$('from').value+' – '+$('to').value+' · '+data.details.length+' contracte',oldRange:oldRanges.get(selection)||null});runtime.selection=selection;charts.push(runtime);

 });
 synchronizeCharts(charts,()=>workspace.state.sync);
 const totals=[...new Map(chosen.flat().map(r=>[r.contract_id,r.payload])).values()];lastBars={contractTotals:totals};drawContractVolumes(lastBars);showTradeTable();
}
function showTradeTable(){
 if($('view').value!=='trades')return;const view=tradeViews[workspace.state.active];if(!view)return;
 $('tableTitle').textContent='Tranzacții · Grafic '+(workspace.state.active+1)+' · '+{60:'PH',30:'HH',15:'QH'}[view.settings.duration]+'-'+String(view.settings.contract).padStart(2,'0');
 table(['Contract','Ora tranzacției · EET/EEST','Preț EUR/MWh','Volum MW','ID','Revizie'],view.total.trades.map(p=>[view.chosen.find(r=>r.contract_id===p.contractId)?.payload.contractName||p.contractId,clock(p.tradeTime),fmt(p.price),fmt(p.volume),p.tradeId,p.revisionNumber]));
}
for(const id of ['from','to','duration','view','volumeDay'])$(id).onchange=load;
client.auth.onAuthStateChange((event,next)=>{setTimeout(()=>auth(next),0);});
const {data:{session:initial}}=await client.auth.getSession();if(!session)await auth(initial);
setInterval(()=>{if(session&&!document.hidden)load();},60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden&&session)load();});

window.addEventListener('intelisen-theme-change',()=>{if(!session)return;if($('view').value==='volumes')drawVolumeComparison();else if($('view').value==='trades')renderTrades(generation);else if(lastBars)draw(lastBars);});

for(const id of ['showPzu','showIda1','showIda2','showIda3'])$(id).onchange=()=>{if(lastBars)draw(lastBars);};

function drawContractVolumes(data){
 const section=$('contractVolumesSection');section.hidden=$('view').value!=='trades';
 const target=$('contractVolumesChart');target.hidden=!$('showContractVolumes').checked;
 if(section.hidden||target.hidden)return;
 const rows=data.contractTotals||[],labels=rows.map(p=>p.contractName+'<br>'+clock(p.deliveryStart));
 const dark=document.documentElement.dataset.theme==='dark';
 Plotly.react(target,[{type:'bar',name:'Buy',x:labels,y:rows.map(p=>number(p.buyVolume)),marker:{color:'#26a69a'}},{type:'bar',name:'Sell',x:labels,y:rows.map(p=>number(p.sellVolume)),marker:{color:'#ef5350'}}],{height:300,barmode:'group',margin:{l:65,r:20,t:20,b:100},paper_bgcolor:dark?'#131f28':'#fff',plot_bgcolor:dark?'#131f28':'#fff',font:{color:dark?'#e9f1f3':'#172033'},yaxis:{title:{text:'Volum (MW)'},rangemode:'tozero'},xaxis:{title:{text:'Contract · livrare EET/EEST'}},legend:{orientation:'h',y:-.4}}, {responsive:true,displaylogo:false});
}
$('showContractVolumes').onchange=()=>{if(lastBars)drawContractVolumes(lastBars);};

function drawVolumeComparison(){
 if(!session||$('view').value!=='volumes'||!market)return;
 const side=$('volumeSide').value,sides=side==='both'?['buy','sell']:[side],minutes=Number($('duration').value),dark=document.documentElement.dataset.theme==='dark';
 const values=new Map();for(const direction of sides)for(const row of volumeComparison(market,volumeRows,contracts,minutes,direction)){if(!values.has(row.time))values.set(row.time,{time:row.time});values.get(row.time)[direction]=row;}
 const phClock=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Brussels',hour:'2-digit',hourCycle:'h23'}),phLabel=r=>'PH-'+String(Number(phClock.format(new Date(r.time)))+1).padStart(2,'0');
 const rows=[...values.values()].sort((a,b)=>a.time-b.time),colors=['#555555','#4285f4','#9ca3af','#f6a35a','#a879d5','#00a892'],labels=rows.map(r=>clock(r.time));
 Plotly.react($('auctionVolumesChart'),VOLUME_SERIES.flatMap((name,i)=>sides.map(direction=>({type:'bar',name:name+' '+(direction==='buy'?'Buy':'Sell'),legendgroup:name,offsetgroup:direction,x:rows.map(phLabel),y:rows.map(r=>r[direction]?.[name]??null),customdata:labels,marker:{color:colors[i],pattern:{shape:direction==='sell'?'/':'',fillmode:'overlay',bgcolor:colors[i],fgcolor:'#ffffff',fgopacity:0.35,solidity:0.12,size:8}},hovertemplate:'%{customdata}<br>'+name+' '+direction.toUpperCase()+': %{y:.2f} MW<extra></extra>'}))),{height:460,barmode:'stack',bargap:0.2,bargroupgap:0.05,uirevision:[$('from').value,$('to').value,minutes,side].join('|'),margin:{l:70,r:20,t:70,b:70},paper_bgcolor:dark?'#131f28':'#fff',plot_bgcolor:dark?'#131f28':'#fff',font:{color:dark?'#e9f1f3':'#172033'},hovermode:'x unified',yaxis:{title:{text:'MW'},rangemode:'tozero'},xaxis:{type:'category',title:{text:'PH · '+$('volumeDay').value},tickangle:-45},legend:{orientation:'h',y:1.2}},{responsive:true,displaylogo:false});
 Plotly.react($('auctionSharesChart'),VOLUME_SERIES.flatMap((name,i)=>sides.map(direction=>({type:'bar',name:name+' '+(direction==='buy'?'Buy':'Sell'),legendgroup:name,offsetgroup:direction,x:rows.map(phLabel),y:rows.map(r=>volumeShares(r[direction]||{})[name]),customdata:labels,marker:{color:colors[i],pattern:{shape:direction==='sell'?'/':'',fillmode:'overlay',bgcolor:colors[i],fgcolor:'#ffffff',fgopacity:0.35,solidity:0.12,size:8}},hovertemplate:'%{customdata}<br>'+name+' '+direction.toUpperCase()+': %{y:.2f}%<extra></extra>'}))),{height:460,barmode:'stack',bargap:0.2,bargroupgap:0.05,uirevision:[$('from').value,$('to').value,minutes,side].join('|'),margin:{l:70,r:20,t:70,b:70},paper_bgcolor:dark?'#131f28':'#fff',plot_bgcolor:dark?'#131f28':'#fff',font:{color:dark?'#e9f1f3':'#172033'},hovermode:'x unified',yaxis:{title:{text:'Pondere (%)'},range:[0,100],ticksuffix:'%'},xaxis:{type:'category',title:{text:'PH · '+$('volumeDay').value},tickangle:-45},legend:{orientation:'h',y:1.2}},{responsive:true,displaylogo:false});
 $('volumesHint').textContent='Două bare pe PH: Buy și Sell, fiecare stivuită pe surse · Buy: culoare plină · Sell: hașurat · MW.';
 $('tableTitle').textContent='Volume · MW';table(['Interval · EET/EEST',...VOLUME_SERIES.flatMap(name=>sides.map(direction=>name+' '+(direction==='buy'?'Buy':'Sell')))],rows.map(r=>[clock(r.time),...VOLUME_SERIES.flatMap(name=>sides.map(direction=>fmt(r[direction]?.[name])))]));
}
$('volumeSide').onchange=drawVolumeComparison;
