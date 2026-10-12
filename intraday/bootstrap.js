const status=document.getElementById('message');
let timer;
function recover(){
 status.replaceChildren(document.createTextNode('Verificarea sesiunii nu s-a încheiat. Reîncearcă încărcarea paginii. '));
 const button=document.createElement('button');button.type='button';button.textContent='Reîncearcă';button.onclick=()=>location.reload();status.append(button);
}
window.addEventListener('unhandledrejection',()=>{if(status.textContent==='Verific sesiunea…')recover();});
timer=setTimeout(()=>{if(status.textContent==='Verific sesiunea…')recover();},20000);
try{await import('./app.js?v=20261012-thin-lines');}catch(error){recover();console.error('Intraday initialization failed',error);}finally{clearTimeout(timer);}
