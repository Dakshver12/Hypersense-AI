const el=id=>document.getElementById(id);
const mode=location.pathname;
const signup=mode==='/signup',reset=mode==='/reset-password',verify=mode==='/verify-email',forgot=mode==='/forgot-password';
const token=new URLSearchParams(location.hash.slice(1)).get('token')||'';
if(token)history.replaceState(null,'',location.pathname);
el('name-field').hidden=!signup;el('auth-name').required=signup;
el('email-field').hidden=reset||verify;el('auth-email').required=!reset&&!verify;
el('password-field').hidden=forgot||verify;el('auth-password').required=!forgot&&!verify;
el('auth-password').autocomplete=signup||reset?'new-password':'current-password';
el('auth-title').textContent=signup?'Create your account.':reset?'Choose a new password.':verify?'Verify your email.':forgot?'Forgot your password?':'Welcome back.';
el('auth-eyebrow').textContent=signup?'START YOUR JOURNEY':reset||forgot?'ACCOUNT RECOVERY':verify?'ONE LAST STEP':'WELCOME BACK';
el('auth-description').textContent=signup?'Keep your sessions, recordings, and feedback together.':reset?'Updating your password signs out your other sessions.':verify?'Confirm your email address to start practising.':forgot?'Enter your email to receive a reset link.':'Sign in to continue your interview practice.';
el('password-hint').hidden=!signup&&!reset;
el('auth-submit').textContent=signup?'Create account':reset?'Update password':verify?'Verify email':forgot?'Send reset link':'Sign in';
el('forgot-link').hidden=signup||reset||verify||forgot;
el('resend-link').hidden=reset||verify||forgot;
if(mode!=='/login')el('auth-switch').innerHTML='Already have an account? <a href="/login">Sign in</a>';
el('password-toggle').onclick=()=>{const show=el('auth-password').type==='password';el('auth-password').type=show?'text':'password';el('password-toggle').textContent=show?'Hide':'Show';el('password-toggle').setAttribute('aria-label',show?'Hide password':'Show password');el('password-toggle').setAttribute('aria-pressed',String(show));};
async function send(path,body){
 const response=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const data=await response.json();
 if(!response.ok)throw Error(typeof data.detail==='string'?data.detail:'Check your email and use a password of 12–128 characters.');
 return data;
}
let busy=false;
function showDevLink(url){const target=el('dev-link');target.replaceChildren();target.hidden=true;if(!url)return;const link=new URL(url,location.origin);if(link.origin!==location.origin||!['/verify-email','/reset-password'].includes(link.pathname))return;const anchor=document.createElement('a');anchor.href=link.href;anchor.rel='noreferrer';anchor.textContent=link.pathname==='/reset-password'?'Reset password →':'Verify email →';target.append(document.createTextNode('Local testing · '),anchor);target.hidden=false;}
async function act(task){if(busy)return;busy=true;el('auth-submit').disabled=true;el('resend-link').disabled=true;el('auth-message').textContent='Please wait…';showDevLink('');try{await task();}catch(error){el('auth-message').textContent=error.message||'Connection failed. Please retry.';}finally{busy=false;el('auth-submit').disabled=false;el('resend-link').disabled=false;}}
el('auth-form').onsubmit=event=>{event.preventDefault();act(async()=>{
 if((verify||reset)&&!token)throw Error('Open the link from your email. If it expired, request a new one.');
 const body=verify?{token}:reset?{token,password:el('auth-password').value}:forgot?{email:el('auth-email').value}:{email:el('auth-email').value,password:el('auth-password').value,...(signup?{name:el('auth-name').value}:{})};
 const path=signup?'signup':reset?'reset-password':verify?'verify-email':forgot?'forgot-password':'login';
 const result=await send('/auth/'+path,body);el('auth-message').textContent=result.message;showDevLink(result.dev_link);
 if(path==='login')location.replace('/interview');
 if(verify||reset){el('auth-form').hidden=true;el('auth-switch').innerHTML='<a href="/login">Continue to sign in →</a>';}
 });};
el('resend-link').onclick=()=>act(async()=>{if(!el('auth-email').reportValidity())return;const result=await send('/auth/resend-verification',{email:el('auth-email').value});el('auth-message').textContent=result.message;showDevLink(result.dev_link);});
