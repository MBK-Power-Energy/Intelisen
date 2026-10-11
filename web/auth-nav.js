import {nordpool} from './api.js';
const links=[...document.querySelectorAll('[data-auth-nav]')];
let signedIn=false,pending=false;
function paint(session){signedIn=!!session;for(const link of links){link.textContent=signedIn?'Sign out':'Login';link.setAttribute('aria-label',signedIn?'Sign out':'Login');link.removeAttribute('aria-disabled');}}
for(const link of links)link.addEventListener('click',async event=>{
 if(!signedIn)return;event.preventDefault();if(pending)return;pending=true;link.setAttribute('aria-disabled','true');
 try{const {error}=await nordpool.auth.signOut();if(error)throw error;paint(null);}catch(error){let notice=document.getElementById('signOutError');if(!notice){notice=document.createElement('span');notice.id='signOutError';notice.setAttribute('role','alert');link.parentElement.append(notice);}notice.textContent='Sesiunea nu a putut fi închisă. Încearcă din nou.';link.removeAttribute('aria-disabled');}finally{pending=false;}
});
nordpool.auth.onAuthStateChange((event,session)=>paint(session));
const {data:{session}}=await nordpool.auth.getSession();paint(session);
