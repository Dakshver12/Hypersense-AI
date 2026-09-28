import { accountRequest } from '../js/account-store.js';
import { accountId } from '../js/account-context.js';

export function initAccountSettings(){
  const $=id=>document.getElementById(id);
  const status=$('settings-status');
  if(!status)return;
  let busy=false, leaving=false;
  const setBusy=value=>{busy=value;document.querySelectorAll('fieldset, button').forEach(el=>el.disabled=value);};
  const updateName=name=>{$('display-name').value=name;$('profile-name').textContent=name;};
  const send=(path,method,data)=>accountRequest(path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  async function run(task,target=status){
    if(busy)return;
    setBusy(true);target.textContent='Saving…';
    try{await task();}catch(error){target.textContent=error.message;}finally{if(!leaving)setBusy(false);}
  }
  function signedOut(message){
    leaving=true;
    document.querySelectorAll('form').forEach(form=>form.reset());
    document.querySelectorAll('input[type="password"]').forEach(input=>{input.value='';});
    status.replaceChildren(document.createTextNode(message+' '));
    const link=document.createElement('a');link.href='/login';link.textContent='Sign in';status.append(link);
    // Keep controls disabled while navigation replaces this protected page.
    location.replace('/login');
  }
  $('profile-form').addEventListener('submit',event=>{event.preventDefault();run(async()=>{
    const name=$('display-name').value.trim();if(!name)throw Error('Enter your display name.');
    const result=await send('/api/account/profile','PATCH',{name});updateName(result.name);status.textContent=result.message;
  });});
  $('password-form').addEventListener('submit',event=>{event.preventDefault();
    const data=Object.fromEntries(new FormData(event.target));
    run(async()=>{
    if($('new-password').value!==$('confirm-password').value)throw Error('The new passwords do not match.');
    const result=await send('/api/account/password','POST',data);
    signedOut(result.message);
  });});
  $('logout-all').addEventListener('click',()=>run(async()=>signedOut((await send('/api/account/logout-all','POST',{})).message)));
  const dialog=$('delete-dialog');
  $('open-delete').addEventListener('click',()=>{$('delete-form').reset();$('delete-status').textContent='';dialog.showModal();});
  $('cancel-delete').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  $('delete-form').addEventListener('submit',event=>{event.preventDefault();
    const data=Object.fromEntries(new FormData(event.target));
    run(async()=>{
    const result=await send('/api/account','DELETE',data);
    // Remove only this account's browser caches; preserve other users' data.
    try { for(const storage of [localStorage,sessionStorage]){
      for(const key of Object.keys(storage))if(key.endsWith(':'+accountId))storage.removeItem(key);
    }
    for(const name of ['hypersense-interviews','hypersense-recovery'])indexedDB.deleteDatabase(name+':'+accountId);
    } catch { /* Server deletion succeeded even if browser storage is unavailable. */ }
    dialog.close();signedOut(result.message);
  },$('delete-status'));});
  accountRequest('/auth/me').then(user=>{updateName(user.name);$('profile-email').textContent=user.email;$('verified').hidden=false;status.textContent='';setBusy(false);}).catch(error=>{status.textContent=error.message;});
}
initAccountSettings();
