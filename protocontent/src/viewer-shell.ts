// Trusted first-party "viewer shell" for artifact entry documents.
//
// A top-level browser navigation to an artifact's entry document
// (`<spaceId>.protocontent.app/:name`) returns THIS small trusted page instead
// of the raw artifact bytes. The shell:
//   - frames the UNCHANGED artifact (served at `/:name?raw=1`, byte-identical,
//     with its original sandbox CSP) in a sandboxed iframe, and
//   - renders a small "badge" (Vercel-toolbar-style chrome) that shows a live
//     "new version published" notification (via the Space DO `/__live` WS) plus
//     sign-in/out state and an ownership/token-gated "session index" link.
//
// The shell is TRUSTED chrome. The ONLY untrusted inputs are the artifact name
// and the space id (both constrained by routing, but escaped here defensively).
// The badge lives in a CLOSED shadow DOM and NEVER talks to the iframe; no
// secret is ever postMessaged into the untrusted frame.

export interface ViewerShellOptions {
  spaceId: string;
  name: string;
  version: number;
  host: string;
  k: string | null;
}

/**
 * Build the trusted shell page + the matching nonce'd CSP.
 *
 * The inline <script> is the only script and is locked to a per-response nonce,
 * so the CSP and HTML must be produced together — hence the single return value
 * carrying both `html` and `csp`.
 */
export function renderViewerShell(opts: ViewerShellOptions): { html: string; csp: string } {
  const nonce = generateNonce();
  const csp = shellCsp(nonce);

  const safeName = htmlEscape(opts.name);
  const safeSpace = htmlEscape(opts.spaceId);

  // The framed raw entry lives at the SAME base path (`/:name`) so the
  // artifact's relative-asset resolution is preserved; only the query differs.
  // Pin the version only if the shell URL pinned one (version may equal the
  // current latest — passing it is harmless and keeps the frame stable).
  let frameSrc = "/" + encodeURIComponent(opts.name) + "?raw=1";
  if (Number.isFinite(opts.version) && opts.version > 0) {
    frameSrc += "&v=" + encodeURIComponent(String(opts.version));
  }

  // Server-provided constants for the badge script. JSON.stringify is the safe
  // way to embed these as JS values; we additionally guard against `</script>`
  // breakout by escaping the closing-tag sequence.
  const config = {
    SPACE: opts.spaceId,
    NAME: opts.name,
    VERSION: Number.isFinite(opts.version) ? opts.version : 0,
    HOST: opts.host,
    URL_K: opts.k,
    API: "https://api.protocontent.com",
  };
  const configJson = jsonForScript(config);

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${safeName}</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: #fff; }
  #pc-frame { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; }
</style>
</head>
<body>
<iframe id="pc-frame"
  title="${safeName}"
  src="${htmlEscape(frameSrc)}"
  sandbox="allow-scripts allow-forms allow-popups allow-modals allow-downloads"></iframe>
<script nonce="${nonce}">
(function(){
  "use strict";
  var CFG = ${configJson};
  var SPACE = CFG.SPACE, NAME = CFG.NAME, HOST = CFG.HOST, API = CFG.API;
  var VERSION = typeof CFG.VERSION === "number" ? CFG.VERSION : 0;
  var URL_K = CFG.URL_K || null;

  // Capability state. We start from the URL-derived token (if any) and may
  // upgrade it once /v1/me tells us we own this space.
  var k = URL_K;
  var indexUrl = k ? ("https://" + HOST + "/?k=" + encodeURIComponent(k)) : null;
  var me = null;

  // --- Shadow-DOM badge host (closed; never injected into the iframe) ---
  var host = document.createElement("div");
  host.id = "pc-badge-host";
  host.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:2147483647;";
  document.body.appendChild(host);
  var root = host.attachShadow ? host.attachShadow({ mode: "closed" }) : null;
  if (!root) return; // No shadow DOM support -> no badge (artifact still works).

  var wrap = document.createElement("div");
  wrap.style.cssText = "all:initial;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";
  root.appendChild(wrap);

  var collapsed = false;
  try { collapsed = localStorage.getItem("pc_badge_collapsed") === "1"; } catch (e) {}

  // Elements rebuilt by render().
  function el(tag, css, text) {
    var n = document.createElement(tag);
    if (css) n.style.cssText = css;
    if (text != null) n.textContent = text;
    return n;
  }

  var DOT_CSS = "all:initial;display:flex;align-items:center;justify-content:center;" +
    "width:28px;height:28px;border-radius:999px;background:#111;color:#fff;cursor:pointer;" +
    "box-shadow:0 2px 8px rgba(0,0,0,.3);font:600 13px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;";
  var BAR_CSS = "all:initial;display:flex;align-items:center;gap:10px;" +
    "background:#111;color:#eee;border-radius:999px;padding:6px 10px;" +
    "box-shadow:0 4px 16px rgba(0,0,0,.35);font:500 12px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" +
    "max-width:90vw;flex-wrap:wrap;";
  var LINK_CSS = "all:initial;color:#9ecbff;cursor:pointer;text-decoration:none;font:inherit;";
  var BTN_CSS = "all:initial;color:#fff;background:#2563eb;border-radius:999px;padding:4px 10px;cursor:pointer;font:600 12px/1 inherit;";
  var PILL_CSS = "all:initial;display:inline-flex;align-items:center;gap:6px;background:#1f6feb;color:#fff;border-radius:999px;padding:4px 10px;cursor:pointer;font:600 12px/1 inherit;";
  var X_CSS = "all:initial;color:#888;cursor:pointer;font:700 14px/1 inherit;padding:0 2px;";

  // Pending live-version notification, if any.
  var pendingVersion = null; // number | null
  var hasPending = false;

  function setCollapsed(v) {
    collapsed = v;
    try { localStorage.setItem("pc_badge_collapsed", v ? "1" : "0"); } catch (e) {}
    render();
  }

  function reloadFrame(version) {
    var frame = document.getElementById("pc-frame");
    if (frame) {
      var src = "/" + encodeURIComponent(NAME) + "?raw=1" + (version ? ("&v=" + encodeURIComponent(String(version))) : "");
      frame.setAttribute("src", src);
    }
    if (typeof version === "number") VERSION = version;
    hasPending = false;
    pendingVersion = null;
    render();
  }

  function render() {
    wrap.textContent = "";

    if (collapsed) {
      var dot = el("div", DOT_CSS);
      // Subtle indicator: bullet normally, "!" when a new version is waiting.
      dot.textContent = hasPending ? "!" : "●";
      if (hasPending) dot.style.background = "#1f6feb";
      dot.title = "protocontent";
      dot.addEventListener("click", function () { setCollapsed(false); });
      wrap.appendChild(dot);
      return;
    }

    var bar = el("div", BAR_CSS);

    var brand = el("a", LINK_CSS + "color:#fff;font-weight:700;", "protocontent");
    brand.setAttribute("href", "https://protocontent.com");
    brand.setAttribute("target", "_blank");
    brand.setAttribute("rel", "noopener noreferrer");
    bar.appendChild(brand);

    // Auth state.
    if (me && me.login) {
      var who = el("span", "all:initial;color:#ddd;font:500 12px/1 inherit;display:inline-flex;align-items:center;gap:5px;");
      if (me.avatarUrl) {
        var img = el("img", "all:initial;width:16px;height:16px;border-radius:999px;");
        img.setAttribute("src", me.avatarUrl);
        img.setAttribute("alt", "");
        who.appendChild(img);
      } else {
        who.appendChild(el("span", "color:#3fb950;", "●"));
      }
      who.appendChild(el("span", null, me.login));
      bar.appendChild(who);

      var out = el("a", LINK_CSS, "Sign out");
      out.setAttribute("href", "#");
      out.addEventListener("click", function (ev) { ev.preventDefault(); signOut(); });
      bar.appendChild(out);
    } else {
      var inBtn = el("button", BTN_CSS, "Sign in");
      inBtn.addEventListener("click", function () { signIn(); });
      bar.appendChild(inBtn);
    }

    // Session-index link (top-level escape).
    if (indexUrl) {
      var idx = el("a", LINK_CSS, "↩ Session index");
      idx.setAttribute("href", indexUrl);
      idx.setAttribute("target", "_top");
      bar.appendChild(idx);
    }

    // Live-version pill.
    if (hasPending) {
      var v = pendingVersion;
      var pill = el("span", PILL_CSS, "v" + (v != null ? v : "?") + " published · Reload");
      pill.addEventListener("click", function () { reloadFrame(v != null ? v : undefined); });
      bar.appendChild(pill);
    }

    var x = el("span", X_CSS, "×");
    x.title = "Collapse";
    x.addEventListener("click", function () { setCollapsed(true); });
    bar.appendChild(x);

    wrap.appendChild(bar);
  }

  // --- Auth (fail-soft: never throws to the page) ---
  function refetchMe() {
    fetch(API + "/v1/me?space=" + encodeURIComponent(SPACE), { credentials: "include" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data) return;
        me = data;
        if (me.ownsThisSpace && me.k && !k) {
          k = me.k;
          indexUrl = me.indexUrl || indexUrl;
          ensureSocket();
        } else if (me.indexUrl && !indexUrl) {
          indexUrl = me.indexUrl;
        }
        render();
      })
      .catch(function () { /* 3p-cookie block / offline: keep URL_K fallback */ });
  }

  function signIn() {
    try {
      window.open(API + "/v1/auth/github?popup=1", "pc_auth", "width=600,height=720");
    } catch (e) {}
  }

  function signOut() {
    fetch(API + "/v1/auth/logout", { method: "POST", credentials: "include" })
      .then(function () { me = null; render(); refetchMe(); })
      .catch(function () { me = null; render(); });
  }

  window.addEventListener("message", function (e) {
    if (e.origin === API && e.data && e.data.type === "protocontent-auth") {
      refetchMe();
    }
  });

  // --- Live version WebSocket (reuses the DO /__live fanout) ---
  var ws = null, retry = 0, socketK = null, closedForGood = false;

  function ensureSocket() {
    // (Re)open only when the capability token changed (e.g. acquired via /v1/me).
    if (ws && socketK === k) return;
    if (ws) { try { ws.close(); } catch (e) {} ws = null; }
    socketK = k;
    connect();
  }

  function connect() {
    if (closedForGood) return;
    var proto = location.protocol === "https:" ? "wss" : "ws";
    var qs = k ? ("?k=" + encodeURIComponent(k)) : "";
    try {
      ws = new WebSocket(proto + "://" + HOST + "/__live" + qs);
    } catch (e) { scheduleReconnect(); return; }
    ws.addEventListener("open", function () { retry = 0; });
    ws.addEventListener("message", function (ev) { onMessage(ev); });
    ws.addEventListener("close", function () { scheduleReconnect(); });
    ws.addEventListener("error", function () { try { ws.close(); } catch (e) {} });
  }

  function scheduleReconnect() {
    if (closedForGood) return;
    retry = Math.min(retry + 1, 6);
    setTimeout(connect, 500 * Math.pow(2, retry));
  }

  function onMessage(ev) {
    var msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    if (!msg || msg.type !== "changed") return;
    if (msg.name && msg.name !== NAME) return;
    if (typeof msg.version === "number" && msg.version <= VERSION) return;
    pendingVersion = typeof msg.version === "number" ? msg.version : null;
    hasPending = true;
    render();
  }

  // --- Boot ---
  render();
  refetchMe();
  ensureSocket();
})();
</script>
</body>
</html>`;

  return { html, csp };
}

/**
 * Tight CSP for the trusted shell. The inline badge script is locked to a
 * per-response nonce. `connect-src 'self'` covers the same-origin
 * `wss://<host>/__live`; `frame-src 'self'` covers the same-origin raw artifact
 * iframe. The artifact itself keeps its own (sandbox) CSP from the raw response.
 */
export function shellCsp(nonce: string): string {
  return [
    "default-src 'none'",
    "frame-src 'self'",
    `script-src 'nonce-${nonce}'`,
    "style-src 'unsafe-inline'",
    "img-src https://avatars.githubusercontent.com data:",
    "connect-src 'self' https://api.protocontent.com",
    "frame-ancestors 'none'",
    "base-uri 'none'",
  ].join("; ");
}

function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  // base64url (CSP nonces accept base64; strip padding / url-safe for cleanliness).
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * JSON for safe embedding inside a <script> element: neutralizes `</script>`
 * and unicode line separators that would otherwise break out of the script.
 */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
