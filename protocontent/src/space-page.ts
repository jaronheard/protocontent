// First-party live session index page for a space.
//
// This HTML is served from the protocontent origin itself (GET / on a
// *.protocontent.com host), so it is first-party and its CSP can be
// permissive. It lists the space's artifacts and opens a WebSocket to
// wss://<host>/__live; on any message it re-fetches GET /__list and re-renders.
// A manual "Refresh" button provides graceful degradation if the socket drops.

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
  const title = label ? `${escapeHtml(label)} · protocontent` : `${escapeHtml(spaceId)} · protocontent`;
  // Serialize initial data so the page renders instantly without a fetch.
  const initial = JSON.stringify(artifacts).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: #0b0d10;
    color: #e6e9ee;
  }
  @media (prefers-color-scheme: light) {
    body { background: #f7f8fa; color: #1b1f24; }
    .card { background: #fff; border-color: #e3e6ea; }
    a { color: #1351d8; }
    .muted { color: #6b7280; }
    header .dot { background: #16a34a; }
  }
  .wrap { max-width: 760px; margin: 0 auto; padding: 40px 20px 80px; }
  header { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
  header h1 { font-size: 18px; margin: 0; font-weight: 600; letter-spacing: -0.01em; }
  header .dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 0 0 rgba(34,197,94,.5); animation: pulse 2s infinite; }
  @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(34,197,94,.45);} 70% { box-shadow: 0 0 0 8px rgba(34,197,94,0);} 100% { box-shadow: 0 0 0 0 rgba(34,197,94,0);} }
  .sub { margin: 0 0 24px; }
  .muted { color: #93a0b2; font-size: 13px; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .toolbar { margin-bottom: 14px; }
  button {
    font: inherit; font-size: 13px; cursor: pointer;
    background: transparent; color: inherit;
    border: 1px solid currentColor; border-radius: 8px;
    padding: 5px 12px; opacity: .8;
  }
  button:hover { opacity: 1; }
  ul.list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
  li.card {
    border: 1px solid #232a33; border-radius: 12px;
    background: #11151b; padding: 14px 16px;
  }
  li.card a { font-weight: 600; text-decoration: none; font-size: 15px; word-break: break-word; }
  li.card a:hover { text-decoration: underline; }
  a { color: #7aa2ff; }
  .empty { padding: 40px 0; text-align: center; }
  .status { font-size: 12px; }
  .status.live { color: #22c55e; }
  .status.off { color: #f59e0b; }
  footer { margin-top: 40px; font-size: 12px; }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <span class="dot" id="dot" title="live"></span>
      <h1>${label ? escapeHtml(label) : escapeHtml(spaceId)}</h1>
    </header>
    <p class="sub muted">Live session on <code>${escapeHtml(spaceId)}.protocontent.app</code></p>

    <div class="row toolbar">
      <span class="status live" id="status">live</span>
      <button id="refresh" type="button">Refresh</button>
    </div>

    <ul class="list" id="list"></ul>
    <div class="empty muted" id="empty" hidden>No artifacts published yet.</div>

    <footer class="muted">Updates automatically as new artifacts are published.</footer>
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
      li.className = 'card';
      var row = document.createElement('div');
      row.className = 'row';
      var link = document.createElement('a');
      link.href = a.url;
      link.textContent = a.name;
      var time = document.createElement('span');
      time.className = 'muted';
      time.textContent = fmtRel(a.updatedAt);
      row.appendChild(link);
      row.appendChild(time);
      li.appendChild(row);
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
    dotEl.style.background = live ? '#22c55e' : '#f59e0b';
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
