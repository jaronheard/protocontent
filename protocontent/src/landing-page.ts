// Apex landing page (protocontent.com / protocontent.app).
//
// A deliberately tiny front door: the brand mark, one line of what this is, the
// one command to add it to an agent, and two links. Same "calm aurora
// frosted-glass" language as the viewer-shell badge (see brand.ts), so the
// marketing surface and the in-product chrome are visibly one thing.
//
// Fully first-party, static, no untrusted input. The only script is a tiny
// copy-to-clipboard helper locked to a per-response nonce; everything else is
// CSS. Returns { html, csp } so the worker can set the matching header.

import { BRAND_BASE_CSS, FAVICON, MARK } from "./brand";

const INSTALL_CMD = "claude mcp add protocontent -- npx -y protocontent";
const SOURCE_URL = "https://github.com/jaronheard/protocontent";
const NPM_URL = "https://www.npmjs.com/package/protocontent";

export function renderLandingPage(): { html: string; csp: string } {
  const nonce = generateNonce();
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    "style-src 'unsafe-inline'",
    "img-src data:",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
  ].join("; ");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>protocontent — a cloud scratchpad for your agents</title>
<meta name="description" content="Your coding agent already writes files. protocontent gives them a shareable, sandboxed URL — and a live page that shows everything a session makes, the moment it makes it.">
${FAVICON}
<style>
${BRAND_BASE_CSS}
  /* margin:auto inside a flex column centers when short and top-aligns (never
     clips) when the content is taller than the viewport. */
  body{display:flex;min-height:100dvh;}
  main{width:100%;max-width:600px;margin:auto;padding:56px 22px;text-align:center;}

  .lockup{display:inline-flex;align-items:center;gap:13px;margin-bottom:30px;}
  .lockup .mark{--mark:42px;}
  .lockup h1{font-size:30px;font-weight:800;letter-spacing:-.03em;margin:0;color:var(--ink);}

  .tagline{font-size:25px;line-height:1.28;font-weight:750;letter-spacing:-.02em;color:var(--ink);margin:0 0 16px;text-wrap:balance;}
  .lede{font-size:15.5px;line-height:1.6;color:var(--ink-soft);margin:0 auto 26px;max-width:46ch;text-wrap:pretty;}

  .chips{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin:0 0 30px;}
  .chip{font-size:12px;font-weight:650;letter-spacing:.01em;color:var(--ink-soft);
    padding:5px 12px;border-radius:999px;background:rgba(255,255,255,.42);
    box-shadow:0 0 0 1px var(--edge),0 1px 0 rgba(255,255,255,.6) inset;display:inline-flex;align-items:center;gap:6px;}
  .chip .live-dot{width:7px;height:7px;}

  .install{padding:7px 7px 7px 16px;border-radius:14px;display:flex;align-items:center;gap:10px;
    max-width:520px;margin:0 auto 14px;text-align:left;}
  .install code{flex:1;min-width:0;font-family:var(--mono);font-size:13px;color:var(--ink);
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .install .prompt{color:var(--ink-faint);user-select:none;margin-right:8px;}
  .copy{appearance:none;border:0;cursor:pointer;font:inherit;font-size:12.5px;font-weight:700;color:#063a30;
    padding:8px 14px;border-radius:10px;display:inline-flex;align-items:center;gap:6px;flex:none;
    background:linear-gradient(135deg, var(--aurora-3), var(--aurora-1) 55%, var(--aurora-2));
    box-shadow:0 1px 0 rgba(255,255,255,.6) inset,0 0 0 1px rgba(255,255,255,.3),0 2px 10px -3px rgba(40,210,180,.6);
    transition:transform .16s var(--ease),filter .18s ease;}
  .copy:hover{transform:translateY(-1px);filter:brightness(1.04);}
  .copy:active{transform:translateY(0) scale(.98);}
  .copy svg{width:13px;height:13px;}
  .copy .ok{display:none;}
  .copy.copied .label{display:none;}
  .copy.copied .ok{display:inline-flex;align-items:center;gap:6px;}

  .install-hint{font-size:12.5px;color:var(--ink-faint);margin:0 0 30px;}
  .install-hint code{font-family:var(--mono);font-size:11.5px;background:rgba(255,255,255,.5);padding:1px 6px;border-radius:6px;box-shadow:0 0 0 1px var(--edge);}

  .links{display:flex;gap:9px;justify-content:center;flex-wrap:wrap;}

  footer{margin-top:38px;font-size:12px;color:var(--ink-faint);}
  footer a{color:var(--ink-soft);}
</style>
</head>
<body>
  <main>
    <div class="lockup">${MARK}<h1>protocontent</h1></div>

    <p class="tagline">A cloud scratchpad for your agents.</p>
    <p class="lede">Your coding agent already writes files. protocontent gives them a URL instead of a repo — shareable and sandboxed. Plans, prototypes, dashboards, screenshots: watch them appear on a live session page the moment your agent makes them, and see exactly where one breaks.</p>

    <div class="chips">
      <span class="chip">shareable URL</span>
      <span class="chip">sandboxed</span>
      <span class="chip"><span class="live-dot" aria-hidden="true"></span>live session</span>
    </div>

    <div class="install glass">
      <code><span class="prompt" aria-hidden="true">$</span><span id="cmd">${INSTALL_CMD}</span></code>
      <button type="button" class="copy" id="copy" aria-label="Copy install command">
        <span class="label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>Copy</span>
        <span class="ok"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Copied</span>
      </button>
    </div>
    <p class="install-hint">Any MCP agent works — or just add <code>npx -y protocontent</code> as a stdio MCP server.</p>

    <div class="links">
      <a class="btn" href="${SOURCE_URL}" target="_blank" rel="noopener">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49l-.01-1.9c-2.78.62-3.37-1.2-3.37-1.2-.46-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.55-1.14-4.55-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.7 0 0 .84-.28 2.75 1.05a9.36 9.36 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.4.2 2.44.1 2.7.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.9l-.01 2.81c0 .27.18.6.69.49A10.26 10.26 0 0 0 22 12.25C22 6.58 17.52 2 12 2Z"/></svg>
        Source
      </a>
      <a class="btn" href="${NPM_URL}" target="_blank" rel="noopener">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M2 6h20v11h-9v2H8v-2H2V6Zm2 2v7h2V9h2v6h2V8H4Zm9 0v9h2v-2h3V8h-5Zm2 2h1v3h-1v-3Z"/></svg>
        npm
      </a>
    </div>

    <footer>Made for coding agents · MIT · <a href="${SOURCE_URL}" target="_blank" rel="noopener">jaronheard/protocontent</a></footer>
  </main>

<script nonce="${nonce}">
(function () {
  "use strict";
  var btn = document.getElementById('copy');
  var cmd = ${jsonForScript(INSTALL_CMD)};
  if (!btn) return;
  var reset = null;
  btn.addEventListener('click', function () {
    function done() {
      btn.classList.add('copied');
      if (reset) clearTimeout(reset);
      reset = setTimeout(function () { btn.classList.remove('copied'); }, 1600);
    }
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = cmd;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        done();
      } catch (e) { /* give up silently */ }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(cmd).then(done, fallback);
    } else {
      fallback();
    }
  });
})();
</script>
</body>
</html>`;

  return { html, csp };
}

function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** JSON for safe embedding inside a <script>: neutralizes `</script>` etc. */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
