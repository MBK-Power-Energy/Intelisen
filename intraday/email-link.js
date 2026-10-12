export function confirmEmailLink(client,tokenHash,status){
 return new Promise(resolve=>{
  status.replaceChildren(document.createTextNode('Apasă butonul pentru a confirma autentificarea. '));
  const button=document.createElement('button');button.type='button';button.className='primary';button.textContent='Confirmă autentificarea';status.append(button);
  button.onclick=async()=>{
   button.disabled=true;
   try{const {error}=await client.auth.verifyOtp({token_hash:tokenHash,type:'email'});if(error)throw error;tokenHash=null;history.replaceState(null,'',location.pathname+location.search);status.textContent='Verific sesiunea…';resolve();}
   catch{status.replaceChildren(document.createTextNode('Linkul a expirat sau a fost deja folosit. Solicită un link nou prin Login. '));tokenHash=null;history.replaceState(null,'',location.pathname+location.search);resolve();}
  };
 });
}
