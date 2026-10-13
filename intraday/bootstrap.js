const status=document.getElementById('message');
let timer;
function recover(){
 status.replaceChildren(document.createTextNode('Verificarea sesiunii nu s-a încheiat. Reîncearcă încărcarea paginii. '));
 const button=document.createElement('button');button.type='button';button.textContent='Reîncearcă';button.onclick=()=>location.reload();status.append(button);
}
window.addEventListener('unhandledrejection',()=>{if(status.textContent==='Verific sesiunea…')recover();});
timer=setTimeout(()=>{if(status.textContent==='Verific sesiunea…')recover();},20000);
try{
 const hash=new URLSearchParams(location.hash.slice(1)),tokenHash=hash.get('token_hash');
 let confirmationFailed=hash.has('error');
 if(confirmationFailed)history.replaceState(null,'',location.pathname+location.search);
 if(tokenHash){
  const {confirmEmailLink}=await import('./email-link.js?v=20261012-confirm-link');
  const {PROJECTS}=await import('../web/project-config.js');
  const client=supabase.createClient(PROJECTS.nordpool.url,PROJECTS.nordpool.key,{auth:{detectSessionInUrl:false}});
  await confirmEmailLink(client,tokenHash,status);
  client.auth.stopAutoRefresh();
  confirmationFailed=status.textContent.startsWith('Linkul a expirat');
 }
 await import('./app.js?v=20261013-volume-colors');
 if(confirmationFailed&&document.getElementById('private').hidden&&document.getElementById('logout').hidden)status.textContent='Linkul a expirat sau a fost deja folosit. Solicită un link nou prin Login.';
}catch(error){recover();console.error('Intraday initialization failed',error);}finally{clearTimeout(timer);}
