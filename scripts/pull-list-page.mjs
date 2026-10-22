// /preorders/pull-list -- customers pick their comic pull-list series
// themselves. Same login (localStorage "mp-foc-session-v1") and API host
// as the preorders page and the article cover pickers, so someone signed
// in there is signed in here. The worker wraps this in the site chrome.
const PULL_API = 'https://still-resonance-4f87.swarnerauto.workers.dev';
const SUPABASE_URL = 'https://vroknjrxubsqyexngwus.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_wbpX2nL8l-4NbXtZNG_bjA_nabSYaJ5';

const STYLE = `<style>
.mp-pull{max-width:820px;margin:0 auto;padding:28px 16px 48px}
.mp-pull h1{font-size:30px;margin:0 0 8px}
.mp-pull h2{font-size:18px;margin:26px 0 8px}
.mp-pull p{line-height:1.55;margin:0 0 10px;opacity:.85}
.mp-pull a{color:var(--wo-accent,#8dff2a);text-decoration:underline}
.mp-pull input{box-sizing:border-box;width:100%;padding:10px 12px;border-radius:8px;border:1px solid rgba(127,127,127,.45);background:transparent;color:inherit;font:inherit}
.mp-pull-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(127,127,127,.25)}
.mp-pull-row small{display:block;opacity:.65}
.mp-pull-btn{cursor:pointer;border:0;border-radius:8px;padding:9px 14px;font:inherit;font-weight:700;background:var(--wo-accent,#8dff2a);color:var(--wo-on-accent,#171717);white-space:nowrap}
.mp-pull-btn.ghost{background:transparent;color:inherit;border:1px solid rgba(127,127,127,.5)}
.mp-pull-btn[disabled]{opacity:.5;cursor:default}
.mp-pull-on{color:#2fbf71;font-weight:700;white-space:nowrap}
.mp-pull-box{border:1px solid rgba(127,127,127,.35);border-radius:12px;padding:14px 16px;margin:14px 0}
.mp-pull-bar{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.mp-pull-bar input{flex:1 1 220px;width:auto}
.mp-pull-msg{min-height:1.4em;margin:8px 0;font-weight:600}
.mp-pull-msg.err{color:#ff4d6d}.mp-pull-msg.ok{color:#2fbf71}
.mp-pull-auth input{margin-top:8px}
</style>`;

export function pullListPageBody(storeId) {
  const cfg = JSON.stringify({ api: PULL_API, sb: SUPABASE_URL, key: SUPABASE_PUBLISHABLE_KEY, store: storeId }).replace(/</g, '\\u003c');
  return STYLE + `<main class="mp-pull" id="mp-pull">
<h1>Comic Pull List</h1>
<p>Pick the series you want every new issue of. When an issue comes in, we set aside the regular cover (Cover A) under your name and let you know. You pay when you pick it up -- nothing is charged now, and you can drop a series any time.</p>
<p>Want variant covers or extra copies? Preorder them on the <a href="/preorders">preorders page</a>.</p>
<div class="mp-pull-msg" data-msg role="status"></div>
<section class="mp-pull-box" data-mine-box><h2 style="margin-top:0">My pull list</h2><div data-mine><p>Sign in to see your pull list.</p></div><div class="mp-pull-bar" data-signin-bar><button class="mp-pull-btn" type="button" data-signin>Sign in</button></div></section>
<h2>Series you can add</h2>
<input type="search" data-search placeholder="Search series or publisher" aria-label="Search series">
<div data-list><p>Loading series…</p></div>
<section class="mp-pull-box"><h2 style="margin-top:0">Don't see it?</h2><p>Ask for a series and the shop will look into adding it. It's on your list as soon as they do.</p>
<div class="mp-pull-bar"><input data-ask maxlength="80" placeholder="Series name, e.g. Absolute Batman"><button class="mp-pull-btn ghost" type="button" data-ask-btn>Ask for it</button></div></section>
<p style="margin-top:18px">Get a text when your books are in: add your phone number in <a href="/account">your account</a>. Otherwise we'll email you.</p>
</main>
<script>(function(){var C=${cfg},SK='mp-foc-session-v1',root=document.getElementById('mp-pull'),series=[],mine=[],signedIn=false,pending=null,needName=false;
function $(s){return root.querySelector(s);}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function read(){try{return JSON.parse(localStorage.getItem(SK)||'null')}catch(e){return null}}
function write(v){try{v?localStorage.setItem(SK,JSON.stringify(v)):localStorage.removeItem(SK)}catch(e){}}
function auth(path,body){return fetch(C.sb+'/auth/v1/'+path,{method:'POST',headers:{apikey:C.key,'Content-Type':'application/json'},body:JSON.stringify(body)}).then(function(r){return r.json().catch(function(){return{}}).then(function(d){if(!r.ok)throw new Error(d.error_description||d.msg||d.message||'Sign in failed');return d;});});}
function session(){var s=read();if(!s||!s.access_token)return Promise.resolve(null);if(!s.expires_at||s.expires_at*1000>Date.now()+60000)return Promise.resolve(s);
return auth('token?grant_type=refresh_token',{refresh_token:s.refresh_token}).then(function(n){if(!n.access_token)throw 0;write(n);return n;}).catch(function(){write(null);return null;});}
function msg(t,k){var m=$('[data-msg]');m.className='mp-pull-msg'+(k?' '+k:'');m.textContent=t||'';}
function call(method,path,body){return session().then(function(s){if(!s)throw new Error('SIGNIN');return fetch(C.api+path,{method:method,headers:Object.assign({Authorization:'Bearer '+s.access_token},body?{'Content-Type':'application/json'}:{}),body:body?JSON.stringify(body):undefined}).then(function(r){return r.json().catch(function(){return{}}).then(function(d){if(r.status===401){write(null);throw new Error('SIGNIN');}if(!r.ok||d.ok===false){var e=new Error(d.error||'Something went wrong -- try again');e.needsName=!!d.needsName;throw e;}return d;});});});}
function onList(id){return mine.some(function(m){return m.seriesId===id;});}
function drawMine(){var box=$('[data-mine]');$('[data-signin-bar]').style.display=signedIn?'none':'';
if(!signedIn){box.innerHTML='<p>Sign in to see your pull list.</p>';return;}
box.innerHTML=mine.length?mine.map(function(m){return '<div class="mp-pull-row"><span><b>'+esc(m.title)+'</b>'+(m.requested?'<small>Asked for -- waiting on the shop</small>':(m.publisher?'<small>'+esc(m.publisher)+'</small>':''))+'</span><button class="mp-pull-btn ghost" type="button" data-drop="'+esc(m.id)+'">Remove</button></div>';}).join(''):'<p>Nothing on your pull list yet -- add a series below.</p>';}
function drawList(){var q=$('[data-search]').value.trim().toLowerCase(),rows=series.filter(function(s){return !q||(s.title+' '+s.publisher).toLowerCase().indexOf(q)>-1;});
$('[data-list]').innerHTML=rows.length?rows.map(function(s){return '<div class="mp-pull-row"><span><b>'+esc(s.title)+'</b>'+(s.publisher?'<small>'+esc(s.publisher)+'</small>':'')+'</span>'+(onList(s.id)?'<span class="mp-pull-on">✓ On my list</span>':'<button class="mp-pull-btn" type="button" data-add="'+esc(s.id)+'">+ Add</button>')+'</div>';}).join(''):'<p>'+(series.length?'No series match that search -- ask for it below.':'No series on the pull list yet -- ask for one below.')+'</p>';}
function draw(){drawMine();drawList();}
function signIn(){if(root.querySelector('.mp-pull-auth'))return;var f=document.createElement('form');f.className='mp-pull-box mp-pull-auth';
f.innerHTML='<b>Sign in</b><p>Same account as the preorders page. New here? Create one in a second.</p><input name="email" type="email" autocomplete="email" placeholder="Email" required><input name="password" type="password" autocomplete="current-password" minlength="8" placeholder="Password · 8+ characters" required><div class="mp-pull-bar"><button class="mp-pull-btn" type="submit">Sign in</button><button class="mp-pull-btn ghost" type="button" data-signup>Create account</button></div>';
$('[data-mine-box]').appendChild(f);f.querySelector('input').focus();
function go(kind){var email=f.email.value.trim(),pw=f.password.value;if(!email||pw.length<8){msg('Enter your email and a password with at least 8 characters.','err');return;}msg(kind==='signup'?'Creating your account…':'Signing in…');
(kind==='signup'?auth('signup',{email:email,password:pw}):auth('token?grant_type=password',{email:email,password:pw})).then(function(s){if(!s.access_token){msg('Check your email to confirm your account, then sign in here.','ok');return;}write(s);f.remove();msg('');load().then(function(){if(pending){var p=pending;pending=null;save(p);}});}).catch(function(e){msg(e.message,'err');});}
f.addEventListener('submit',function(e){e.preventDefault();go('signin');});f.querySelector('[data-signup]').addEventListener('click',function(){go('signup');});}
function askName(then){if(root.querySelector('.mp-pull-name'))return;var f=document.createElement('form');f.className='mp-pull-box mp-pull-name';
f.innerHTML='<b>Your name</b><p>So the shop knows whose books these are.</p><input name="name" autocomplete="name" maxlength="80" placeholder="First and last name" required><div class="mp-pull-bar"><button class="mp-pull-btn" type="submit">Save</button></div>';
$('[data-mine-box]').appendChild(f);f.querySelector('input').focus();
f.addEventListener('submit',function(e){e.preventDefault();var n=f.name.value.trim();if(n.length<2){msg('Enter your name.','err');return;}f.remove();then(n);});}
function save(p){msg('Saving…');call('POST','/public/preorders/pull-list',Object.assign({storeId:C.store},p)).then(function(d){mine=d.subscriptions||[];needName=false;draw();msg(p.subscribe===false?'Removed from your pull list.':(p.request?'Asked for "'+p.request+'" -- it\\'s on your list.':'Added to your pull list.'),'ok');if(p.request)$('[data-ask]').value='';})
.catch(function(e){if(e.message==='SIGNIN'){pending=p;signedIn=false;draw();msg('');signIn();return;}if(e.needsName){msg('');askName(function(n){save(Object.assign({},p,{name:n}));});return;}msg(e.message,'err');});}
function load(){return call('GET','/public/preorders/pull-list?store_id='+encodeURIComponent(C.store)).then(function(d){signedIn=true;mine=d.subscriptions||[];needName=!d.hasCustomer;draw();}).catch(function(e){signedIn=false;draw();if(e.message!=='SIGNIN')msg(e.message,'err');});}
root.addEventListener('click',function(e){var t=e.target.closest('button');if(!t||!root.contains(t))return;
if(t.hasAttribute('data-signin')){signIn();return;}
if(t.hasAttribute('data-add')){save({seriesId:t.getAttribute('data-add')});return;}
if(t.hasAttribute('data-drop')){save({subscribe:false,subscriptionId:t.getAttribute('data-drop')});return;}
if(t.hasAttribute('data-ask-btn')){var v=$('[data-ask]').value.trim();if(v.length<2){msg('Type the name of the series.','err');return;}save({request:v});}});
$('[data-search]').addEventListener('input',drawList);
fetch(C.api+'/public/preorders/pull-list/series?store_id='+encodeURIComponent(C.store)).then(function(r){return r.json();}).then(function(d){series=d.series||[];drawList();}).catch(function(){$('[data-list]').innerHTML='<p>Could not load the series list -- refresh to try again.</p>';});
load();})();</script>`;
}
