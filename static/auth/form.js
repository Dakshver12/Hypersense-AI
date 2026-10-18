const el=id=>document.getElementById(id);
const initialParams=new URLSearchParams(location.search);
let token=new URLSearchParams(location.hash.slice(1)).get('token')||initialParams.get('token')||'';
const oauthError=initialParams.get('oauth_error')||'';
if(token||oauthError){initialParams.delete('token');initialParams.delete('oauth_error');history.replaceState(null,'',location.pathname+(initialParams.size?'?'+initialParams:''));}
let mode,signup,reset,verify,forgot,verificationCenter,connecting,busy=false;
function renderAuthMode(){
 mode=location.pathname.replace(/\/$/,'')||'/login';
 signup=mode==='/signup';reset=mode==='/reset-password';forgot=mode==='/forgot-password';
 connecting=mode==='/connect-account';verify=mode==='/verify-email'&&Boolean(token);
 verificationCenter=mode==='/verify-account'||(mode==='/verify-email'&&!token);
 el('name-field').hidden=!signup;el('auth-name').required=signup;
 el('email-field').hidden=reset||verify||connecting;el('auth-email').required=!reset&&!verify&&!connecting;
 el('password-field').hidden=forgot||verify||verificationCenter||connecting;
 el('auth-password').required=!forgot&&!verify&&!verificationCenter&&!connecting;
 el('auth-password').autocomplete=signup||reset?'new-password':'current-password';
 const title=connecting?'Connect a sign-in method.':verificationCenter?'Verify your email.':signup?'Create your account.':reset?'Choose a new password.':verify?'Verify your email.':forgot?'Forgot your password?':'Welcome back.';
 el('auth-title').textContent=title;
 el('auth-eyebrow').textContent=connecting?'YOUR ACCOUNT':verificationCenter||verify?'ONE LAST STEP':signup?'START YOUR JOURNEY':reset||forgot?'ACCOUNT RECOVERY':'WELCOME BACK';
 el('auth-description').textContent=connecting?'Sign in to your HyperSense account first, then choose a provider to connect it securely.':verificationCenter?'Enter your signup email to request a fresh verification link. Open it on any device.':signup?'Keep your sessions, recordings, and feedback together.':reset?'Updating your password signs out your other sessions.':verify?'Confirm your email address to start practising.':forgot?'Enter your email to receive a reset link.':'Sign in to continue your interview practice.';
 el('password-hint').hidden=!signup&&!reset;
 el('auth-submit').textContent=verificationCenter?'Send verification email':signup?'Create account':reset?'Update password':verify?'Verify email':forgot?'Send reset link':'Sign in';
 el('forgot-link').hidden=mode!=='/login';el('resend-link').hidden=mode!=='/login'&&!signup;
 el('auth-switch').innerHTML=connecting?'<a href="/account">Back to account settings</a>':mode==='/login'?'New here? <a href="/signup">Create an account</a>':'Already have an account? <a href="/login">Sign in</a>';
 document.title='HyperSense AI · '+title;
 el('auth-form').hidden=connecting;
 if(el('verification-help'))el('verification-help').hidden=!verificationCenter;
 if(el('verification-retry'))el('verification-retry').hidden=!verify;
 const social=el('social-options');
 if(social){social.hidden=!(signup||mode==='/login'||connecting)||!social.querySelector('a');social.querySelectorAll('a[data-provider]').forEach(a=>{a.href='/auth/oauth/'+a.dataset.provider+'/start'+(connecting?'?connect=1':'');});}
}
renderAuthMode();
const socialErrors={
 'not-configured':'This provider is not configured yet. Use email sign-in.',
 expired:'This sign-in request expired or belongs to another browser. Start again.',
 cancelled:'Sign-in was cancelled. Try again or use email.',
 provider:'The sign-in provider could not be reached. Please try again.',
 'verified-email':'Choose a provider account with a verified email address.',
 'existing-account':'This email already has a HyperSense account. Sign in with your password, then open Connected accounts in Settings to connect this provider.',
 suspended:'This account is suspended. Contact support.',
 conflict:'This provider account is already connected to another HyperSense account.',
 'sign-in-first':'Sign in to HyperSense before connecting another sign-in method.'
};
if(oauthError)el('auth-message').textContent=socialErrors[oauthError]||'Sign-in could not finish. Please try again.';
el('password-toggle').onclick=()=>{const show=el('auth-password').type==='password';el('auth-password').type=show?'text':'password';el('password-toggle').textContent=show?'Hide':'Show';el('password-toggle').setAttribute('aria-label',show?'Hide password':'Show password');el('password-toggle').setAttribute('aria-pressed',String(show));};
async function send(path,body){
 const response=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 let data;try{data=await response.json();}catch{throw Error('The server could not complete this request. Please retry.');}
 if(!response.ok){const error=Error(typeof data.detail==='string'?data.detail:'Check your email and password.');error.status=response.status;throw error;}
 return data;
}
function showDevLink(url){const target=el('dev-link');target.replaceChildren();target.hidden=true;if(!url)return;const link=new URL(url,location.origin);if(link.origin!==location.origin||!['/verify-email','/reset-password'].includes(link.pathname))return;const anchor=document.createElement('a');anchor.href=link.href;anchor.rel='noreferrer';anchor.textContent=link.pathname==='/reset-password'?'Reset password →':'Verify email →';target.append(document.createTextNode('Local testing · '),anchor);target.hidden=false;}
function showPublicMode(path,push=true){if(push)history.pushState(null,'',path);token='';el('auth-password').value='';el('auth-password').type='password';el('password-toggle').textContent='Show';el('password-toggle').setAttribute('aria-label','Show password');el('password-toggle').setAttribute('aria-pressed','false');el('auth-message').textContent='';showDevLink('');renderAuthMode();}
async function act(task){
 if(busy)return;busy=true;el('auth-submit').disabled=true;el('resend-link').disabled=true;
 if(el('verify-pasted-link'))el('verify-pasted-link').disabled=true;
 el('auth-message').textContent='Please wait…';showDevLink('');
 try{await task();}catch(error){
  if(mode==='/login'&&error.status===403&&error.message.startsWith('Verify your email'))showPublicMode('/verify-account');
  el('auth-message').textContent=error.message||'Connection failed. Please retry.';
  if(error.status===503)el('auth-message').textContent+=' The email could not be sent. Retry later or contact support.';
 }finally{busy=false;el('auth-submit').disabled=false;el('resend-link').disabled=false;if(el('verify-pasted-link'))el('verify-pasted-link').disabled=false;}
}
function verified(message){if(el('verification-retry'))el('verification-retry').hidden=true;el('auth-message').textContent=message;el('auth-form').hidden=true;if(el('verification-help'))el('verification-help').hidden=true;el('auth-switch').innerHTML='<a href="/login">Continue to sign in →</a>';token='';}
el('auth-form').onsubmit=event=>{event.preventDefault();act(async()=>{
 if((verify||reset)&&!token)throw Error('Open the link from your email. If it expired, request a new one.');
 const body=verify?{token}:reset?{token,password:el('auth-password').value}:forgot||verificationCenter?{email:el('auth-email').value}:{email:el('auth-email').value,password:el('auth-password').value,...(signup?{name:el('auth-name').value}:{})};
 const path=verificationCenter?'resend-verification':signup?'signup':reset?'reset-password':verify?'verify-email':forgot?'forgot-password':'login';
 const result=await send('/auth/'+path,body);
 if(path==='signup')showPublicMode('/verify-account');
 el('auth-message').textContent=result.message;showDevLink(result.dev_link);
 if(path==='login')location.replace('/interview');
 if(path==='verify-email'||path==='reset-password')verified(result.message);
 });};
el('resend-link').onclick=()=>{if(!busy)showPublicMode('/verify-account');};
if(el('verification-link-form'))el('verification-link-form').onsubmit=event=>{
 event.preventDefault();act(async()=>{
  let link;try{link=new URL(el('verification-link').value.trim());}catch{throw Error('Paste the full verification link from your email.');}
  if(link.origin!==location.origin||link.pathname!=='/verify-email')throw Error('Use the verification link for this HyperSense website.');
  const pasted=new URLSearchParams(link.hash.slice(1)).get('token')||link.searchParams.get('token')||'';
  if(!/^[A-Za-z0-9_-]{32,128}$/.test(pasted))throw Error('This link has no valid verification token. Request a fresh email.');
  const result=await send('/auth/verify-email',{token:pasted});el('verification-link').value='';verified(result.message);
 });
};
const publicAuthPaths=new Set(['/login','/signup','/forgot-password','/verify-account']);
function navigateAuth(path,push){
 if(busy||(!publicAuthPaths.has(mode)&&mode!=='/verify-email'))return false;
 showPublicMode(path,push);
 const heading=el('auth-title');heading.setAttribute('tabindex','-1');heading.focus({preventScroll:true});window.scrollTo?.(0,0);return true;
}
document.addEventListener('click',event=>{
 if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
 const anchor=event.target.closest?.('a[href]');if(!anchor||anchor.hasAttribute('download')||(anchor.target&&anchor.target!=='_self'))return;
 const url=new URL(anchor.href,location.href);
 if(url.origin!==location.origin||url.search||url.hash||!publicAuthPaths.has(url.pathname)||(!publicAuthPaths.has(mode)&&mode!=='/verify-email'))return;
 event.preventDefault();navigateAuth(url.pathname,true);
});
window.addEventListener('popstate',()=>{if(!publicAuthPaths.has(location.pathname))return;if(busy){location.reload();return;}navigateAuth(location.pathname,false);});
