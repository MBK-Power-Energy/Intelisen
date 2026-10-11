import {overview,tradeBars,number,timestamp} from './chart-data.js';
const $=id=>document.getElementById(id),url='https://qumxkyavlavixzaevipw.supabase.co',key='sb_publishable_mL3Wbt0duI8TslUErFWzVg_FOpQxctS';
const client=supabase.createClient(url,key),fmt=v=>number(v)===null?'—':new Intl.NumberFormat('ro-RO',{maximumFractionDigits:3}).format(v),clock=v=>new Date(v).toLocaleString('ro-RO',{timeZone:'Europe/Bucharest',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZoneName:'short'});
let session=null,contracts=[],charts=[],generation=0,busy=false,lastSelection='',lastBars=null;
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
 $('contract').replaceChildren(...contracts.map(r=>{const o=document.createElement('option');o.value=r.contract_id;o.textContent=r.payload.contractName+' · '+clock(r.delivery_start);return o;}));if(contracts.some(r=>r.contract_id===selected))$('contract').value=selected;
 const {data:runs,error}=await client.from('nordpool_runs').select('*').order('id',{ascending:false}).limit(1);if(error)throw error;
 if(ticket!==generation)return;const run=runs[0];$('status').textContent=run?'Ultima colectare: '+clock(run.finished_at||run.started_at)+' · '+run.status+' · '+contracts.length+' contracte':'Fără colectări Nord Pool încă.';
 message(run?.finished_at&&Date.now()-Date.parse(run.finished_at)>600000?'Nu există o colectare Nord Pool recentă. Datele afișate pot fi vechi.':run?.status==='error'?'Colectarea Nord Pool a eșuat. Datele anterioare pot fi vechi.':!run?'Colectarea Nord Pool nu este încă activată.':'Colectare cloud la 5 minute · tranzacții publicate cu aproximativ 20 min întârziere · statistici la 15 min.');
 await render(ticket);
 }catch(e){message('Citirea Nord Pool a eșuat: '+e.message);}finally{busy=false;if(ticket!==generation&&session)load();}}
async function render(ticket){const trades=$('view').value==='trades';$('contractLabel').hidden=!trades;$('resolutionLabel').hidden=!trades;let data;
 if(trades){const id=$('contract').value;if(!id){draw({candles:[],volumes:[],lines:{}});table([],[]);return;}
 const rows=await allRows('nordpool_trades',q=>q.eq('area','TEL').eq('contract_id',id).order('trade_time').order('trade_id'));
 if(ticket!==generation||!session)return;const b=tradeBars(rows,Number($('resolution').value));data={...b,lines:{'VWAP cumulat':b.vwap,'EMA 20':b.ema}};
 $('tableTitle').textContent='Tranzacții · '+$('contract').selectedOptions[0]?.textContent;table(['Ora tranzacției · EET/EEST','Preț EUR/MWh','Volum MW','ID','Revizie'],b.trades.map(p=>[clock(p.tradeTime),fmt(p.price),fmt(p.volume),p.tradeId,p.revisionNumber]));
 }else{const b=overview(contracts);data={...b,lines:{VWAP:b.lines.averagePrice,VWAP3H:b.lines.averagePriceLast3H,VWAP1H:b.lines.averagePriceLast1H}};
 $('tableTitle').textContent='Contracte · OHLC / VWAP';table(['Contract · livrare EET/EEST','Open','High','Low','Close','VWAP','Buy MW','Sell MW','Volum MW'],b.contracts.map(p=>[p.contractName+' · '+clock(p.deliveryStart),...['openPrice','highPrice','lowPrice','closePrice','averagePrice','buyVolume','sellVolume','volume'].map(k=>fmt(p[k]))]));}
 if(ticket!==generation)return;draw(data);}
function table(headers,rows){const tr=document.createElement('tr');headers.forEach(x=>{const th=document.createElement('th');th.textContent=x;tr.append(th);});$('head').replaceChildren(tr);$('rows').replaceChildren(...rows.map(values=>{const tr=document.createElement('tr');values.forEach(x=>{const td=document.createElement('td');td.textContent=x;tr.append(td);});return tr;}));}
function draw(data){const selection=[$('view').value,$('from').value,$('to').value,$('duration').value,$('contract').value,$('resolution').value].join('|');const oldRange=selection===lastSelection?charts[0]?.timeScale().getVisibleLogicalRange():null;for(const c of charts)c.remove();charts=[];lastSelection=selection;lastBars=data;
 $('legend').textContent='OHLC · '+Object.keys(data.lines).join(' · ');$('cursor').textContent=data.candles.length?'Treci cursorul peste grafic pentru OHLC.':'Fără tranzacții confirmate pentru selecția curentă.';
 const opts={autoSize:true,layout:{background:{color:document.documentElement.dataset.theme==='dark'?'#131f28':'#ffffff'},textColor:document.documentElement.dataset.theme==='dark'?'#91a6b2':'#58677b'},grid:{vertLines:{color:document.documentElement.dataset.theme==='dark'?'#293842':'#e7ecf2'},horzLines:{color:document.documentElement.dataset.theme==='dark'?'#293842':'#e7ecf2'}},timeScale:{timeVisible:true,secondsVisible:false,tickMarkFormatter:t=>new Date(Number(t)*1000).toLocaleString('ro-RO',{timeZone:'Europe/Bucharest',hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit'})},localization:{timeFormatter:t=>clock(Number(t)*1000)}};
 const price=LightweightCharts.createChart($('priceChart'),opts),volume=LightweightCharts.createChart($('volumeChart'),opts);charts=[price,volume];
 const candles=price.addCandlestickSeries({upColor:'#26a69a',downColor:'#ef5350',borderVisible:false,wickUpColor:'#26a69a',wickDownColor:'#ef5350'});candles.setData(data.candles);
 Object.entries(data.lines).forEach(([name,points],i)=>price.addLineSeries({color:['#6ddcc6','#ecad75','#b2a2f0'][i%3],lineWidth:2,title:name,priceLineVisible:false}).setData(points));volume.addHistogramSeries({priceFormat:{type:'volume'},priceLineVisible:false}).setData(data.volumes);
 let syncing=false;price.timeScale().subscribeVisibleLogicalRangeChange(r=>{if(r&&!syncing){syncing=true;volume.timeScale().setVisibleLogicalRange(r);syncing=false;}});volume.timeScale().subscribeVisibleLogicalRangeChange(r=>{if(r&&!syncing){syncing=true;price.timeScale().setVisibleLogicalRange(r);syncing=false;}});
 price.subscribeCrosshairMove(p=>{const b=p.seriesData.get(candles);$('cursor').textContent=b?clock(Number(p.time)*1000)+` · O ${fmt(b.open)} H ${fmt(b.high)} L ${fmt(b.low)} C ${fmt(b.close)}`:'Treci cursorul peste grafic pentru OHLC.';});if(oldRange)price.timeScale().setVisibleLogicalRange(oldRange);else price.timeScale().fitContent();}
for(const id of ['from','to','duration','view','contract','resolution'])$(id).onchange=load;
client.auth.onAuthStateChange((event,next)=>{setTimeout(()=>auth(next),0);});
const {data:{session:initial}}=await client.auth.getSession();if(!session)await auth(initial);
setInterval(()=>{if(session&&!document.hidden)load();},60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden&&session)load();});

window.addEventListener('intelisen-theme-change',()=>{if(lastBars)draw(lastBars)});
