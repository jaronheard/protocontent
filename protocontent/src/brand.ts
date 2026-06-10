// Shared "calm aurora frosted-glass" design language (Rams).
//
// This is the same visual vocabulary as the trusted viewer-shell badge
// (see viewer-shell.ts): the aurora palette, the translucent glass surface
// with its gradient hairline, the rounded-square brand mark, dark-teal ink,
// restrained motion. The badge was the reviewed source of truth; the
// first-party index page (space-page.ts) and the apex landing (landing-page.ts)
// extrapolate from it by sharing these exact tokens, so the chrome the agent
// sees floating over an artifact and the pages it links out to feel like one
// product.
//
// Pages inline `BRAND_BASE_CSS` into their own <style> and lay out on top of it.
// Nothing here is untrusted; these are constant, authored bytes.

/** SVG for the rounded-square aurora brand mark's inner gloss is pure CSS, so
 *  the mark is just an empty element with the `.mark` class. */
export const MARK = `<span class="mark" aria-hidden="true"></span>`;

/** Inline SVG favicon: the aurora mark as a data URI (no extra request, no
 *  CSP img-src unless a page is locked down — see landing-page.ts). */
export const FAVICON =
  `<link rel="icon" href="data:image/svg+xml,` +
  `%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E` +
  `%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E` +
  `%3Cstop offset='0' stop-color='%239be8ff'/%3E` +
  `%3Cstop offset='.55' stop-color='%2343e0d0'/%3E` +
  `%3Cstop offset='1' stop-color='%237af0a3'/%3E` +
  `%3C/linearGradient%3E%3C/defs%3E` +
  `%3Crect x='2' y='2' width='28' height='28' rx='9' fill='url(%23g)'/%3E` +
  `%3Ccircle cx='11' cy='10.5' r='3.1' fill='%23fff' opacity='.9'/%3E` +
  `%3C/svg%3E">`;

/**
 * Core tokens + reset + the shared surfaces (page field, glass card, brand mark,
 * live dot, ghost button, focus rings, reduced-motion). Keep this in lockstep
 * with the badge in viewer-shell.ts.
 */
export const BRAND_BASE_CSS = `
:root{
  color-scheme:light;
  --aurora-1:#43e0d0;--aurora-2:#7af0a3;--aurora-3:#9be8ff;--aurora-warm:#ffd6a8;--aurora-rose:#ff9ec4;
  --ink:#0f2b2a;--ink-soft:#3a5654;--ink-faint:#6d8987;
  --glass:rgba(255,255,255,0.68);
  --edge:rgba(18,52,50,0.13);
  --radius:16px;
  --ease:cubic-bezier(.22,.61,.18,1);
  --sans:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}
*{box-sizing:border-box;}
/* Honour the hidden attribute even when an element sets its own display
   (a class with display:flex/grid otherwise wins over the UA [hidden] rule). */
[hidden]{display:none !important;}
/* Keep code/commands literal — no double-hyphen to em-dash ligature, so
   install commands read exactly as they paste. */
code,kbd,samp,pre{font-variant-ligatures:none;font-feature-settings:"liga" 0,"calt" 0;}
html,body{margin:0;padding:0;}
body{
  min-height:100vh;
  color:var(--ink);
  font-family:var(--sans);
  line-height:1.55;
  -webkit-font-smoothing:antialiased;
  text-rendering:optimizeLegibility;
  /* Calm aurora field: large, faint radial glows over a near-white floor so the
     frosted glass always has something to blur over. Fixed so scrolling the
     content doesn't drag the light. */
  background:
    radial-gradient(1200px 760px at 14% -12%, rgba(155,232,255,.32), transparent 60%),
    radial-gradient(1000px 720px at 90% 2%, rgba(122,240,163,.22), transparent 56%),
    radial-gradient(900px 820px at 84% 110%, rgba(255,214,168,.24), transparent 55%),
    radial-gradient(820px 760px at 2% 104%, rgba(255,158,196,.18), transparent 55%),
    #eef3f2;
  background-attachment:fixed;
}

/* shared translucent glass surface — identical recipe to the badge */
.glass{
  position:relative;
  background:var(--glass);
  -webkit-backdrop-filter:blur(20px) saturate(170%);
  backdrop-filter:blur(20px) saturate(170%);
  border:1px solid transparent;
  border-radius:var(--radius);
  box-shadow:
    0 0 0 1px var(--edge),
    0 1px 0 rgba(255,255,255,.7) inset,
    0 18px 40px -22px rgba(20,60,58,.5),
    0 3px 10px -4px rgba(20,60,58,.20);
}
.glass::before{
  content:'';position:absolute;inset:0;border-radius:inherit;padding:1px;
  background:linear-gradient(135deg,rgba(255,255,255,.95) 0%,rgba(155,232,255,.55) 35%,rgba(67,224,208,.45) 60%,rgba(255,255,255,.92) 100%);
  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
  -webkit-mask-composite:xor;
  mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
  mask-composite:exclude;
  opacity:.85;pointer-events:none;
}

/* rounded-square aurora brand mark (size via --mark) */
.mark{
  --mark:28px;
  width:var(--mark);height:var(--mark);border-radius:calc(var(--mark) * .3);
  flex:none;display:inline-block;
  background:
    radial-gradient(circle at 30% 28%, #fff 0 18%, transparent 19%),
    linear-gradient(140deg, var(--aurora-3), var(--aurora-1) 55%, var(--aurora-2));
  box-shadow:0 1px 6px -1px rgba(20,80,76,.45),0 0 0 1px rgba(255,255,255,.5) inset;
}

/* live status dot (aurora green), with a calm pulse */
.live-dot{
  width:8px;height:8px;border-radius:50%;flex:none;
  background:var(--aurora-2);
  box-shadow:0 0 0 1px rgba(255,255,255,.65),0 0 0 0 rgba(122,240,163,.5);
  animation:pc-pulse 2.4s var(--ease) infinite;
}
.live-dot.off{background:var(--aurora-warm);animation:none;}
@keyframes pc-pulse{
  0%{box-shadow:0 0 0 1px rgba(255,255,255,.65),0 0 0 0 rgba(122,240,163,.5);}
  70%{box-shadow:0 0 0 1px rgba(255,255,255,.65),0 0 0 7px rgba(122,240,163,0);}
  100%{box-shadow:0 0 0 1px rgba(255,255,255,.65),0 0 0 0 rgba(122,240,163,0);}
}

/* ghost glass button */
.btn{
  appearance:none;font:inherit;font-size:13px;font-weight:600;cursor:pointer;
  color:var(--ink-soft);
  display:inline-flex;align-items:center;gap:7px;
  padding:7px 13px;border-radius:11px;border:1px solid transparent;
  background:rgba(255,255,255,.42);
  box-shadow:0 0 0 1px var(--edge),0 1px 0 rgba(255,255,255,.6) inset;
  transition:background .16s ease,color .16s ease,transform .16s var(--ease);
}
.btn:hover{background:rgba(255,255,255,.62);color:var(--ink);transform:translateY(-1px);}
.btn:active{transform:translateY(0);}
.btn svg{width:14px;height:14px;flex:none;opacity:.85;}

a{color:#0c7a73;text-decoration:none;}
a:hover{text-decoration:underline;}

/* dark teal, not aurora — the ring must clear 3:1 against the near-white field */
:focus-visible{outline:2px solid #0c7a73;outline-offset:2px;border-radius:10px;}

@media (prefers-reduced-motion: reduce){
  *{animation:none !important;transition:none !important;}
}
`;
