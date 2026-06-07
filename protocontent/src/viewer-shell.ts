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

  // Host wrapper: all:initial resets inherited page styles so nothing leaks
  // in; the badge's own look comes entirely from the injected style element
  // below (allowed by style-src 'unsafe-inline', which permits style elements).
  var wrap = document.createElement("div");
  wrap.style.cssText = "all:initial;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";
  root.appendChild(wrap);

  var collapsed = false;
  try { collapsed = localStorage.getItem("pc_badge_collapsed") === "1"; } catch (e) {}

  // Pending live-version notification, if any.
  var pendingVersion = null; // number | null
  var hasPending = false;

  // ----- Badge styles (Rams "calm aurora frosted-glass") ---------------------
  // All badge CSS lives in this single <style>, scoped naturally by the closed
  // shadow root. No external fonts (system stack); only CSS gradients +
  // backdrop-filter + the GitHub avatar <img>, all covered by the existing CSP.
  var style = document.createElement("style");
  style.textContent =
    ":host{all:initial;}" +
    "*{box-sizing:border-box;}" +
    ".pc-root{" +
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;" +
      "--aurora-1:#43e0d0;--aurora-2:#7af0a3;--aurora-3:#9be8ff;--aurora-warm:#ffd6a8;--aurora-rose:#ff9ec4;" +
      "--ink:#0f2b2a;--ink-soft:#3a5654;--ink-faint:#6d8987;" +
      "--glass-tint:rgba(255,255,255,0.50);--hairline:rgba(255,255,255,0.85);" +
      "--u:4px;--radius:16px;--ease:cubic-bezier(.22,.61,.18,1);" +
      "display:flex;flex-direction:column;align-items:flex-end;max-width:calc(100vw - 24px);}" +

    // shared glass surface
    ".pc-root .glass{position:relative;background:var(--glass-tint);" +
      "-webkit-backdrop-filter:blur(20px) saturate(170%);backdrop-filter:blur(20px) saturate(170%);" +
      "border:1px solid transparent;border-radius:var(--radius);" +
      "box-shadow:0 1px 0 rgba(255,255,255,.6) inset,0 12px 28px -16px rgba(20,60,58,.40),0 1px 4px -1px rgba(20,60,58,.18);}" +
    ".pc-root .glass::before{content:'';position:absolute;inset:0;border-radius:inherit;padding:1px;" +
      "background:linear-gradient(135deg,rgba(255,255,255,.95) 0%,rgba(155,232,255,.55) 35%,rgba(67,224,208,.45) 60%,rgba(255,255,255,.92) 100%);" +
      "-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;" +
      "mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask-composite:exclude;opacity:.85;pointer-events:none;}" +

    // gradient logo mark
    ".pc-root .pc-mark{width:22px;height:22px;border-radius:7px;flex-shrink:0;" +
      "background:radial-gradient(circle at 30% 28%, #fff 0 18%, transparent 19%),linear-gradient(140deg, var(--aurora-3), var(--aurora-1) 55%, var(--aurora-2));" +
      "box-shadow:0 1px 4px -1px rgba(20,80,76,.45),0 0 0 1px rgba(255,255,255,.5) inset;}" +

    ".pc-root .pc-shell{position:relative;display:inline-flex;max-width:100%;}" +
    ".pc-root[data-collapsed='true'] .pc-shell{display:none;}" +

    // resting pill (the menu trigger)
    ".pc-root .pc-pill{display:none;align-items:center;gap:0;padding:5px 5px 5px 8px;border-radius:14px;max-width:100%;}" +
    ".pc-root[data-mode='signedOut'] .pc-pill,.pc-root[data-mode='signedIn'] .pc-pill{display:flex;}" +
    ".pc-root .pc-trigger{appearance:none;border:0;cursor:pointer;background:transparent;font:inherit;color:var(--ink);" +
      "display:flex;align-items:center;gap:8px;padding:3px 5px 3px 3px;border-radius:10px;transition:background .18s ease;}" +
    ".pc-root .pc-trigger:hover{background:rgba(255,255,255,.24);}" +
    ".pc-root.pop-open .pc-trigger{background:rgba(255,255,255,.30);}" +
    ".pc-root .pc-vtag{font-size:13px;font-weight:600;letter-spacing:-.01em;color:var(--ink);line-height:1;white-space:nowrap;font-variant-numeric:tabular-nums;}" +
    ".pc-root .pc-dot{width:7px;height:7px;border-radius:50%;background:var(--aurora-2);box-shadow:0 0 0 1px rgba(255,255,255,.65);flex-shrink:0;}" +
    // signed-in identity pip (falls back to gradient when no avatar)
    ".pc-root .pc-pip{display:none;width:18px;height:18px;border-radius:50%;flex-shrink:0;overflow:hidden;" +
      "background:radial-gradient(circle at 35% 30%, #fff6, transparent 60%),linear-gradient(135deg, var(--aurora-warm), var(--aurora-rose) 80%);" +
      "box-shadow:0 0 0 1px rgba(255,255,255,.7);place-items:center;}" +
    ".pc-root[data-mode='signedIn'] .pc-pip{display:grid;}" +
    ".pc-root .pc-pip img{width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;}" +
    // chevron (points up at rest, rotates down when open)
    ".pc-root .pc-chev{width:13px;height:13px;flex-shrink:0;color:var(--ink-faint);opacity:.7;display:grid;place-items:center;transition:transform .26s var(--ease), opacity .2s ease;}" +
    ".pc-root .pc-chev svg{width:11px;height:11px;display:block;}" +
    ".pc-root.pop-open .pc-chev{transform:rotate(180deg);opacity:.95;}" +

    // new-version alert line
    ".pc-root .pc-alert{display:none;align-items:center;gap:8px;padding:5px 5px 5px 8px;border-radius:14px;max-width:100%;}" +
    ".pc-root[data-mode='newVersion'] .pc-alert{display:flex;}" +
    ".pc-root .pc-alert .spark{position:relative;width:22px;height:22px;border-radius:7px;flex-shrink:0;" +
      "background:linear-gradient(140deg, var(--aurora-3), var(--aurora-1) 60%, var(--aurora-2));" +
      "box-shadow:0 0 0 1px rgba(255,255,255,.5) inset,0 1px 6px -1px rgba(40,200,170,.5);display:grid;place-items:center;}" +
    ".pc-root .pc-alert .spark svg{width:12px;height:12px;display:block;}" +
    ".pc-root .pc-alert .hd{font-size:13px;font-weight:600;color:var(--ink);letter-spacing:-.01em;white-space:nowrap;line-height:1;}" +
    ".pc-root .pc-alert .hd .v{font-weight:600;color:var(--ink-faint);font-variant-numeric:tabular-nums;margin-left:5px;}" +
    ".pc-root .pc-reload{appearance:none;border:0;cursor:pointer;font:inherit;font-size:12.5px;font-weight:700;letter-spacing:.01em;color:#063a30;" +
      "padding:6px 12px;border-radius:10px;display:inline-flex;align-items:center;gap:6px;flex-shrink:0;" +
      "background:linear-gradient(135deg, var(--aurora-3), var(--aurora-1) 55%, var(--aurora-2));" +
      "box-shadow:0 1px 0 rgba(255,255,255,.6) inset,0 0 0 1px rgba(255,255,255,.3),0 2px 10px -3px rgba(40,210,180,.6);" +
      "transition:transform .16s var(--ease), box-shadow .2s var(--ease), filter .18s ease;}" +
    ".pc-root .pc-reload:hover{transform:translateY(-1px);filter:brightness(1.04);" +
      "box-shadow:0 1px 0 rgba(255,255,255,.7) inset,0 0 0 1px rgba(255,255,255,.4),0 4px 14px -3px rgba(40,210,180,.75);}" +
    ".pc-root .pc-reload:active{transform:translateY(0) scale(.98);}" +
    ".pc-root .pc-reload svg{width:13px;height:13px;}" +

    // the menu (opens above the pill)
    ".pc-root .pc-menu{position:absolute;bottom:calc(100% + 8px);right:0;width:max-content;min-width:200px;max-width:min(80vw, 236px);" +
      "padding:5px;border-radius:14px;display:flex;flex-direction:column;gap:2px;transform-origin:bottom right;" +
      "opacity:0;transform:translateY(6px) scale(.96);pointer-events:none;transition:opacity .22s var(--ease), transform .26s var(--ease);z-index:5;}" +
    ".pc-root.pop-open .pc-menu{opacity:1;transform:translateY(0) scale(1);pointer-events:auto;}" +
    ".pc-root[data-mode='newVersion'] .pc-menu{display:none;}" +
    ".pc-root[data-collapsed='true'] .pc-menu{display:none;}" +
    ".pc-root .pc-menu-id{display:flex;align-items:center;gap:8px;padding:6px 8px 8px;border-bottom:1px solid rgba(15,43,42,.09);margin-bottom:2px;}" +
    ".pc-root .pc-avatar{width:26px;height:26px;border-radius:50%;flex-shrink:0;overflow:hidden;" +
      "background:radial-gradient(circle at 35% 30%, #fff4, transparent 60%),linear-gradient(135deg, var(--aurora-warm), var(--aurora-rose) 80%);" +
      "box-shadow:0 0 0 1px rgba(255,255,255,.7);display:grid;place-items:center;font-size:12px;font-weight:700;color:#7a2f4d;}" +
    ".pc-root .pc-avatar img{width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;}" +
    ".pc-root .pc-menu-mark{width:26px;height:26px;border-radius:8px;flex-shrink:0;" +
      "background:radial-gradient(circle at 30% 28%, #fff 0 18%, transparent 19%),linear-gradient(140deg, var(--aurora-3), var(--aurora-1) 55%, var(--aurora-2));" +
      "box-shadow:0 1px 4px -1px rgba(20,80,76,.4),0 0 0 1px rgba(255,255,255,.5) inset;}" +
    ".pc-root .pc-menu-text{display:flex;flex-direction:column;min-width:0;line-height:1.25;}" +
    ".pc-root .pc-menu-name{font-size:13px;font-weight:700;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}" +
    ".pc-root .pc-menu-sub{font-size:11px;font-weight:500;color:var(--ink-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums;}" +
    ".pc-root .pc-item{appearance:none;border:0;background:transparent;cursor:pointer;font:inherit;font-size:12.5px;font-weight:600;color:var(--ink-soft);" +
      "text-decoration:none;display:flex;align-items:center;gap:8px;padding:8px 8px;border-radius:9px;width:100%;text-align:left;min-height:38px;outline:none;" +
      "transition:background .14s ease, color .14s ease;}" +
    ".pc-root .pc-item:hover,.pc-root .pc-item[data-active='true']{background:rgba(255,255,255,.5);color:var(--ink);}" +
    ".pc-root .pc-item svg{width:15px;height:15px;flex-shrink:0;opacity:.8;}" +
    ".pc-root .pc-item.primary{color:var(--ink);font-weight:700;box-shadow:0 0 0 1px rgba(15,43,42,.12) inset;}" +
    ".pc-root .pc-item.primary:hover,.pc-root .pc-item.primary[data-active='true']{background:rgba(255,255,255,.55);}" +
    ".pc-root .pc-item.danger{color:var(--ink-faint);}" +
    ".pc-root .pc-item.danger:hover,.pc-root .pc-item.danger[data-active='true']{color:#a23a5a;background:rgba(255,158,196,.14);}" +
    ".pc-root .pc-sep{height:1px;margin:3px 7px;background:rgba(15,43,42,.10);flex-shrink:0;}" +
    // hide the session-index item when no index URL exists
    ".pc-root[data-has-index='false'] .pc-item-session{display:none;}" +
    // per-mode menu items: sign-in (signedOut) vs sign-out (signedIn)
    ".pc-root .pc-item-signin,.pc-root .pc-item-signout{display:none;}" +
    ".pc-root[data-mode='signedOut'] .pc-item-signin{display:flex;}" +
    ".pc-root[data-mode='signedIn'] .pc-item-signout{display:flex;}" +
    // identity header: brand mark (signedOut) vs avatar (signedIn)
    ".pc-root .pc-id-mark,.pc-root .pc-id-avatar{display:none;}" +
    ".pc-root[data-mode='signedOut'] .pc-id-mark{display:block;}" +
    ".pc-root[data-mode='signedIn'] .pc-id-avatar{display:grid;}" +

    // collapsed bead (launcher)
    ".pc-root .pc-bead{appearance:none;border:0;cursor:pointer;width:44px;height:44px;border-radius:50%;display:none;place-items:center;padding:0;position:relative;transform-origin:bottom right;}" +
    ".pc-root .pc-bead .pc-mark{width:22px;height:22px;}" +
    ".pc-root[data-collapsed='true'] .pc-bead{display:grid;}" +
    ".pc-root .pc-bead .dot{display:none;position:absolute;top:8px;right:8px;width:10px;height:10px;border-radius:50%;" +
      "background:linear-gradient(135deg,#9be8ff,#7af0a3);box-shadow:0 0 0 2px rgba(255,255,255,.85);}" +
    ".pc-root .pc-bead.alert .dot{display:block;}" +

    // focus rings
    ".pc-root .pc-shell button:focus-visible,.pc-root .pc-shell a:focus-visible,.pc-root .pc-bead:focus-visible{outline:2px solid var(--aurora-1);outline-offset:2px;border-radius:12px;}" +
    ".pc-root .pc-menu:focus{outline:none;}" +

    // motion (single restrained cue on arrival)
    ".pc-root .pc-arrive{animation:pc-arrive .42s var(--ease);}" +
    "@keyframes pc-arrive{0%{opacity:0;transform:translateY(5px);}100%{opacity:1;transform:translateY(0);}}" +
    ".pc-root[data-mode='newVersion'] .pc-arrive .spark{animation:pc-sparkonce .9s var(--ease);}" +
    "@keyframes pc-sparkonce{0%{box-shadow:0 0 0 1px rgba(255,255,255,.5) inset,0 1px 6px -1px rgba(40,200,170,.5);}" +
      "40%{box-shadow:0 0 0 1px rgba(255,255,255,.6) inset,0 2px 12px 0 rgba(60,230,200,.7);}" +
      "100%{box-shadow:0 0 0 1px rgba(255,255,255,.5) inset,0 1px 6px -1px rgba(40,200,170,.5);}}" +
    ".pc-root .pc-bead.pc-arrive{animation:pc-beadarrive .4s var(--ease);}" +
    "@keyframes pc-beadarrive{0%{opacity:0;transform:translateY(6px) scale(.94);}100%{opacity:1;transform:translateY(0) scale(1);}}" +
    "@media (prefers-reduced-motion: reduce){*{animation:none !important;}.pc-root .pc-menu,.pc-root .pc-chev{transition:opacity .12s linear;}}" +

    // tiny screens: keep the alert line in-bounds
    ".pc-root .pc-alert .hd .hd-short{display:none;}" +
    "@media (max-width:360px){.pc-root .pc-alert{gap:6px;padding:5px 5px 5px 7px;}" +
      ".pc-root .pc-alert .hd .hd-full{display:none;}.pc-root .pc-alert .hd .hd-short{display:inline;}" +
      ".pc-root .pc-alert .hd .v{display:none;}.pc-root .pc-reload{padding:6px 10px;}}";
  root.appendChild(style);

  // ----- Badge markup (built ONCE; updated in place by applyState) -----------
  // Static structure is trusted chrome (we author every byte); the few inline
  // SVGs are constant. Anything derived from untrusted data (me.login, version)
  // is written later via textContent / setAttribute, never via innerHTML.
  var pcRoot = document.createElement("div");
  pcRoot.className = "pc-root";
  pcRoot.setAttribute("data-mode", "signedOut");
  pcRoot.setAttribute("data-collapsed", "false");
  pcRoot.setAttribute("data-has-index", "false");
  pcRoot.innerHTML =
    "<div class='pc-shell'>" +
      "<div class='pc-menu glass' role='menu' tabindex='-1' aria-label='protocontent account and actions'>" +
        "<div class='pc-menu-id' role='presentation'>" +
          "<span class='pc-menu-mark pc-id-mark' aria-hidden='true'></span>" +
          "<span class='pc-avatar pc-id-avatar' aria-hidden='true'></span>" +
          "<span class='pc-menu-text'>" +
            "<span class='pc-menu-name pc-id-name'></span>" +
            "<span class='pc-menu-sub pc-id-sub'></span>" +
          "</span>" +
        "</div>" +
        "<a href='#' class='pc-item js-item pc-item-session' role='menuitem' tabindex='-1' data-action='session' target='_top'>" +
          "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><path d='M3 6h13M3 12h13M3 18h13'/><path d='M20 6l1 1-1 1M20 12l1 1-1 1M20 18l1 1-1 1'/></svg>" +
          "<span>Session index</span></a>" +
        "<button type='button' class='pc-item primary js-item pc-item-signin' role='menuitem' tabindex='-1' data-action='signin'>" +
          "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><path d='M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4'/><path d='M10 17l5-5-5-5'/><path d='M15 12H3'/></svg>" +
          "<span>Sign in with GitHub</span></button>" +
        "<button type='button' class='pc-item danger js-item pc-item-signout' role='menuitem' tabindex='-1' data-action='signout'>" +
          "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><path d='M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4'/><path d='M16 17l5-5-5-5'/><path d='M21 12H9'/></svg>" +
          "<span>Sign out</span></button>" +
        "<div class='pc-sep' role='separator'></div>" +
        "<button type='button' class='pc-item js-item pc-item-hide' role='menuitem' tabindex='-1' data-action='hide'>" +
          "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><path d='M2 12s3.5-7 10-7 10 7 10 7'/><path d='M2 12s3.5 7 10 7 10-7 10-7'/><path d='M4 4l16 16'/></svg>" +
          "<span>Hide badge</span></button>" +
      "</div>" +
      "<div class='pc-pill glass'>" +
        "<button type='button' class='pc-trigger' aria-haspopup='menu' aria-expanded='false'>" +
          "<span class='pc-mark' aria-hidden='true'></span>" +
          "<span class='pc-pip' aria-hidden='true'></span>" +
          "<span class='pc-vtag'></span>" +
          "<span class='pc-dot' aria-hidden='true'></span>" +
          "<span class='pc-chev' aria-hidden='true'>" +
            "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'><path d='M6 15l6-6 6 6'/></svg>" +
          "</span>" +
        "</button>" +
      "</div>" +
      "<div class='pc-alert glass' role='status' aria-live='polite'>" +
        "<span class='spark' aria-hidden='true'>" +
          "<svg viewBox='0 0 24 24' fill='none' stroke='#063a30' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'><path d='M13 2 4 14h7l-1 8 9-12h-7z'/></svg>" +
        "</span>" +
        "<span class='hd'><span class='hd-full'>New version available</span><span class='hd-short'>New version</span><span class='v'></span></span>" +
        "<button type='button' class='pc-reload' aria-label='Reload to load the new version'>" +
          "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'><path d='M21 12a9 9 0 1 1-3-6.7'/><path d='M21 4v5h-5'/></svg>" +
          "<span>Reload</span></button>" +
      "</div>" +
    "</div>" +
    "<button type='button' class='pc-bead glass' aria-label='protocontent — expand badge.'>" +
      "<span class='pc-mark' aria-hidden='true'></span>" +
      "<span class='dot' aria-hidden='true'></span>" +
    "</button>";
  wrap.appendChild(pcRoot);

  // Cached element refs.
  var elShell    = pcRoot.querySelector(".pc-shell");
  var elMenu     = pcRoot.querySelector(".pc-menu");
  var elTrigger  = pcRoot.querySelector(".pc-trigger");
  var elBead     = pcRoot.querySelector(".pc-bead");
  var elAlert    = pcRoot.querySelector(".pc-alert");
  var elVtag     = pcRoot.querySelector(".pc-vtag");
  var elPip      = pcRoot.querySelector(".pc-pip");
  var elAlertV   = pcRoot.querySelector(".pc-alert .hd .v");
  var elIdAvatar = pcRoot.querySelector(".pc-id-avatar");
  var elIdName   = pcRoot.querySelector(".pc-id-name");
  var elIdSub    = pcRoot.querySelector(".pc-id-sub");
  var elSession  = pcRoot.querySelector(".pc-item-session");
  var elReload   = pcRoot.querySelector(".pc-reload");

  // ----- Real actions (unchanged in behaviour) ------------------------------
  function setCollapsed(v) {
    collapsed = v;
    try { localStorage.setItem("pc_badge_collapsed", v ? "1" : "0"); } catch (e) {}
    applyState();
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
    applyState();
  }

  // ----- Menu interaction (closed-shadow aware) -----------------------------
  // Closed shadow: focus tracking uses root.activeElement (NOT document's);
  // click-outside detects via composedPath() truncation at the host.
  function visibleItems() {
    return Array.prototype.filter.call(
      elMenu.querySelectorAll(".js-item"),
      function (el) { return el.offsetParent !== null; }
    );
  }
  function clearActive() {
    var act = elMenu.querySelectorAll(".js-item[data-active='true']");
    for (var i = 0; i < act.length; i++) act[i].setAttribute("data-active", "false");
  }
  function focusItem(idx) {
    var items = visibleItems();
    if (!items.length) return;
    if (idx < 0) idx = items.length - 1;
    if (idx >= items.length) idx = 0;
    clearActive();
    var node = items[idx];
    node.setAttribute("data-active", "true");
    node.focus();
  }
  function activeIndex() {
    var items = visibleItems();
    for (var i = 0; i < items.length; i++) {
      if (items[i].getAttribute("data-active") === "true" || items[i] === root.activeElement) return i;
    }
    return -1;
  }
  function isOpen() { return pcRoot.classList.contains("pop-open"); }

  function openPop() {
    if (pcRoot.getAttribute("data-mode") === "newVersion") return; // no menu in alert state
    pcRoot.classList.add("pop-open");
    elTrigger.setAttribute("aria-expanded", "true");
    focusItem(0);
  }
  function closePop(refocus) {
    if (!isOpen()) { elTrigger.setAttribute("aria-expanded", "false"); return; }
    pcRoot.classList.remove("pop-open");
    elTrigger.setAttribute("aria-expanded", "false");
    clearActive();
    if (refocus !== false) elTrigger.focus();
  }
  function togglePop() { if (isOpen()) closePop(); else openPop(); }

  elTrigger.addEventListener("click", function (e) {
    e.preventDefault(); e.stopPropagation();
    togglePop();
  });
  elTrigger.addEventListener("keydown", function (e) {
    if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      if (pcRoot.getAttribute("data-mode") === "newVersion") return;
      e.preventDefault();
      openPop();
      if (e.key === "ArrowUp") focusItem(visibleItems().length - 1);
      else focusItem(0);
    }
  });
  elMenu.addEventListener("keydown", function (e) {
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); focusItem(activeIndex() + 1); break;
      case "ArrowUp":   e.preventDefault(); focusItem(activeIndex() - 1); break;
      case "Home":      e.preventDefault(); focusItem(0); break;
      case "End":       e.preventDefault(); focusItem(visibleItems().length - 1); break;
      case "Escape":    e.preventDefault(); closePop(true); break;
      case "Tab":       closePop(false); break;
      case "Enter":
      case " ":
        e.preventDefault();
        var items = visibleItems();
        var idx = activeIndex();
        if (idx >= 0 && items[idx]) items[idx].click();
        break;
    }
  });
  var jsItems = elMenu.querySelectorAll(".js-item");
  for (var ji = 0; ji < jsItems.length; ji++) {
    (function (node) {
      node.addEventListener("mousemove", function () {
        if (node.getAttribute("data-active") === "true") return;
        clearActive();
        node.setAttribute("data-active", "true");
      });
      node.addEventListener("click", function (e) {
        var action = node.getAttribute("data-action");
        if (action === "hide")    { e.preventDefault(); closePop(false); setCollapsed(true); return; }
        if (action === "signin")  { e.preventDefault(); closePop(false); signIn(); return; }
        if (action === "signout") { e.preventDefault(); closePop(false); signOut(); return; }
        // "session" is a real top-level <a target=_top>; let it navigate.
        closePop(false);
      });
    })(jsItems[ji]);
  }

  // click-outside: closed shadow retargets the event to the host, so detect
  // "outside" by the absence of the host node in the composed path.
  document.addEventListener("click", function (e) {
    if (isOpen() && e.composedPath && e.composedPath().indexOf(host) === -1) {
      closePop(false);
    }
  });
  // global Esc safety net
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && isOpen()) closePop(true);
  });

  // bead click restores the last expanded mode
  elBead.addEventListener("click", function () { setCollapsed(false); });
  // alert Reload loads the pending version
  elReload.addEventListener("click", function (e) {
    e.preventDefault();
    reloadFrame(pendingVersion != null ? pendingVersion : undefined);
  });

  function arrive(node) {
    node.classList.remove("pc-arrive");
    void node.offsetWidth; // restart the single cue
    node.classList.add("pc-arrive");
  }

  // Track the previously applied mode so we only play the arrival cue on change.
  var lastAppliedMode = null;
  var lastCollapsed = null;

  // ----- applyState: compute mode, set attributes, update dynamic text ------
  function render() { applyState(); }
  function applyState() {
    var mode = hasPending ? "newVersion" : (me && me.login ? "signedIn" : "signedOut");

    // version text (resting pill + menu status line)
    elVtag.textContent = "v" + VERSION;
    // pending version on the alert line
    elAlertV.textContent = "v" + (pendingVersion != null ? pendingVersion : VERSION);

    // identity in the menu header + signed-in pip on the pill
    if (me && me.login) {
      elIdName.textContent = me.login;
      elIdSub.textContent = "Live · v" + VERSION + " · signed in";
      // avatar (menu) + pip (pill): use the GitHub <img> when present, else fallback gradient
      if (me.avatarUrl) {
        setAvatar(elIdAvatar, me.avatarUrl);
        setAvatar(elPip, me.avatarUrl);
      } else {
        clearAvatar(elIdAvatar);
        clearAvatar(elPip);
      }
    } else {
      elIdName.textContent = "protocontent";
      elIdSub.textContent = "Live · v" + VERSION + " · not signed in";
      clearAvatar(elPip);
    }

    // session-index item: a real top-level link; hidden entirely when no index
    if (indexUrl) {
      elSession.setAttribute("href", indexUrl);
      pcRoot.setAttribute("data-has-index", "true");
    } else {
      pcRoot.setAttribute("data-has-index", "false");
    }

    // bead alert dot when an update waits
    if (hasPending) elBead.classList.add("alert");
    else elBead.classList.remove("alert");
    elBead.setAttribute("aria-label", hasPending
      ? "protocontent — new version available. Expand badge."
      : "protocontent — expand badge.");

    // trigger aria-label reflects live version
    elTrigger.setAttribute("aria-label", "protocontent — live, version " + VERSION + ". Open account menu.");

    // mode switch: if leaving a menu-bearing mode, close the menu first
    if (mode === "newVersion" && isOpen()) closePop(false);
    pcRoot.setAttribute("data-mode", mode);
    pcRoot.setAttribute("data-collapsed", collapsed ? "true" : "false");

    // single arrival cue, only on transition into the relevant state
    if (!collapsed && mode === "newVersion" && lastAppliedMode !== "newVersion") arrive(elAlert);
    if (collapsed && lastCollapsed !== true) arrive(elBead);

    lastAppliedMode = mode;
    lastCollapsed = collapsed;
  }

  // avatar helpers: inject a GitHub <img> (CSP img-src already allows the
  // avatars origin); the src is server/host data, set via setAttribute.
  function setAvatar(slot, url) {
    var img = slot.querySelector("img");
    if (!img) {
      img = document.createElement("img");
      img.setAttribute("alt", "");
      slot.appendChild(img);
    }
    img.setAttribute("src", url);
  }
  function clearAvatar(slot) {
    var img = slot.querySelector("img");
    if (img) slot.removeChild(img);
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
