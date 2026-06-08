// Apex landing page (protocontent.com / protocontent.app).
//
// A deliberately tiny front door: the brand mark, one line of what this is, the
// one prompt to add it to an agent, and two links. Same "calm aurora
// frosted-glass" language as the viewer-shell badge (see brand.ts), so the
// marketing surface and the in-product chrome are visibly one thing.
//
// Fully first-party, static, no untrusted input. The only script is a tiny
// copy-to-clipboard helper locked to a per-response nonce; everything else is
// CSS. Returns { html, csp } so the worker can set the matching header.

import { BRAND_BASE_CSS, FAVICON, MARK } from "./brand";

const INSTALL_PROMPT =
  "Add the protocontent MCP (npx -y protocontent) to this project's .mcp.json";
const SOURCE_URL = "https://github.com/jaronheard/protocontent";
const NPM_URL = "https://www.npmjs.com/package/protocontent";

// Example artifacts — real, live protocontent links. They ARE the pitch: each
// is HTML an agent made, reachable from any session, device, or teammate by URL.
// (Kept artifacts in the project's space; swap for a curated showcase anytime.)
const EXAMPLES = [
  {
    kind: "Design exploration",
    desc: "A UI study you can open and send.",
    url: "https://teal-ridge-jsbmhggy5ageorz375zdcx.protocontent.app/example-design-exploration",
  },
  {
    kind: "PR review",
    desc: "Findings, in one shareable link.",
    url: "https://teal-ridge-jsbmhggy5ageorz375zdcx.protocontent.app/example-pr-review",
  },
  {
    kind: "Plan",
    desc: "Scope and steps before the code.",
    url: "https://teal-ridge-jsbmhggy5ageorz375zdcx.protocontent.app/example-plan",
  },
];

const ARROW_SVG =
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7"/><path d="M9 7h8v8"/></svg>`;

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
<title>protocontent — your agent makes a file, you get a link</title>
<meta name="description" content="Your agent makes a file; you get a link. Add protocontent to your coding agent and every artifact it makes — plans, prototypes, briefs, mockups, diagrams — lands at a live URL the instant it's written. Rendered, shareable, and out of your repo.">
${FAVICON}
<style>
${BRAND_BASE_CSS}
  /* margin:auto inside a flex column centers when short and top-aligns (never
     clips) when the content is taller than the viewport. */
  body{display:flex;min-height:100dvh;}
  main{width:100%;max-width:600px;margin:auto;padding:56px 22px;text-align:center;}

  .lockup{display:inline-flex;align-items:center;gap:12px;margin-bottom:28px;}
  .lockup .mark{--mark:42px;}
  .lockup h1{font-size:30px;font-weight:800;letter-spacing:-.03em;margin:0;color:var(--ink);}
  .alpha{font-size:10px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:#0a5249;
    align-self:flex-start;margin-top:3px;padding:3px 8px;border-radius:999px;
    background:linear-gradient(135deg, rgba(155,232,255,.7), rgba(122,240,163,.62));
    box-shadow:0 0 0 1px var(--edge),0 1px 0 rgba(255,255,255,.7) inset;}

  .tagline{font-size:25px;line-height:1.28;font-weight:750;letter-spacing:-.02em;color:var(--ink);margin:0 0 16px;text-wrap:balance;}
  .lede{font-size:15.5px;line-height:1.6;color:var(--ink-soft);margin:0 auto 14px;max-width:48ch;text-wrap:pretty;}
  .lede + .lede{margin-bottom:30px;color:var(--ink-faint);font-size:14.5px;}

  /* example artifacts — the proof. each is a real, live HTML link. */
  .examples{display:grid;grid-template-columns:repeat(3,1fr);gap:11px;margin:0 0 32px;text-align:left;}
  .ex{display:flex;flex-direction:column;gap:4px;padding:14px 15px 13px;border-radius:14px;color:var(--ink);min-width:0;
    transition:transform .16s var(--ease),box-shadow .2s var(--ease);}
  .ex:hover{transform:translateY(-2px);text-decoration:none;
    box-shadow:0 0 0 1px var(--edge),0 1px 0 rgba(255,255,255,.7) inset,0 22px 44px -22px rgba(20,60,58,.5),0 4px 12px -5px rgba(20,60,58,.24);}
  .ex-top{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:3px;}
  .ex-tag{font-family:var(--mono);font-size:10px;font-weight:700;letter-spacing:.04em;color:var(--ink-faint);
    padding:2px 6px;border-radius:6px;background:rgba(255,255,255,.5);box-shadow:0 0 0 1px var(--edge);}
  .ex-arrow{width:14px;height:14px;color:var(--ink-faint);opacity:.6;transition:transform .16s var(--ease),opacity .16s ease;}
  .ex-arrow svg{width:100%;height:100%;display:block;}
  .ex:hover .ex-arrow{opacity:.95;transform:translate(2px,-2px);color:var(--ink-soft);}
  .ex-kind{font-size:13.5px;font-weight:700;letter-spacing:-.01em;color:var(--ink);}
  .ex-desc{font-size:12px;line-height:1.4;color:var(--ink-faint);}
  @media (max-width:560px){.examples{grid-template-columns:1fr;}}

  .install{padding:7px 7px 7px 16px;border-radius:14px;display:flex;align-items:center;gap:10px;
    max-width:520px;margin:0 auto 14px;text-align:left;}
  .install code{flex:1;min-width:0;font-family:var(--mono);font-size:12.5px;line-height:1.5;color:var(--ink);}
  .tell{font-size:12.5px;font-weight:750;letter-spacing:.01em;color:var(--ink-soft);margin:0 0 9px;}
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
    <div class="lockup">${MARK}<h1>protocontent</h1><span class="alpha">alpha</span></div>

    <p class="tagline">Your agent makes a file. You get a link.</p>
    <p class="lede">The link's live before you'd think to make one. Add protocontent to your coding agent, and every artifact it makes — a plan, an HTML prototype, a formatted brief, a mockup, a diagram — lands at a link the instant the file is written.</p>
    <p class="lede">Markdown renders as a styled page, HTML as you built it — not raw text in a diff viewer. Outside version control, never staged, never committed. Your laptop, your phone, anywhere.</p>

    <div class="examples">
      ${EXAMPLES.map(
        (e) =>
          `<a class="ex glass" href="${e.url}" target="_blank" rel="noopener">` +
          `<span class="ex-top"><span class="ex-tag">HTML</span><span class="ex-arrow" aria-hidden="true">${ARROW_SVG}</span></span>` +
          `<span class="ex-kind">${e.kind}</span>` +
          `<span class="ex-desc">${e.desc}</span>` +
          `</a>`,
      ).join("")}
    </div>

    <p class="tell">Tell your coding agent:</p>
    <div class="install glass">
      <code id="cmd">${INSTALL_PROMPT}</code>
      <button type="button" class="copy" id="copy" aria-label="Copy prompt">
        <span class="label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>Copy</span>
        <span class="ok"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Copied</span>
      </button>
    </div>
    <p class="install-hint">Adds it to this project’s <code>.mcp.json</code>, so every session picks it up. Any MCP agent works.</p>

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
  var cmd = ${jsonForScript(INSTALL_PROMPT)};
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
