import {marketReference,contractReference,emaLine} from './market-reference.js';
import {overview,tradeBars,number,timestamp} from './chart-data.js';
const $=id=>document.getElementById(id),url='https://qumxkyavlavixzaevipw.supabase.co',key='sb_publishable_mL3Wbt0duI8TslUErFWzVg_FOpQxctS';
const client=supabase.createClient(url,key),fmt=v=>number(v)===null?'—':new Intl.NumberFormat('ro-RO',{maximumFractionDigits:3}).format(v),clock=v=>new Date(v).toLocaleString('ro-RO',{timeZone:'Europe/Bucharest',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZoneName:'short'});
let session=null,contracts=[],charts=[],generation=0,busy=false,lastSelection='',lastBars=null,market=null;
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Bucharest',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());$('from').value=today;$('to').value=today;
const message=t=>$('message').textContent=t;
async function allRows(table,filters){let rows=[];for(let start=0;;start+=1000){let q=client.from(table).select('*').range(start,start+999);q=filters(q);const {data,error}=await q;if(error)throw Error(error.message);rows.push(...data);if(data.length<1000)return rows;if(rows.length>250000)throw Error('Interval prea mare. Selectează mai puține zile.');}}
function clearPrivate(){generation++;contracts=[];lastBars=null;for(const c of charts)c.remove();charts=[];$('rows').replaceChildren();$('head').replaceChildren();$('status').textContent='';$('cursor').textContent='';$('contract').replaceChildren();$('private').hidden=true;$('login').hidden=false;$('loginShortcut').hidden=!!session;$('logout').hidden=!session;}
async function auth(next){session=next;if(!session){clearPrivate();message('Autentifică-te pentru a vedea datele Nord Pool.');return;}
 const {data,error}=await client.rpc('nordpool_authorized');if(error||data!==true){clearPrivate();message('Acest cont nu are acces la Nord Pool.');return;}$('login').hidden=true;$('private').hidden=false;$('loginShortcut').hidden=true;$('logout').hidden=false;await load();}
$('loginForm').onsubmit=async e=>{
 e.preventDefault();const button=e.target.querySelector('button'),feedback=$('loginFeedback');
 const show=(text,state)=>{feedback.hidden=false;feedback.textContent=text;feedback.dataset.state=state;};
 button.disabled=true;show('Se trimite linkul de autentificare…','pending');
 try{const {error}=await client.auth.signInWithOtp({email:$('email').value.trim(),options:{emailRedirectTo:location.origin+location.pathname}});if(error)throw error;show('Cererea a fost trimisă. Dacă adresa este autorizată, vei primi un link de autentificare. Verifică Inbox și Spam și deschide linkul în același browser.','success');}
 catch(error){show('Linkul nu a putut fi trimis. '+error.message,'error');}
 finally{button.disabled=false;}
};
$('logout').onclick=async()=>{await client.auth.signOut();session=null;clearPrivate();message('Sesiune închisă.');};
async function load(){if(!session)return;if(busy){generation++;return;}busy=true;const ticket=++generation;const selected=$('contract').value;
 try{if($('from').value>$('to').value)throw Error('Data de început trebuie să fie înaintea datei de sfârșit.');
 const all=await allRows('nordpool_contracts',q=>q.eq('area','TEL').gte('delivery_date',$('from').value).lte('delivery_date',$('to').value).order('delivery_start').order('contract_id'));
 if(ticket!==generation)return;contracts=all.filter(r=>(timestamp(r.payload.deliveryEnd)-timestamp(r.payload.deliveryStart))/60===Number($('duration').value));
 const prefix=Number($('duration').value)===60?'PH':Number($('duration').value)===30?'HH':'QH',count=1440/Number($('duration').value);
 $('contract').replaceChildren(...Array.from({length:count},(_,i)=>{const o=document.createElement('option');o.value=String(i+1);o.textContent=prefix+'-'+String(i+1).padStart(2,'0');return o;}));if(Number(selected)>=1&&Number(selected)<=count)$('contract').value=selected;

 const {data:runs,error}=await client.from('nordpool_runs').select('*').order('id',{ascending:false}).limit(1);if(error)throw error;
 if(ticket!==generation)return;const run=runs[0];$('status').textContent=run?'Ultima colectare: '+clock(run.finished_at||run.started_at)+' · '+run.status+' · '+contracts.length+' contracte':'Fără colectări Nord Pool încă.';
 message(run?.finished_at&&Date.now()-Date.parse(run.finished_at)>600000?'Nu există o colectare Nord Pool recentă. Datele afișate pot fi vechi.':run?.status==='error'?'Colectarea Nord Pool a eșuat. Datele anterioare pot fi vechi.':!run?'Colectarea Nord Pool nu este încă activată.':'Colectare cloud la 5 minute · tranzacții publicate cu aproximativ 20 min întârziere · statistici la 15 min.');
 market=await marketReference($('from').value,$('to').value);if(ticket!==generation)return;await render(ticket);
 }catch(e){message('Citirea Nord Pool a eșuat: '+e.message);}finally{busy=false;if(ticket!==generation&&session)load();}}
async function render(ticket){const trades=$('view').value==='trades';$('contractLabel').hidden=!trades;$('resolutionLabel').hidden=!trades;$('emaControls').hidden=!trades;let data;
 if(trades){const id=$('contract').value;if(!id){draw({candles:[],volumes:[],lines:{}});table([],[]);return;}
 const chosen=contracts.filter(r=>Number(r.ph??r.payload.contractName.match(/-(\d+)$/)?.[1])===Number(id));
 const ids=chosen.map(r=>r.contract_id);if(!ids.length){draw({candles:[],volumes:[],lines:{}});table([],[]);return;}
 const rows=await allRows('nordpool_trades',q=>q.eq('area','TEL').in('contract_id',ids).order('trade_time').order('trade_id'));
 if(ticket!==generation||!session)return;
 const p1=Math.max(1,Math.min(500,Math.round(Number($('ema1').value)||13))),p2=Math.max(1,Math.min(500,Math.round(Number($('ema2').value)||26)));$('ema1').value=p1;$('ema2').value=p2;
 const groups=chosen.map(r=>({contract:r,b:tradeBars(rows.filter(t=>t.contract_id===r.contract_id),Number($('resolution').value)),ref:contractReference(market,r.payload)})).filter(g=>g.b.candles.length);
 const total=tradeBars(rows,Number($('resolution').value));data={candles:groups[0]?.b.candles||[],extraCandles:groups.slice(1).map(g=>({name:g.contract.payload.contractName,points:g.b.candles})),volumes:total.volumes,contractTotals:chosen.map(r=>r.payload),bands:[],details:groups.map(g=>({contract:g.contract.payload,candles:g.b.candles,volumes:g.b.volumes,ref:g.ref})),lines:{}};
 for(const {contract,b,ref} of groups){const suffix=' · '+contract.payload.contractName;data.lines['VWAP'+suffix]=b.vwap;data.lines['EMA '+p1+suffix]=emaLine(b.candles,p1);data.lines['EMA '+p2+suffix]=emaLine(b.candles,p2);if(ref.pzu!==null)data.lines['PZU'+suffix]=b.candles.map(c=>({time:c.time,value:ref.pzu}));data.bands.push(...ref.ida.map(band=>({...band,name:band.name+suffix,times:b.candles.map(c=>c.time)})));}
 $('tableTitle').textContent='Tranzacții · '+$('contract').selectedOptions[0]?.textContent+' · '+chosen.length+' contracte';table(['Contract','Ora tranzacției · EET/EEST','Preț EUR/MWh','Volum MW','ID','Revizie'],total.trades.map(p=>[chosen.find(r=>r.contract_id===p.contractId)?.payload.contractName||p.contractId,clock(p.tradeTime),fmt(p.price),fmt(p.volume),p.tradeId,p.revisionNumber]));

 }else{const b=overview(contracts);data={...b,details:b.contracts.map(p=>({contract:p,candles:b.candles.filter(c=>c.time===timestamp(p.deliveryStart)),volumes:b.volumes.filter(c=>c.time===timestamp(p.deliveryStart)),ref:contractReference(market,p)})),lines:{VWAP:b.lines.averagePrice,VWAP3H:b.lines.averagePriceLast3H,VWAP1H:b.lines.averagePriceLast1H,PZU:b.contracts.flatMap(p=>{const r=contractReference(market,p);return r.pzu===null?[{time:timestamp(p.deliveryStart)}]:[{time:timestamp(p.deliveryStart),value:r.pzu}];})}};
 $('tableTitle').textContent='Contracte · OHLC / VWAP';table(['Contract · livrare EET/EEST','Open','High','Low','Close','VWAP','Buy MW','Sell MW','Volum MW'],b.contracts.map(p=>[p.contractName+' · '+clock(p.deliveryStart),...['openPrice','highPrice','lowPrice','closePrice','averagePrice','buyVolume','sellVolume','volume'].map(k=>fmt(p[k]))]));}
 if(ticket!==generation)return;draw(data);}
function table(headers,rows){const tr=document.createElement('tr');headers.forEach(x=>{const th=document.createElement('th');th.textContent=x;tr.append(th);});$('head').replaceChildren(tr);$('rows').replaceChildren(...rows.map(values=>{const tr=document.createElement('tr');values.forEach(x=>{const td=document.createElement('td');td.textContent=x;tr.append(td);});return tr;}));}
function draw(data){const selection=[$('view').value,$('from').value,$('to').value,$('duration').value,$('contract').value,$('resolution').value].join('|');const oldRange=selection===lastSelection?charts[0]?.timeScale().getVisibleLogicalRange():null;for(const c of charts)c.remove();charts=[];lastSelection=selection;lastBars=data;drawContractVolumes(data);
 const visibleLines=Object.fromEntries(Object.entries(data.lines).filter(([name])=>!name.startsWith('PZU')||$('showPzu').checked)),visibleBands=(data.bands||[]).filter(b=>$('showIda'+b.name.match(/^IDA(\d)/)[1]).checked);
 $('chartTitle').textContent=($('view').value==='trades'?$('contract').selectedOptions[0]?.textContent:'Overview')+' · TEL · '+$('from').value+' – '+$('to').value+' · '+(data.details?.length||0)+' contracte';
 const describe=(time)=>{const d=data.details?.find(d=>d.candles.some(c=>c.time===time));if(!d)return;const b=d.candles.find(c=>c.time===time),v=d.volumes.find(c=>c.time===time)?.value,delta=b.close-b.open;const node=$('cursor');node.replaceChildren();node.append(document.createTextNode(d.contract.contractName+' · livrare '+clock(d.contract.deliveryStart)+` · O ${fmt(b.open)} H ${fmt(b.high)} L ${fmt(b.low)} `));const close=document.createElement('span');close.style.color=delta<0?'#ef5350':'#00a892';close.textContent=`C ${fmt(b.close)} (${delta>0?'+':''}${fmt(delta)})`;node.append(close);const parts=['Volum (MW) '+fmt(v)];if($('showPzu').checked&&d.ref.pzu!==null)parts.push('PZU '+fmt(d.ref.pzu));for(const band of d.ref.ida)if($('showIda'+band.name.slice(-1)).checked)parts.push(band.name+' '+fmt(band.low)+'–'+fmt(band.high));$('legend').textContent=parts.join(' · ')+' · EUR/MWh';};
 $('legend').textContent='OHLC · '+Object.keys(visibleLines).join(' · ')+(visibleBands.length?' · '+visibleBands.map(b=>b.name+' '+fmt(b.low)+'–'+fmt(b.high)).join(' · '):'');$('cursor').textContent=data.candles.length?'Treci cursorul peste grafic pentru OHLC.':'Fără tranzacții confirmate pentru selecția curentă.';
 const opts={autoSize:true,layout:{background:{color:document.documentElement.dataset.theme==='dark'?'#131f28':'#ffffff'},textColor:document.documentElement.dataset.theme==='dark'?'#91a6b2':'#58677b'},grid:{vertLines:{color:document.documentElement.dataset.theme==='dark'?'#293842':'#e7ecf2'},horzLines:{color:document.documentElement.dataset.theme==='dark'?'#293842':'#e7ecf2'}},timeScale:{timeVisible:true,secondsVisible:false,tickMarkFormatter:t=>new Date(Number(t)*1000).toLocaleString('ro-RO',{timeZone:'Europe/Bucharest',hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit'})},localization:{timeFormatter:t=>clock(Number(t)*1000)}};
 const price=LightweightCharts.createChart($('priceChart'),opts),volume=LightweightCharts.createChart($('volumeChart'),opts);charts=[price,volume];
 const candles=price.addCandlestickSeries({upColor:'#26a69a',downColor:'#ef5350',borderVisible:false,wickUpColor:'#26a69a',wickDownColor:'#ef5350'});candles.setData(data.candles);for(const extra of data.extraCandles||[]){price.addCandlestickSeries({upColor:'#26a69a',downColor:'#ef5350',borderVisible:false,wickUpColor:'#26a69a',wickDownColor:'#ef5350',title:extra.name,priceLineVisible:false}).setData(extra.points);}
 Object.entries(visibleLines).forEach(([name,points],i)=>price.addLineSeries({color:name.startsWith('PZU')?'#555555':['#00a892','#4285f4','#ef5350'][i%3],lineStyle:name.startsWith('PZU')?2:0,lineWidth:2,title:name,priceLineVisible:false}).setData(points));for(const [i,band] of visibleBands.entries()){const times=band.times||data.candles.map(c=>c.time),points=times.map(time=>({time,value:band.high})),color=['#9ca3af','#f6a35a','#a879d5'][i];price.addBaselineSeries({baseValue:{type:'price',price:band.low},topLineColor:color,topFillColor1:color+'22',topFillColor2:color+'22',bottomFillColor1:'transparent',bottomFillColor2:'transparent',bottomLineColor:color,lineWidth:1,priceLineVisible:false,title:band.name+' max',lastValueVisible:false}).setData(points);price.addLineSeries({color,lineWidth:1,priceLineVisible:false,title:band.name+' min',lastValueVisible:false}).setData(times.map(time=>({time,value:band.low})));}
 volume.addHistogramSeries({priceFormat:{type:'volume'},priceLineVisible:false}).setData(data.volumes);
 let syncing=false;price.timeScale().subscribeVisibleLogicalRangeChange(r=>{if(r&&!syncing){syncing=true;volume.timeScale().setVisibleLogicalRange(r);syncing=false;}});volume.timeScale().subscribeVisibleLogicalRangeChange(r=>{if(r&&!syncing){syncing=true;price.timeScale().setVisibleLogicalRange(r);syncing=false;}});
 price.subscribeCrosshairMove(p=>{if(p.time)describe(Number(p.time));});const latest=(data.details||[]).flatMap(d=>d.candles).sort((a,b)=>a.time-b.time).at(-1);if(latest)describe(latest.time);if(oldRange)price.timeScale().setVisibleLogicalRange(oldRange);else price.timeScale().fitContent();}
for(const id of ['from','to','duration','view','contract','resolution','ema1','ema2'])$(id).onchange=load;
client.auth.onAuthStateChange((event,next)=>{setTimeout(()=>auth(next),0);});
const {data:{session:initial}}=await client.auth.getSession();if(!session)await auth(initial);
setInterval(()=>{if(session&&!document.hidden)load();},60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden&&session)load();});

window.addEventListener('intelisen-theme-change',()=>{if(lastBars)draw(lastBars)});

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
