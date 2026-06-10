// Apex landing page (protocontent.com / protocontent.app).
//
// The front door: a topbar (mark, GitHub/npm, Install), a two-tone headline,
// a before/after hero graphic — the same agent message shown as an unreadable
// diff on a phone, then as a live link with a rendered prototype (the "after"
// window links to a real published demo) — three objection cards (private,
// out of your repo, any MCP agent), and the install block with the one
// prompt to copy. Same "calm aurora frosted-glass" language as the
// viewer-shell badge (see brand.ts), so the marketing surface and the
// in-product chrome are visibly one thing.
//
// Fully first-party, static, no untrusted input. The only script is a tiny
// copy-to-clipboard helper locked to a per-response nonce; everything else is
// CSS. Returns { html, csp } so the worker can set the matching header.

import { BRAND_BASE_CSS, FAVICON, MARK } from "./brand";

const SOURCE_URL = "https://github.com/jaronheard/protocontent";
const NPM_URL = "https://www.npmjs.com/package/protocontent";

/** The prompt the install block shows and the copy button copies. Paste it to
 *  any coding agent; it lands in the project's .mcp.json so every session —
 *  and any MCP agent — picks it up (see #22). */
const INSTALL_PROMPT =
  "Add the protocontent MCP (npx -y protocontent) to this project's .mcp.json";

/** Real, live published artifact the hero's "after" card links to — the link
 *  line and the rendered window both open it. It IS the pitch. */
const DEMO_URL =
  "https://teal-ridge-jsbmhggy5ageorz375zdcx.protocontent.app/card-redesign";

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
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>protocontent — your coding agent has something to show you</title>
<meta name="description" content="Your agent runs in the cloud. You're on your phone. When it writes a Markdown plan or an HTML prototype, protocontent gives you a live link to open it.">
${FAVICON}
<style>
${BRAND_BASE_CSS}
  /* page-level deltas on the brand base */
  :root{--serif:'Tiempos Text',ui-serif,Georgia,Cambria,'Times New Roman',Times,serif;}
  body{display:flex;flex-direction:column;min-height:100dvh;}
  /* brand .btn is a <button>; here it's also an <a>, so suppress underlines */
  .btn{text-decoration:none;}
  .btn:hover{text-decoration:none;}

  /* ---- topbar + headline + cards + install block ---- */
  .topbar{display:flex;align-items:center;justify-content:space-between;gap:16px;width:100%;max-width:1000px;margin:0 auto;padding:15px 22px 0;box-sizing:border-box;}
  .topbar .brand{display:inline-flex;align-items:center;gap:9px;}
  .topbar .brand .mark{--mark:26px;}
  .topbar .brand .name{font-size:17px;font-weight:800;letter-spacing:-.02em;color:var(--ink);}
  .topbar .brand .alpha{font-size:9px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:#0a5249;padding:2px 6px;border-radius:999px;line-height:1;background:linear-gradient(135deg,rgba(155,232,255,.7),rgba(122,240,163,.62));box-shadow:0 0 0 1px var(--edge),0 1px 0 rgba(255,255,255,.7) inset;}
  .topnav{display:flex;align-items:center;gap:5px;}
  .topnav a{font-size:13px;font-weight:600;color:var(--ink-soft);padding:6px 11px;border-radius:10px;text-decoration:none;display:inline-flex;align-items:center;gap:6px;transition:background .16s ease,color .16s ease;}
  .topnav a:hover{background:rgba(255,255,255,.55);color:var(--ink);text-decoration:none;}
  .topnav svg{width:15px;height:15px;}
  .topnav .nav-install{color:#063a30;background:linear-gradient(135deg,var(--aurora-3),var(--aurora-1) 55%,var(--aurora-2));box-shadow:0 1px 0 rgba(255,255,255,.6) inset,0 0 0 1px rgba(255,255,255,.3);font-weight:700;}
  .topnav .nav-install:hover{filter:brightness(1.04);color:#063a30;}
  main{width:100%;max-width:760px;margin:auto;padding:32px 22px 48px;text-align:center;}
  .hl{font-size:34px;line-height:1.12;font-weight:800;letter-spacing:-.03em;color:var(--ink);margin:6px auto 14px;max-width:16em;text-wrap:balance;}
  .hl .hl-b{display:block;margin-top:2px;color:#0c7a73;}
  .hl-sub{font-size:17px;line-height:1.46;font-weight:450;color:var(--ink-soft);margin:0 auto;max-width:32em;text-wrap:balance;}
  @media (max-width:540px){
    .topnav .nav-text{display:none;}
    .topnav a{padding:6px 8px;}
    .hl{font-size:27px;}
    .hl-sub{font-size:15.5px;}
  }

  /* objection cards */
  .cards{display:grid;grid-template-columns:repeat(3,1fr);gap:11px;margin:32px auto 0;max-width:680px;text-align:left;}
  .card{border-radius:14px;padding:15px 16px 14px;transition:transform .16s var(--ease),box-shadow .16s var(--ease);}
  .card:hover{transform:translateY(-2px);box-shadow:0 0 0 1px var(--edge),0 1px 0 rgba(255,255,255,.7) inset,0 22px 44px -22px rgba(20,60,58,.5),0 4px 12px -5px rgba(20,60,58,.24);}
  .card .ic{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;margin:0 0 10px;color:#063a30;
    background:linear-gradient(135deg,var(--aurora-3),var(--aurora-1) 55%,var(--aurora-2));
    box-shadow:0 1px 0 rgba(255,255,255,.6) inset,0 0 0 1px rgba(255,255,255,.3),0 4px 12px -5px rgba(40,210,180,.7);}
  .card .ic svg{width:15px;height:15px;display:block;}
  .card h3{margin:0 0 4px;font-size:13.5px;font-weight:750;letter-spacing:-.01em;color:var(--ink);line-height:1.3;}
  .card p{margin:0;font-size:12.5px;line-height:1.5;color:var(--ink-soft);}
  @media (max-width:699px){.cards{grid-template-columns:1fr;max-width:480px;}.card{display:grid;grid-template-columns:30px 1fr;column-gap:12px;}.card .ic{grid-row:1 / 3;margin:2px 0 0;}.card h3{grid-column:2;align-self:center;}.card p{grid-column:2;}}

  /* install block */
  .install-block{margin-top:32px;}
  .install-label{font-size:11.5px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-faint);margin:0 0 10px;}
  .install{padding:7px 7px 7px 16px;border-radius:14px;display:flex;align-items:center;gap:10px;max-width:520px;margin:0 auto 14px;text-align:left;}
  .install code{flex:1;min-width:0;font-family:var(--mono);font-size:12.5px;line-height:1.5;color:var(--ink);}
  .copy{appearance:none;border:0;cursor:pointer;font:inherit;font-size:12.5px;font-weight:700;color:#063a30;padding:8px 15px;border-radius:10px;display:inline-flex;align-items:center;flex:none;background:linear-gradient(135deg, var(--aurora-3), var(--aurora-1) 55%, var(--aurora-2));box-shadow:0 1px 0 rgba(255,255,255,.6) inset,0 0 0 1px rgba(255,255,255,.3),0 2px 10px -3px rgba(40,210,180,.6);transition:transform .16s var(--ease),filter .16s ease;}
  .copy:hover{transform:translateY(-1px);filter:brightness(1.04);}
  .copy .label,.copy .ok{display:inline-flex;align-items:center;gap:7px;}
  .copy svg{width:14px;height:14px;display:block;flex:none;}
  .copy .ok{display:none;}
  .copy.copied .label{display:none;}
  .copy.copied .ok{display:inline-flex;}
  .install-hint{font-size:12.5px;color:var(--ink-faint);margin:0;text-align:center;}
  .install-hint code{font-family:var(--mono);font-size:11.5px;background:rgba(255,255,255,.5);padding:1px 6px;border-radius:6px;box-shadow:0 0 0 1px var(--edge);}
  .links{display:flex;gap:9px;justify-content:center;flex-wrap:wrap;margin-top:24px;}
  footer{margin-top:40px;font-size:12px;color:var(--ink-faint);text-align:center;}
  footer a{color:var(--ink-soft);}

/* Hero graphic — before/after cards; flat serif agent text (app-style),
   app-style "Created" line, side-by-side on desktop. Scoped #e1. */
#e1.hero-gfx{display:flex;justify-content:center;margin:28px auto 0;}
#e1 *{box-sizing:border-box;}
#e1 .e1-wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;}
#e1 .e1-box{position:relative;width:300px;max-width:90vw;background:var(--glass);border-radius:18px;padding:14px 16px 16px;text-align:left;
  box-shadow:0 0 0 1px var(--edge),0 1px 0 rgba(255,255,255,.7) inset,0 18px 40px -22px rgba(20,60,58,.5),0 3px 10px -4px rgba(20,60,58,.20);}
#e1 .e1-eyebrow{margin:0 1px 10px;font-size:10px;font-weight:800;letter-spacing:.11em;text-transform:uppercase;color:var(--ink-faint);}
#e1 .e1-after .e1-eyebrow{color:#0c7a73;}
#e1 .e1-eyebrow .dsc{text-transform:none;letter-spacing:0;font-weight:600;font-size:11px;color:var(--ink-faint);margin-left:7px;}
/* flat agent message — sits directly inside the card, no bubble, no logo */
#e1 .e1-say{margin:0 1px 8px;font-family:var(--serif);font-size:14.5px;line-height:1.42;color:var(--ink);}
/* app-style "Created file +N -0" line */
#e1 .e1-tool{display:flex;align-items:center;gap:7px;margin:0 1px 12px;font-family:var(--serif);font-size:12.5px;color:var(--ink-faint);}
/* live link line under the after message — the link is the product, so make it prominent */
#e1 .e1-link{display:flex;align-items:center;gap:7px;margin:0 1px 12px;font-family:var(--serif);font-size:14.5px;line-height:1.42;}
#e1 .e1-link a{color:#0c7a73;font-weight:400;text-decoration:none;white-space:nowrap;}
#e1 .e1-link a:hover{text-decoration:underline;}
#e1 .e1-tool .t-file{font-family:var(--mono);font-size:11.5px;color:var(--ink-soft);}
#e1 .e1-tool .t-add{font-family:var(--mono);font-size:11.5px;font-weight:600;color:#2f9e6a;}
#e1 .e1-tool .t-del{font-family:var(--mono);font-size:11.5px;font-weight:600;color:#d2544a;margin-left:-2px;}
#e1 .e1-tool .t-chev{margin-left:1px;color:var(--ink-faint);font-size:13px;line-height:1;}
/* inner window */
#e1 .win{position:relative;border-radius:12px;overflow:hidden;background:#fbfdfd;aspect-ratio:1/1;box-shadow:0 0 0 1px var(--edge);}
#e1 a.win{display:block;text-decoration:none;}
#e1 .win-bar{position:absolute;top:0;left:0;right:0;height:28px;z-index:2;display:flex;align-items:center;gap:7px;padding:0 11px;border-bottom:1px solid var(--edge);background:linear-gradient(180deg,rgba(255,255,255,.9),rgba(255,255,255,.55));}
#e1 .win-bar .dots{display:flex;gap:4px;flex:none;}
#e1 .win-bar .dots i{width:7px;height:7px;border-radius:50%;background:rgba(18,52,50,.16);}
#e1 .win-bar .fname{flex:1;min-width:0;font-family:var(--mono);font-size:10px;color:var(--ink-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
#e1 .win-bar.live .fname{color:#0c7a73;}
#e1 .win-bar .badge{flex:none;font-size:8.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#0c7a73;display:inline-flex;align-items:center;gap:5px;}
#e1 .win-bar .badge .live-dot{width:6px;height:6px;}
#e1 .win-body{position:absolute;inset:28px 0 0 0;overflow:hidden;}
/* before: no title bar — the "Created" line above is the header; diff fills the panel and fades to imply a longer file */
#e1 .e1-before .win-body{inset:0;-webkit-mask-image:linear-gradient(to bottom,#000 0,#000 80%,transparent 100%);mask-image:linear-gradient(to bottom,#000 0,#000 80%,transparent 100%);}
/* additive diff */
#e1 .diff{padding:8px 0;font-family:var(--mono);font-size:10.5px;line-height:1.95;}
#e1 .diff .ln{display:block;padding:0 10px 0 22px;position:relative;white-space:pre;background:rgba(122,240,163,.15);color:#1d7a4e;}
#e1 .diff .ln::before{content:'+';position:absolute;left:9px;color:#2f9e6a;font-weight:700;}
/* product render — the prototype is the agent's own design, deliberately NOT this site's
   aurora language: dark slate, indigo accent. */
#e1 .render{display:flex;flex-direction:column;height:100%;background:#12141c;font-family:var(--sans);}
#e1 .render .pk{display:flex;gap:3px;flex:none;margin:11px 11px 10px;padding:3px;border-radius:9px;background:rgba(255,255,255,.08);}
#e1 .render .pk i{flex:1;font-style:normal;text-align:center;font-size:9px;font-weight:600;color:rgba(255,255,255,.55);padding:5px 0;border-radius:7px;}
#e1 .render .pk i.on{background:#5b6cff;color:#fff;font-weight:700;}
#e1 .render .pcard{flex:1;display:flex;flex-direction:column;margin:0 11px 11px;border-radius:10px;background:#1c2230;box-shadow:0 0 0 1px rgba(255,255,255,.08);overflow:hidden;}
#e1 .render .pimg{flex:none;height:42%;background:linear-gradient(135deg,#2a3350,#4a5687);}
#e1 .render .pname{margin:9px 11px 0;font-size:13px;font-weight:700;letter-spacing:-.01em;color:#fff;}
#e1 .render .psub{margin:2px 11px 0;font-size:9.5px;color:rgba(255,255,255,.5);}
#e1 .render .prow{margin:auto 11px 11px;display:flex;align-items:center;justify-content:space-between;padding-top:8px;}
#e1 .render .pprice{font-size:14px;font-weight:800;color:#fff;}
#e1 .render .pbtn{font-size:10px;font-weight:700;color:#fff;background:#5b6cff;padding:6px 12px;border-radius:8px;}
/* connector */
#e1 .e1-conn{display:flex;flex-direction:column;align-items:center;justify-content:center;flex:none;gap:7px;margin:11px 0;}
#e1 .e1-conn .chip{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:rgba(255,255,255,.82);color:#0c7a73;
  box-shadow:0 0 0 1px var(--edge),0 1px 0 rgba(255,255,255,.8) inset,0 8px 18px -9px rgba(20,60,58,.5);}
#e1 .e1-conn svg{width:18px;height:18px;display:block;}
#e1 .e1-conn .a-right{display:none;}
/* desktop: side by side */
@media (min-width:700px){
  #e1 .e1-wrap{flex-direction:row;align-items:stretch;}
  #e1 .e1-box{width:284px;display:flex;flex-direction:column;}
  #e1 .e1-box .win{margin-top:auto;}
  #e1 .e1-conn{margin:0 6px;align-self:center;}
  #e1 .e1-conn .a-down{display:none;}
  #e1 .e1-conn .a-right{display:block;}
}
/* motion */
@media (prefers-reduced-motion:no-preference){
  #e1 .e1-before{animation:e1-rise .6s var(--ease) .1s both;}
  #e1 .e1-conn{animation:e1-pop .5s var(--ease) .52s both;}
  #e1 .e1-after{animation:e1-rise .6s var(--ease) .72s both;}
}
@keyframes e1-rise{from{opacity:0;transform:translateY(12px);}to{opacity:1;transform:none;}}
@keyframes e1-pop{from{opacity:0;transform:scale(.6);}to{opacity:1;transform:none;}}
@media (prefers-reduced-motion:reduce){#e1 .e1-before,#e1 .e1-after,#e1 .e1-conn{opacity:1;}}
</style>
</head>
<body>
<header class="topbar">
  <span class="brand">${MARK}<span class="name">protocontent</span><span class="alpha">pre-alpha</span></span>
  <nav class="topnav">
    <a href="${SOURCE_URL}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49l-.01-1.9c-2.78.62-3.37-1.2-3.37-1.2-.46-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.55-1.14-4.55-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.7 0 0 .84-.28 2.75 1.05a9.36 9.36 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.4.2 2.44.1 2.7.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.9l-.01 2.81c0 .27.18.6.69.49A10.26 10.26 0 0 0 22 12.25C22 6.58 17.52 2 12 2Z"/></svg><span class="nav-text">GitHub</span></a>
    <a href="${NPM_URL}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M2 6h20v11h-9v2H8v-2H2V6Zm2 2v7h2V9h2v6h2V8H4Zm9 0v9h2v-2h3V8h-5Zm2 2h1v3h-1v-3Z"/></svg><span class="nav-text">npm</span></a>
    <a class="nav-install" href="#install">Install</a>
  </nav>
</header>
<main>
  <h1 class="hl">Your coding agent has something to show you. <span class="hl-b">You get a link that opens anywhere.</span></h1>
  <p class="hl-sub">Your agent runs in the cloud. You&rsquo;re on your phone. When it writes a Markdown plan or an HTML prototype, protocontent gives you a live link to open it.</p>
<section id="e1" class="hero-gfx" aria-label="Before and after: a created file you can't open becomes a live prototype at a link">
  <div class="e1-wrap">
    <div class="e1-box e1-before">
      <div class="e1-eyebrow">Before<span class="dsc">an unreadable diff on your phone</span></div>
      <p class="e1-say">Mocked up three approaches for the card redesign</p>
      <div class="e1-tool"><span class="t-verb">Created</span><span class="t-file">card-redesign.html</span><span class="t-add">+318</span><span class="t-del">-0</span><span class="t-chev" aria-hidden="true">&#8964;</span></div>
      <div class="win">
        <div class="win-body">
          <div class="diff">
            <span class="ln">&lt;nav class="picker"&gt;</span>
            <span class="ln">  &lt;button&gt;Option 1&lt;/button&gt;</span>
            <span class="ln">  &lt;button class="on"&gt;Option 2&lt;/button&gt;</span>
            <span class="ln">  &lt;button&gt;Option 3&lt;/button&gt;</span>
            <span class="ln">&lt;/nav&gt;</span>
            <span class="ln">&lt;section id="option-2"&gt;</span>
            <span class="ln">  &lt;article class="card bold"&gt;</span>
            <span class="ln">    &lt;div class="img"&gt;&lt;/div&gt;</span>
            <span class="ln">    &lt;h2&gt;Trail Runners&lt;/h2&gt;</span>
            <span class="ln">    &lt;p class="price"&gt;$48&lt;/p&gt;</span>
            <span class="ln">    &lt;button&gt;Add to cart&lt;/button&gt;</span>
            <span class="ln">  &lt;/article&gt;</span>
            <span class="ln">&lt;/section&gt;</span>
          </div>
        </div>
      </div>
    </div>
    <div class="e1-conn" aria-hidden="true">
      <span class="chip">
        <svg class="a-down" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M6 13l6 6 6-6"/></svg>
        <svg class="a-right" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>
      </span>
    </div>
    <div class="e1-box e1-after">
      <div class="e1-eyebrow">After<span class="dsc">a link that opens anywhere</span></div>
      <p class="e1-say">Mocked up three approaches for the card redesign</p>
      <p class="e1-link"><a href="${DEMO_URL}" target="_blank" rel="noopener">card-redesign&nbsp;↗</a></p>
      <a class="win" href="${DEMO_URL}" target="_blank" rel="noopener">
        <div class="win-bar live"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="fname">protocontent.app/card-redesign</span><span class="badge"><span class="live-dot"></span>live</span></div>
        <div class="win-body">
          <div class="render">
            <div class="pk" aria-hidden="true"><i>Option 1</i><i class="on">Option 2</i><i>Option 3</i></div>
            <div class="pcard">
              <div class="pimg"></div>
              <h3 class="pname">Trail Runners</h3>
              <p class="psub">All-terrain · Unisex</p>
              <div class="prow"><span class="pprice">$48</span><span class="pbtn">Add to cart</span></div>
            </div>
          </div>
        </div>
      </a>
    </div>
  </div>
</section>
  <div class="cards">
    <div class="card glass">
      <span class="ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg></span>
      <h3>Private by default</h3>
      <p>Every link is unguessable, unlisted, and unindexed.</p>
    </div>
    <div class="card glass">
      <span class="ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v12"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg></span>
      <h3>Never touches your repo</h3>
      <p>Artifacts are stored outside your repo, so nothing shows up in git.</p>
    </div>
    <div class="card glass">
      <span class="ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/></svg></span>
      <h3>Works with your agent</h3>
      <p>Claude Code, Cursor, Codex, or any agent that supports MCP. Install it once and your agent uses it on its own.</p>
    </div>
  </div>
  <div class="install-block" id="install">
    <p class="install-label">Tell your coding agent</p>
    <div class="install glass">
      <code>${INSTALL_PROMPT}</code>
      <button type="button" class="copy" id="copy" aria-label="Copy prompt">
        <span class="label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>Copy</span>
        <span class="ok"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Copied</span>
      </button>
    </div>
    <p class="install-hint">Adds it to this project&rsquo;s <code>.mcp.json</code>, so every session picks it up. Any MCP agent works.</p>
    <div class="links">
      <a class="btn" href="${SOURCE_URL}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49l-.01-1.9c-2.78.62-3.37-1.2-3.37-1.2-.46-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.55-1.14-4.55-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.7 0 0 .84-.28 2.75 1.05a9.36 9.36 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.4.2 2.44.1 2.7.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.9l-.01 2.81c0 .27.18.6.69.49A10.26 10.26 0 0 0 22 12.25C22 6.58 17.52 2 12 2Z"/></svg>Source</a>
      <a class="btn" href="${NPM_URL}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M2 6h20v11h-9v2H8v-2H2V6Zm2 2v7h2V9h2v6h2V8H4Zm9 0v9h2v-2h3V8h-5Zm2 2h1v3h-1v-3Z"/></svg>npm</a>
    </div>
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
