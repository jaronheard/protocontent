// First-party "claim & manage" dashboard, served on the control plane
// (api.protocontent.com). It takes your project token (stored in localStorage
// on this cookie-free control origin), calls GET /v1/spaces, and lists/links
// every space your token owns. Same-origin as the API, so no CORS dance.

export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>protocontent — your spaces</title>
<style>
  :root{--bg:#fbfaf7;--panel:#fff;--ink:#1a1a17;--muted:#6b6960;--line:#e7e3d8;
    --accent:#c2410c;--accent-soft:#fff1e9;--good:#15803d;--good-soft:#e7f6ec;--warn:#b45309;
    --chip:#f1eee5;--shadow:0 1px 2px rgba(0,0,0,.04),0 10px 30px rgba(40,30,10,.07);
    --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
    --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.55}
  .wrap{max-width:760px;margin:0 auto;padding:48px 22px 100px}
  .dot{width:11px;height:11px;border-radius:50%;background:var(--accent);display:inline-block;
    box-shadow:0 0 0 4px var(--accent-soft);margin-right:9px}
  h1{font-size:30px;letter-spacing:-.02em;margin:.2em 0 .1em;font-weight:800}
  .lede{color:var(--muted);margin:0 0 26px;font-size:16px}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:14px;
    padding:18px 20px;box-shadow:var(--shadow);margin-bottom:14px}
  label{display:block;font-size:13px;font-weight:600;color:var(--muted);margin-bottom:6px}
  input{width:100%;font-family:var(--mono);font-size:14px;padding:10px 12px;border:1px solid var(--line);
    border-radius:9px;background:var(--bg);color:var(--ink)}
  .row{display:flex;gap:10px;align-items:center;margin-top:12px;flex-wrap:wrap}
  button{font-family:var(--sans);font-size:14px;font-weight:600;padding:9px 16px;border-radius:9px;
    border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer}
  button.ghost{background:var(--panel);color:var(--ink);border-color:var(--line)}
  button:hover{filter:brightness(1.05)}
  .muted{color:var(--muted);font-size:13.5px}
  .space{display:flex;align-items:center;gap:12px;padding:13px 0;border-top:1px solid var(--line)}
  .space:first-of-type{border-top:none}
  .space .meta{flex:1;min-width:0}
  .space .nm{font-weight:650;letter-spacing:-.01em}
  .space .sub{font-family:var(--mono);font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .count{font-size:12px;color:var(--muted);background:var(--chip);border:1px solid var(--line);
    padding:2px 9px;border-radius:999px;white-space:nowrap}
  .badge{font-size:11px;font-weight:700;color:#fff;background:var(--warn);padding:2px 8px;border-radius:999px}
  a.open{font-weight:600;color:var(--accent);text-decoration:none;white-space:nowrap}
  a.open:hover{text-decoration:underline}
  .err{color:var(--accent);font-size:13.5px;margin-top:10px}
  .empty{color:var(--muted);padding:18px 0;text-align:center}
  footer{margin-top:26px;color:var(--muted);font-size:12.5px}
  footer a{color:var(--accent)}
</style>
</head>
<body>
<div class="wrap">
  <h1><span class="dot"></span>your spaces</h1>
  <p class="lede">Paste your protocontent project token to see and open every space it owns. Your token stays in this browser (localStorage) and is sent only to the protocontent API.</p>

  <div class="card">
    <label for="tok">Project token</label>
    <input id="tok" type="password" placeholder="paste your token (from ~/.protocontent/config.json)" autocomplete="off" spellcheck="false">
    <div class="row">
      <button id="load">Load my spaces</button>
      <button class="ghost" id="forget">Forget token</button>
      <button class="ghost" id="gh">Sign in with GitHub</button>
    </div>
    <div class="err" id="err" hidden></div>
  </div>

  <div id="who" class="muted" hidden></div>
  <div id="result"></div>

  <footer>protocontent · <a href="https://github.com/jaronheard/protocontent">source</a> · the token-based dashboard; GitHub sign-in is an opt-in (set GITHUB_CLIENT_ID/SECRET to enable).</footer>
</div>
<script>
  var tokEl=document.getElementById('tok'), errEl=document.getElementById('err'), resEl=document.getElementById('result'), whoEl=document.getElementById('who');
  var saved=localStorage.getItem('pc_token'); if(saved) tokEl.value=saved;
  function showErr(m){ errEl.textContent=m; errEl.hidden=!m; }
  function showWho(m){ if(!whoEl) return; whoEl.textContent=m; whoEl.hidden=!m; }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g, function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function timeAgo(ms){ var d=(Date.now()-ms)/1000; if(d<60)return'just now'; if(d<3600)return Math.floor(d/60)+'m ago'; if(d<86400)return Math.floor(d/3600)+'h ago'; return Math.floor(d/86400)+'d ago'; }
  async function load(){
    var t=tokEl.value.trim(); showErr('');
    if(!t){ showErr('Enter your project token first.'); return; }
    localStorage.setItem('pc_token', t);
    resEl.innerHTML='<div class="card muted">Loading…</div>';
    try{
      var r=await fetch('/v1/spaces',{ headers:{ authorization:'Bearer '+t } });
      if(r.status===401){ resEl.innerHTML=''; showErr('That token is not valid.'); return; }
      if(!r.ok){ resEl.innerHTML=''; showErr('Error '+r.status+'.'); return; }
      var data=await r.json(); render(data.spaces||[]);
    }catch(e){ resEl.innerHTML=''; showErr('Network error: '+e.message); }
  }
  function render(spaces){
    if(!spaces.length){ resEl.innerHTML='<div class="card"><div class="empty">No spaces yet — publish something with the protocontent MCP tool and it\\'ll show up here.</div></div>'; return; }
    var rows=spaces.map(function(s){
      var name=s.label||s.id;
      var badge=s.blocked?'<span class="badge">blocked</span>':'';
      return '<div class="space"><div class="meta"><div class="nm">'+esc(name)+' '+badge+'</div>'+
        '<div class="sub">'+esc(s.id)+' · created '+timeAgo(s.createdAt)+'</div></div>'+
        '<span class="count">'+s.artifactCount+' artifact'+(s.artifactCount===1?'':'s')+'</span>'+
        '<a class="open" href="'+esc(s.url)+'" target="_blank" rel="noopener">open ↗</a></div>';
    }).join('');
    resEl.innerHTML='<div class="card">'+rows+'</div>';
  }
  // After the GitHub redirect-back the pc_session cookie is set on this origin.
  // Show "Signed in as X" and, if we hold a project token, auto-link the identity
  // to the project (so future claims need only the cookie). All defensive.
  async function checkSession(){
    try{
      var r=await fetch('/v1/me',{ credentials:'include' });
      if(!r.ok) return;
      var me=await r.json();
      if(!me || !me.login){ showWho(''); return; }
      showWho('Signed in as '+esc(me.login)+'.');
      var t=(tokEl.value||'').trim();
      if(!t) return;
      try{
        var cr=await fetch('/v1/claim',{ method:'POST', credentials:'include', headers:{ authorization:'Bearer '+t } });
        if(cr.ok){
          var c=await cr.json();
          if(c && c.ok){ showWho('Signed in as '+esc(me.login)+' — claimed '+c.spaces+' space'+(c.spaces===1?'':'s')+'.'); }
        }
      }catch(e){}
    }catch(e){}
  }
  document.getElementById('load').addEventListener('click', load);
  document.getElementById('forget').addEventListener('click', function(){ localStorage.removeItem('pc_token'); tokEl.value=''; resEl.innerHTML=''; showErr(''); });
  document.getElementById('gh').addEventListener('click', function(){ window.location.href='/v1/auth/github'; });
  checkSession();
  if(saved) load();
</script>
</body>
</html>`;
