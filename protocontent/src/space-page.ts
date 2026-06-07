// First-party live session index page for a space.
//
// This HTML is served from the protocontent origin itself (GET / on a
// *.protocontent.app host), so it is first-party and its CSP can be
// permissive. It lists the space's artifacts and opens a WebSocket to
// wss://<host>/__live; on any message it re-fetches GET /__list and re-renders.
// A manual "Refresh" button provides graceful degradation if the socket drops.
//
// Visual language: the "calm aurora frosted-glass" system shared with the
// trusted viewer-shell badge (see brand.ts / viewer-shell.ts), so the chrome
// that floats over an artifact and the index it links to read as one product.

import { BRAND_BASE_CSS, FAVICON, MARK } from "./brand";

export interface SpacePageArtifact {
  name: string;
  url: string; // path like "/my-artifact"
  updatedAt: number; // epoch ms
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderSpacePage(
  spaceId: string,
  label: string | null,
  artifacts: SpacePageArtifact[],
): string {
  const heading = label ? escapeHtml(label) : escapeHtml(spaceId);
  const title = label
    ? `${escapeHtml(label)} · protocontent`
    : `${escapeHtml(spaceId)} · protocontent`;
  // Serialize initial data so the page renders instantly without a fetch.
  const initial = JSON.stringify(artifacts).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${title}</title>
${FAVICON}
<style>
${BRAND_BASE_CSS}
  .wrap{max-width:720px;margin:0 auto;padding:44px 20px 96px;}

  .topbar{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:32px;flex-wrap:wrap;}
  .brand{display:inline-flex;align-items:center;gap:9px;color:var(--ink);font-weight:700;letter-spacing:-.01em;}
  .brand:hover{text-decoration:none;}
  .brand .mark{--mark:24px;}
  .brand-name{font-size:14.5px;}
  .bar{display:inline-flex;align-items:center;gap:11px;padding:6px 6px 6px 13px;border-radius:13px;}
  .status{font-size:12.5px;font-weight:600;color:var(--ink-soft);font-variant-numeric:tabular-nums;}
  .status.off{color:#b06a1f;}

  .head{margin-bottom:26px;}
  .head h1{font-size:26px;line-height:1.2;letter-spacing:-.022em;font-weight:800;margin:0 0 7px;word-break:break-word;}
  .sub{margin:0;color:var(--ink-faint);font-size:13.5px;}
  .sub code{font-family:var(--mono);font-size:12.5px;background:rgba(255,255,255,.5);padding:2px 7px;border-radius:7px;box-shadow:0 0 0 1px var(--edge);}

  ul.list{list-style:none;margin:0;padding:0;display:grid;gap:11px;}
  li.card{min-width:0;border-radius:14px;transition:transform .16s var(--ease),box-shadow .2s var(--ease);}
  li.card:hover{transform:translateY(-2px);
    box-shadow:0 0 0 1px var(--edge),0 1px 0 rgba(255,255,255,.7) inset,0 24px 48px -22px rgba(20,60,58,.55),0 5px 14px -5px rgba(20,60,58,.26);}
  a.row{display:flex;align-items:center;gap:14px;padding:15px 17px;border-radius:inherit;color:var(--ink);min-width:0;}
  a.row:hover{text-decoration:none;}
  .name{flex:1;min-width:0;font-size:15px;font-weight:650;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .when{font-size:12.5px;color:var(--ink-faint);font-variant-numeric:tabular-nums;white-space:nowrap;flex:none;}
  .go{width:15px;height:15px;flex:none;color:var(--ink-faint);opacity:.5;
    background:currentColor;
    -webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='none' stroke='%23000' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round' d='M9 6l6 6-6 6'/%3E%3C/svg%3E") center/contain no-repeat;
    mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='none' stroke='%23000' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round' d='M9 6l6 6-6 6'/%3E%3C/svg%3E") center/contain no-repeat;
    transition:transform .16s var(--ease),opacity .16s ease;}
  li.card:hover .go{opacity:.9;transform:translateX(3px);color:var(--ink-soft);}

  .empty{padding:40px 24px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:6px;}
  .empty .mark{--mark:34px;margin-bottom:6px;}
  .empty p{margin:0;font-size:15px;font-weight:600;color:var(--ink);}
  .empty .hint{font-size:13px;font-weight:500;color:var(--ink-faint);max-width:34ch;}

  footer{margin-top:34px;color:var(--ink-faint);font-size:12.5px;}
</style>
</head>
<body>
  <div class="wrap">
    <div class="topbar">
      <a class="brand" href="https://protocontent.com" target="_blank" rel="noopener">
        ${MARK}<span class="brand-name">protocontent</span>
      </a>
      <div class="bar glass" role="status" aria-live="polite">
        <span class="live-dot" id="dot" title="live" aria-hidden="true"></span>
        <span class="status live" id="status">live</span>
        <button class="btn" id="refresh" type="button" aria-label="Refresh artifact list">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg>
          <span>Refresh</span>
        </button>
      </div>
    </div>

    <header class="head">
      <h1>${heading}</h1>
      <p class="sub">Live session · <code>${escapeHtml(spaceId)}.protocontent.app</code></p>
    </header>

    <ul class="list" id="list"></ul>
    <div class="empty glass" id="empty" hidden>
      ${MARK}
      <p>Nothing published yet.</p>
      <p class="hint">Publish something with the protocontent tool and it'll appear here — live, no refresh needed.</p>
    </div>

    <footer>Updates automatically as your agent publishes.</footer>
  </div>

<script>
(function () {
  var listEl = document.getElementById('list');
  var emptyEl = document.getElementById('empty');
  var statusEl = document.getElementById('status');
  var dotEl = document.getElementById('dot');
  var initial = ${initial};

  function fmtRel(ts) {
    var diff = Date.now() - ts;
    var past = diff >= 0;
    var s = Math.round(Math.abs(diff) / 1000);
    var steps = [[60,'s'],[60,'m'],[24,'h'],[7,'d'],[4.345,'w'],[12,'mo'],[Infinity,'y']];
    var v = s, label = 's';
    for (var i = 0; i < steps.length; i++) { label = steps[i][1]; if (v < steps[i][0]) break; v = Math.floor(v / steps[i][0]); }
    if (v === 0 && label === 's') return 'just now';
    return past ? (v + label + ' ago') : ('in ' + v + label);
  }

  function render(items) {
    listEl.innerHTML = '';
    if (!items || !items.length) { emptyEl.hidden = false; return; }
    emptyEl.hidden = true;
    items.forEach(function (a) {
      var li = document.createElement('li');
      li.className = 'card glass';
      var link = document.createElement('a');
      link.className = 'row';
      link.href = a.url;
      var name = document.createElement('span');
      name.className = 'name';
      name.textContent = a.name;
      var when = document.createElement('span');
      when.className = 'when';
      when.textContent = fmtRel(a.updatedAt);
      var go = document.createElement('span');
      go.className = 'go';
      go.setAttribute('aria-hidden', 'true');
      link.appendChild(name);
      link.appendChild(when);
      link.appendChild(go);
      li.appendChild(link);
      listEl.appendChild(li);
    });
  }

  function refresh() {
    return fetch('/__list' + location.search, { headers: { 'accept': 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (data) { render(data.artifacts || []); })
      .catch(function () { /* keep last render */ });
  }

  function setStatus(live) {
    statusEl.textContent = live ? 'live' : 'offline';
    statusEl.className = 'status ' + (live ? 'live' : 'off');
    dotEl.className = 'live-dot' + (live ? '' : ' off');
    dotEl.title = live ? 'live' : 'offline';
  }

  render(initial);
  document.getElementById('refresh').addEventListener('click', refresh);

  var ws = null, retry = 0;
  function connect() {
    try {
      var proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(proto + '://' + location.host + '/__live' + location.search);
    } catch (e) { setStatus(false); scheduleReconnect(); return; }
    ws.addEventListener('open', function () { setStatus(true); retry = 0; });
    ws.addEventListener('message', function () { refresh(); });
    ws.addEventListener('close', function () { setStatus(false); scheduleReconnect(); });
    ws.addEventListener('error', function () { try { ws.close(); } catch (e) {} });
  }
  function scheduleReconnect() {
    retry = Math.min(retry + 1, 6);
    setTimeout(connect, 500 * Math.pow(2, retry));
  }
  connect();
  // Periodic graceful refresh as a backstop.
  setInterval(refresh, 30000);
})();
</script>
</body>
</html>`;
}
