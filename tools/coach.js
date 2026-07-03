/* The Instructor — client. Injected on EVERY page by header.js.
   Builds an amber dock chip → right slide-over drawer with streaming chat, and
   mounts the same UI full-width when a page has #coachFullPage (coach.html).
   Classic script, no modules. Talks to the local sidecar at /api/coach.

   Sessions: many conversations, one JSON per session on the server. The current
   id lives in localStorage 'coachSession'. The drawer swaps between a CHAT view
   and a SESSIONS view; the full page adds a persistent sidebar with the same list.

   Public surface:
     window.WoodshedCoach.open(extra)  — open the drawer; extra merges into the
                                          next message context (e.g. {take}).
     CustomEvent('coach:open', {detail})— same as open(detail); if detail.take,
                                          the input is prefilled 'Debrief this take.'
   Tools may also set window.__coachTake before opening. */
(function () {
  if (window.__coachInit) return; window.__coachInit = true;

  var FULL = document.getElementById('coachFullPage');
  var streaming = false;
  var pendingExtra = null;   // context merged into the next send (from open(extra)/coach:open)

  // ---- session state (shared across every mounted UI) ----
  var sessionId = '';
  try { sessionId = localStorage.getItem('coachSession') || ''; } catch (e) {}
  var sessionList = [];          // [{id,title,created,updated,count,preview}]
  var sessionTitle = '';         // title of the active session ('' or 'New session' → show 'The Instructor')
  var sessionsLoaded = false;    // have we fetched the list once?
  var drafts = {};               // in-memory draft text per session id
  var mountedUIs = [];           // every live UI (drawer + full) — kept in sync

  // ---- lucide-style icons (stroke, currentColor) ----
  var IC_MSG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>';
  var IC_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  var IC_SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>';
  var IC_NEW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>';
  var IC_POP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>';
  var IC_TOOL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4l-6 6 2.7 2.7 6-6a4 4 0 0 0 5.4-5.4l-2.4 2.4-2.7-2.7Z"/></svg>';
  var IC_MIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>';
  var IC_STOP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
  var IC_HISTORY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/></svg>';
  var IC_BACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>';
  var IC_PENCIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  var IC_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
  var IC_COPY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  var IC_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
  var IC_DOWN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>';
  var IC_MENU = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
  var IC_CAMERA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"/><circle cx="12" cy="13" r="3"/></svg>';
  var IC_CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

  // ---- the Woodshed pick mark (shared silhouette; chip-size + avatar-size) ----
  // One plectrum path (fat shoulders, point down) rendered at two scales. The chip
  // (46×52) already inlines its own; this powers the coach-message avatar and can
  // render any size on the same silhouette.
  var PICK_PATH = 'M23 50 C18 50 4 34 2 22 C0 10 8 2 23 2 C38 2 46 10 44 22 C42 34 28 50 23 50Z';
  function pickSvg(w, h, fill, stroke, textFill, fontSize, strokeW) {
    return '<svg viewBox="0 0 46 52" width="' + w + '" height="' + h + '" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="display:block;overflow:visible">'
      + '<path d="' + PICK_PATH + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + (strokeW || 1.5) + '" stroke-linejoin="round"/>'
      + '<text x="23" y="27" text-anchor="middle" dominant-baseline="middle" font-family="var(--font-display),Georgia,serif" font-size="' + (fontSize || 18) + '" font-weight="600" fill="' + textFill + '">W</text>'
      + '</svg>';
  }

  // ---- styles (theme tokens; scoped under .wsc-*) ----
  function injectStyles() {
    if (document.getElementById('wsc-style')) return;
    var s = document.createElement('style'); s.id = 'wsc-style';
    s.textContent =
      /* guitar-pick chip — plectrum silhouette, point down */
      '.wsc-chip{position:fixed;right:20px;bottom:20px;width:46px;height:52px;border-radius:0;'
      + 'background:none;border:none;cursor:pointer;'
      + 'display:inline-flex;align-items:center;justify-content:center;z-index:9998;'
      + 'padding:0;transition:transform .15s ease,filter .15s ease;'
      + 'filter:drop-shadow(0 3px 7px hsl(26 30% 8%/.32))}'
      + '.wsc-chip:hover{transform:translateY(-1px) rotate(-4deg);filter:drop-shadow(0 5px 9px hsl(26 30% 8%/.38))}'
      + '.wsc-chip svg{width:46px;height:52px;display:block;overflow:visible}'
      + '.wsc-scrim{position:fixed;inset:0;background:hsl(26 30% 6%/.42);z-index:9998;opacity:0;pointer-events:none;transition:opacity .2s ease}'
      + '.wsc-scrim.open{opacity:1;pointer-events:auto}'
      + '.wsc-drawer{position:fixed;top:0;right:0;height:100%;width:min(420px,100vw);background:var(--panel);'
      + 'border-left:1px solid var(--line);box-shadow:var(--shadow-md);z-index:9999;display:flex;flex-direction:column;'
      + 'transform:translateX(100%);transition:transform .24s cubic-bezier(.4,0,.2,1)}'
      + '.wsc-drawer.open{transform:translateX(0)}'
      // shared surface (drawer + full page share .wsc-panel guts)
      + '.wsc-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:16px 18px 12px;border-bottom:1px solid var(--line);flex:none}'
      // drawer header is a two-row stack: title row, then a quiet action strip
      + '.wsc-head.drawer{flex-direction:column;align-items:stretch;gap:8px;padding:14px 16px 10px}'
      + '.wsc-head-row{display:flex;align-items:center;gap:10px;min-width:0}'
      + '.wsc-kicker{font-family:var(--font-ui);font-size:.62rem;font-weight:650;letter-spacing:.15em;text-transform:uppercase;color:hsl(var(--brand-strong));margin:0 0 3px}'
      + '.wsc-title{font-family:var(--font-display);font-weight:580;font-size:1.2rem;line-height:1.1;margin:0;max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:default;text-transform:none}'
      + '.wsc-head.drawer .wsc-title{flex:1 1 auto;max-width:none}'
      // quiet action strip (row 2, drawer): 30px controls
      + '.wsc-strip{display:flex;align-items:center;gap:6px}'
      + '.wsc-strip .wsc-spacer{flex:1 1 auto}'
      + '.wsc-newbtn{display:inline-flex;align-items:center;gap:5px;height:30px;padding:0 10px;border-radius:8px;border:1px solid var(--line);background:var(--panel2);color:var(--ink);cursor:pointer;font-family:var(--font-ui);font-size:.78rem;font-weight:600;transition:.15s;white-space:nowrap}'
      + '.wsc-newbtn:hover{border-color:var(--accent);color:var(--accent)}'
      + '.wsc-newbtn svg{width:14px;height:14px;display:block;flex:none}'
      + '.wsc-sbtn30{width:30px;height:30px;border-radius:8px;border:1px solid var(--line);background:var(--panel2);color:var(--ink);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0;transition:.15s}'
      + '.wsc-sbtn30:hover{border-color:var(--accent);color:var(--accent)}'
      + '.wsc-sbtn30 svg{width:15px;height:15px;display:block}'
      // model pill (drawer) + popover menu
      + '.wsc-mpill{position:relative;display:inline-flex;align-items:center;gap:4px;height:30px;padding:0 8px 0 11px;border-radius:8px;border:1px solid var(--line);background:var(--panel2);color:var(--ink);cursor:pointer;font-family:var(--font-ui);font-size:.78rem;transition:.15s;white-space:nowrap}'
      + '.wsc-mpill:hover{border-color:var(--accent);color:var(--accent)}'
      + '.wsc-mpill svg{width:13px;height:13px;display:block;flex:none;opacity:.8}'
      + '.wsc-mwrap{position:relative;display:inline-flex}'
      + '.wsc-mpop{position:absolute;top:calc(100% + 5px);right:0;z-index:20;min-width:240px;background:var(--panel);border:1px solid var(--line);border-radius:10px;box-shadow:var(--shadow-md);padding:5px;display:none;flex-direction:column;gap:1px}'
      + '.wsc-mpop.open{display:flex}'
      + '.wsc-mopt{display:flex;flex-direction:column;gap:1px;text-align:left;border:1px solid transparent;background:none;color:var(--ink);border-radius:7px;padding:7px 9px;cursor:pointer;font-family:var(--font-ui);transition:.12s}'
      + '.wsc-mopt:hover{background:var(--panel2)}'
      + '.wsc-mopt.sel{border-color:hsl(var(--brand)/.5);background:hsl(var(--brand)/.07)}'
      + '.wsc-mopt-name{font-size:.84rem;font-weight:600;display:flex;align-items:center;gap:6px}'
      + '.wsc-mopt-name svg{width:13px;height:13px;color:var(--accent)}'
      + '.wsc-mopt-desc{font-size:.72rem;color:var(--muted);line-height:1.3}'
      + '.wsc-title.editable{cursor:text}'
      + '.wsc-title-in{font-family:var(--font-display);font-weight:580;font-size:1.2rem;line-height:1.1;margin:0;background:var(--panel2);border:1px solid var(--accent);border-radius:6px;color:var(--ink);padding:1px 6px;max-width:230px}'
      + '.wsc-title-in:focus{outline:none}'
      + '.wsc-acts{display:flex;gap:6px;align-items:center}'
      + '.wsc-knob{display:inline-flex;flex-direction:column;align-items:center;gap:1px;background:none;border:none;cursor:pointer;padding:2px 4px;border-radius:8px;transition:.15s}'
      + '.wsc-knob:hover{background:var(--panel2)}'
      + '.wsc-knob svg{display:block;min-width:0;max-width:none;width:26px;height:26px}'
      + '.wsc-knob-label{font-size:8.5px;letter-spacing:.04em;color:var(--muted);white-space:nowrap;line-height:1}'
      + '.wsc-ibtn{width:32px;height:32px;border-radius:8px;border:1px solid var(--line);background:var(--panel2);color:var(--ink);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0;transition:.15s}'
      + '.wsc-ibtn:hover{border-color:var(--accent);color:var(--accent)}'
      + '.wsc-ibtn svg{width:15px;height:15px;display:block}'
      // body wrapper holds chat-view + sessions-view stacked; only one visible
      + '.wsc-body{flex:1 1 auto;position:relative;overflow:hidden;display:flex;min-height:0}'
      + '.wsc-view{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;min-height:0}'
      + '.wsc-view[hidden]{display:none}'
      + '.wsc-log{flex:1 1 auto;overflow-y:auto;padding:16px 18px;display:flex;flex-direction:column;gap:12px;position:relative}'
      + '.wsc-row{display:flex;flex-direction:column;gap:12px}'
      // message-enter animation — applied only on append, not on history render
      + '@keyframes wsc-enter{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}'
      + '.wsc-enter{animation:wsc-enter .2s ease-out both}'
      // a coach turn gets a monogram medallion outside the bubble
      + '.wsc-turn{display:flex;gap:9px;align-items:flex-start;max-width:100%}'
      + '.wsc-turn.user{justify-content:flex-end}'
      + '.wsc-mono{flex:none;width:18px;height:20px;display:flex;align-items:center;justify-content:center;line-height:1;margin-top:2px;filter:drop-shadow(0 1px 2px hsl(26 30% 8%/.28))}'
      + '.wsc-mono svg{width:18px;height:20px;display:block}'
      + '.wsc-bwrap{position:relative;max-width:88%;min-width:0}'
      // break-word (not anywhere): 'anywhere' collapses min-content width, so short
      // one-word replies shrank to a sliver and broke mid-word ("PO/NG")
      + '.wsc-msg{padding:10px 13px;border-radius:12px;font-size:.9rem;line-height:1.55;white-space:pre-wrap;overflow-wrap:break-word;min-width:2.5em}'
      + '.wsc-turn.user .wsc-msg{background:hsl(var(--brand)/.14);border:1px solid hsl(var(--brand)/.4);border-bottom-right-radius:4px}'
      + '.wsc-turn.coach .wsc-msg{background:var(--panel2);border:1px solid var(--line);border-bottom-left-radius:4px;white-space:normal}'
      + '.wsc-copy{position:absolute;top:2px;right:2px;width:24px;height:24px;border-radius:6px;border:1px solid var(--line);background:var(--panel);color:var(--muted);cursor:pointer;display:none;align-items:center;justify-content:center;padding:0;transition:.15s}'
      + '.wsc-turn.coach:hover .wsc-copy{display:inline-flex}'
      + '.wsc-copy:hover{border-color:var(--accent);color:var(--accent)}'
      + '.wsc-copy svg{width:13px;height:13px;display:block}'
      + '.wsc-copy.ok{color:var(--good);border-color:var(--good);display:inline-flex}'
      // day separator
      + '.wsc-day{align-self:center;font-size:.68rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);display:flex;align-items:center;gap:8px;width:100%;justify-content:center;margin:2px 0}'
      + '.wsc-day::before,.wsc-day::after{content:"";height:1px;background:var(--line);flex:1 1 auto;max-width:80px}'
      // markdown blocks inside a coach bubble
      + '.wsc-msg .wsc-pre{background:hsl(26 30% 6%/.28);border:1px solid var(--line);border-radius:8px;padding:9px 11px;margin:6px 0;overflow-x:auto;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.82rem;line-height:1.45;white-space:pre}'
      + '.wsc-msg ul,.wsc-msg ol{margin:6px 0;padding-left:20px}'
      + '.wsc-msg li{margin:2px 0}'
      + '.wsc-msg .wsc-h{display:block;font-weight:650;margin:8px 0 3px;font-family:var(--font-display)}'
      + '.wsc-msg .wsc-quote{border-left:3px solid hsl(var(--brand)/.5);padding:2px 0 2px 10px;margin:5px 0;color:var(--muted)}'
      + '.wsc-msg .wsc-table{border-collapse:collapse;margin:8px 0;font-size:.84rem;width:100%;display:block;overflow-x:auto}'
      + '.wsc-msg .wsc-table th,.wsc-msg .wsc-table td{border:1px solid var(--line);padding:5px 9px;text-align:left;vertical-align:top}'
      + '.wsc-msg .wsc-table th{background:hsl(var(--brand)/.1);font-weight:650;white-space:nowrap}'
      + '.wsc-msg .wsc-table tr:nth-child(even) td{background:hsl(var(--muted-foreground)/.05)}'
      + '.wsc-msg code{background:hsl(26 30% 6%/.24);border-radius:4px;padding:.5px 4px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.85em}'
      + '.wsc-tool{align-self:flex-start;font-size:.74rem;color:var(--muted);display:inline-flex;align-items:center;gap:6px;padding:2px 2px;transition:opacity .3s ease}'
      + '.wsc-tool svg{width:13px;height:13px;opacity:.8;flex:none}'
      + '.wsc-tool.spent{opacity:.6}'
      + '.wsc-empty{color:var(--muted);font-size:.88rem;line-height:1.6;margin:auto 0;text-align:center;padding:0 12px}'
      + '.wsc-err{align-self:stretch;color:var(--bad);font-size:.82rem;border:1px solid hsl(var(--destructive)/.4);background:hsl(var(--destructive)/.08);border-radius:8px;padding:8px 11px}'
      + '.wsc-stopped{align-self:center;color:var(--muted);font-size:.76rem;font-style:italic;padding:2px}'
      // thinking indicator (three dots)
      + '.wsc-think{align-self:flex-start;display:inline-flex;gap:4px;padding:12px 14px;background:var(--panel2);border:1px solid var(--line);border-radius:12px;border-bottom-left-radius:4px}'
      + '.wsc-think span{width:6px;height:6px;border-radius:50%;background:var(--muted);animation:wsc-think 1.2s ease-in-out infinite}'
      + '.wsc-think span:nth-child(2){animation-delay:.18s}.wsc-think span:nth-child(3){animation-delay:.36s}'
      + '@keyframes wsc-think{0%,80%,100%{opacity:.3;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}'
      // jump-to-latest pill
      + '.wsc-jump{position:absolute;left:50%;transform:translateX(-50%);bottom:12px;z-index:5;border:1px solid var(--accent);background:var(--panel);color:var(--accent);border-radius:999px;padding:5px 12px;font-family:var(--font-ui);font-size:.78rem;cursor:pointer;display:none;align-items:center;gap:5px;box-shadow:var(--shadow-md);transition:.15s}'
      + '.wsc-jump.show{display:inline-flex}'
      + '.wsc-jump:hover{filter:brightness(1.04)}'
      + '.wsc-jump svg{width:13px;height:13px;display:block}'
      + '.wsc-foot{border-top:1px solid var(--line);padding:12px 14px calc(12px + env(safe-area-inset-bottom));display:flex;gap:8px;align-items:flex-end;flex:none}'
      + '.wsc-foot-knob{flex:none;display:inline-flex;align-items:center}'
      + '.wsc-ta{flex:1 1 auto;resize:none;background:var(--panel2);color:var(--ink);border:1px solid var(--line);border-radius:10px;'
      + 'padding:10px 12px;font-family:var(--font-ui);font-size:.9rem;line-height:1.4;max-height:140px;min-height:42px}'
      + '.wsc-ta:focus{outline:none;border-color:var(--accent)}'
      + '.wsc-send{flex:none;width:42px;height:42px;border-radius:10px;border:none;background:var(--accent);color:#1a1407;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0;transition:.15s}'
      + '.wsc-send:hover{filter:brightness(1.05)}'
      + '.wsc-send:disabled{opacity:.5;cursor:default}'
      + '.wsc-send svg{width:18px;height:18px;display:block}'
      + '.wsc-send.stop{background:var(--panel2);border:1px solid var(--accent);color:var(--accent)}'
      // mic button (left of the textarea) + recording state
      + '.wsc-mic{flex:none;height:42px;min-width:42px;padding:0 10px;border-radius:10px;border:1px solid var(--line);background:var(--panel2);color:var(--ink);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;transition:.15s;font-family:var(--font-ui);font-size:.82rem;font-variant-numeric:tabular-nums}'
      + '.wsc-mic:hover{border-color:var(--accent);color:var(--accent)}'
      + '.wsc-mic:disabled{opacity:.5;cursor:default}'
      + '.wsc-mic svg{width:18px;height:18px;display:block;flex:none}'
      + '.wsc-mic.rec{border-color:var(--accent);color:var(--accent);animation:wsc-pulse 1.3s ease-in-out infinite}'
      + '@keyframes wsc-pulse{0%,100%{box-shadow:0 0 0 0 hsl(var(--brand)/.5)}50%{box-shadow:0 0 0 5px hsl(var(--brand)/0)}}'
      // camera button (footer, right of mic)
      + '.wsc-cam{flex:none;width:42px;height:42px;border-radius:10px;border:1px solid var(--line);background:var(--panel2);color:var(--ink);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:.15s}'
      + '.wsc-cam:hover{border-color:var(--accent);color:var(--accent)}'
      + '.wsc-cam:disabled{opacity:.5;cursor:default}'
      + '.wsc-cam.armed{border-color:var(--accent);color:var(--accent)}'
      + '.wsc-cam svg{width:18px;height:18px;display:block}'
      // pending-image thumbnail chip (sits above the footer)
      + '.wsc-thumbrow{border-top:1px solid var(--line);padding:8px 14px 0;display:flex;flex:none}'
      + '.wsc-thumb{position:relative;display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line);background:var(--panel2);border-radius:10px;padding:5px 8px 5px 5px}'
      + '.wsc-thumb img{width:40px;height:40px;object-fit:cover;border-radius:7px;display:block}'
      + '.wsc-thumb-meta{font-size:.72rem;color:var(--muted);line-height:1.3;max-width:150px}'
      + '.wsc-thumb-x{width:22px;height:22px;border-radius:6px;border:1px solid var(--line);background:var(--panel);color:var(--muted);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0;transition:.15s}'
      + '.wsc-thumb-x:hover{border-color:var(--bad);color:var(--bad)}'
      + '.wsc-thumb-x svg{width:12px;height:12px;display:block}'
      // image bubble in a sent user turn
      + '.wsc-msgimg{max-width:200px;max-height:200px;border-radius:9px;display:block;margin:0 0 6px}'
      // quick-action chips under the empty prompt
      + '.wsc-chips{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:14px}'
      + '.wsc-qchip{border:1px solid var(--line);background:var(--panel2);color:var(--ink);border-radius:999px;padding:7px 13px;font-family:var(--font-ui);font-size:.82rem;cursor:pointer;transition:.15s}'
      + '.wsc-qchip:hover{border-color:var(--accent);color:var(--accent)}'
      // ---- sessions list (shared: drawer view + full sidebar) ----
      + '.wsc-slist{flex:1 1 auto;overflow-y:auto;padding:12px 12px 16px;display:flex;flex-direction:column;gap:2px}'
      + '.wsc-newrow{display:flex;align-items:center;gap:8px;width:100%;text-align:left;border:1px solid var(--accent);background:hsl(var(--brand)/.1);color:hsl(var(--brand-strong));border-radius:10px;padding:10px 12px;cursor:pointer;font-family:var(--font-ui);font-size:.88rem;font-weight:600;transition:.15s;margin-bottom:8px}'
      + '.wsc-newrow:hover{background:hsl(var(--brand)/.16)}'
      + '.wsc-newrow svg{width:16px;height:16px;flex:none}'
      + '.wsc-group{font-size:.62rem;font-weight:650;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);padding:10px 6px 4px}'
      + '.wsc-srow{position:relative;display:flex;align-items:center;gap:8px;width:100%;text-align:left;border:1px solid transparent;background:none;color:var(--ink);border-radius:9px;padding:9px 10px;cursor:pointer;font-family:var(--font-ui);transition:.12s}'
      + '.wsc-srow:hover{background:var(--panel2)}'
      + '.wsc-srow.active{border-color:hsl(var(--brand)/.5);background:hsl(var(--brand)/.07)}'
      + '.wsc-srow.active::before{content:"";position:absolute;left:0;top:8px;bottom:8px;width:2.5px;border-radius:2px;background:var(--accent)}'
      + '.wsc-smeta{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px}'
      + '.wsc-stitle{font-size:.86rem;line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
      + '.wsc-ssub{font-size:.7rem;color:var(--muted);display:flex;gap:6px}'
      + '.wsc-srename{flex:1 1 auto;min-width:0;background:var(--panel);border:1px solid var(--accent);border-radius:6px;color:var(--ink);font-family:var(--font-ui);font-size:.86rem;padding:4px 7px}'
      + '.wsc-srename:focus{outline:none}'
      + '.wsc-srow-acts{display:none;gap:2px;flex:none}'
      + '.wsc-srow:hover .wsc-srow-acts,.wsc-srow:focus-within .wsc-srow-acts{display:inline-flex}'
      + '.wsc-sbtn{width:26px;height:26px;border-radius:6px;border:none;background:none;color:var(--muted);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0;transition:.12s}'
      + '.wsc-sbtn:hover{background:var(--panel);color:var(--accent)}'
      + '.wsc-sbtn.del:hover{color:var(--bad)}'
      + '.wsc-sbtn svg{width:14px;height:14px;display:block}'
      + '.wsc-sbtn.confirm{width:auto;padding:0 8px;font-size:.72rem;color:var(--bad);font-family:var(--font-ui)}'
      + '.wsc-sempty{color:var(--muted);font-size:.82rem;text-align:center;padding:20px 12px;line-height:1.5}'
      // full-page variant with sidebar
      // fills its container (coach.html + session.html both give a bounded flex/grid
      // height), so the chat runs the full height of the window instead of a fixed cap
      + '.wsc-full{display:flex;flex-direction:row;height:100%;min-height:420px;background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:hidden;position:relative}'
      + '.wsc-side{flex:none;width:260px;border-right:1px solid var(--line);display:flex;flex-direction:column;background:var(--panel);min-height:0;overflow:hidden}'
      + '.wsc-side-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:14px 14px 8px;flex:none}'
      + '.wsc-side-head .wsc-kicker{margin:0}'
      + '.wsc-collapse{flex:none;width:26px;height:26px;border-radius:7px;border:1px solid var(--line);background:var(--panel);color:var(--muted);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0;transition:.15s}'
      + '.wsc-collapse:hover{border-color:hsl(var(--brand)/.6);color:var(--ink)}'
      + '.wsc-collapse svg{width:15px;height:15px;stroke:currentColor;stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round}'
      + '.wsc-main{flex:1 1 auto;display:flex;flex-direction:column;min-width:0;min-height:0}'
      + '.wsc-full .wsc-drawer-only{display:none}'
      + '.wsc-hamb{display:none}'
      // wide screens: the sidebar collapses to nothing, hamburger reappears to reopen
      + '@media(min-width:721px){'
      + '.wsc-side{transition:width .2s ease}'
      + '.wsc-full.side-collapsed .wsc-side{width:0;min-width:0;flex-basis:0;border-right:0}'
      + '.wsc-full.side-collapsed .wsc-hamb{display:inline-flex}'
      + '}'
      // narrow: the sidebar is an off-canvas overlay toggled by the hamburger.
      // The OPEN state is the base rule; the HIDE rule carries the extra specificity
      // (:not(.side-open)) so "open" is never contested — robust cascade either way.
      + '@media(max-width:720px){'
      + '.wsc-side{position:absolute;top:0;bottom:0;left:0;z-index:6;width:260px;transition:left .2s ease;box-shadow:var(--shadow-md)}'
      + '.wsc-full:not(.side-open) .wsc-side{left:-268px;box-shadow:none}'
      + '.wsc-collapse{display:none}'
      + '.wsc-hamb{display:inline-flex}'
      + '}'
      + '@media(max-width:480px){.wsc-chip{right:14px;bottom:14px}}';
    document.head.appendChild(s);
  }

  // ---- context capture ----
  function captureContext() {
    var stats = null;
    if (typeof Stats !== 'undefined') {
      try {
        var days = Stats.recentDays(1);
        stats = {
          today: (days && days[0]) ? days[0] : null,
          streak: Stats.streakDays(),
          weakEar: Stats.weakKeys('ear-trainer'),
          weakFret: Stats.weakKeys('fretboard-trainer'),
          due: (Stats.review ? Stats.review.due() : [])
        };
      } catch (e) { stats = null; }
    }
    var ctx = {
      page: location.pathname,
      title: document.title,
      stats: stats,
      take: (window.__coachTake || null)
    };
    if (pendingExtra) { for (var k in pendingExtra) ctx[k] = pendingExtra[k]; }
    return ctx;
  }

  // ---- small DOM helpers ----
  function el(cls, html) { var d = document.createElement('div'); d.className = cls; if (html != null) d.innerHTML = html; return d; }
  function textNode(cls, text) { var d = document.createElement('div'); d.className = cls; d.textContent = text; return d; }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // =====================================================================
  //  MARKDOWN — escape-first, streaming-safe (tolerates unterminated fences)
  // =====================================================================
  function mdInline(s) {
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    s = s.replace(/(^|[^"(>])(https?:\/\/[^\s<]+)/g, function (_, pre, url) {
      var trail = ''; var mTrail = url.match(/[.,;:!?)]+$/); if (mTrail) { trail = mTrail[0]; url = url.slice(0, -trail.length); }
      return pre + '<a href="' + url + '" target="_blank" rel="noopener">' + url + '</a>' + trail;
    });
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    return s;
  }
  function md(text) {
    var src = String(text == null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // split on fenced code blocks first, so their contents skip inline parsing.
    // an unterminated opening fence (mid-stream) still renders as a <pre>.
    var out = '';
    var parts = src.split(/```/);
    for (var i = 0; i < parts.length; i++) {
      if (i % 2 === 1) {
        // inside a fence — strip an optional bare language token on the first line
        var firstNl = parts[i].indexOf('\n');
        var head = firstNl >= 0 ? parts[i].slice(0, firstNl) : parts[i];
        var rest = firstNl >= 0 ? parts[i].slice(firstNl + 1) : '';
        var code = (firstNl >= 0 && /^[a-z0-9+#._-]{0,15}$/i.test(head.trim())) ? rest : parts[i];
        out += '<pre class="wsc-pre">' + code.replace(/\n$/, '') + '</pre>';
      } else {
        out += mdBlocks(parts[i]);
      }
    }
    return out;
  }
  // block-level parsing on a fence-free segment: lists, headings, blockquotes, breaks
  function mdBlocks(seg) {
    var lines = seg.split('\n');
    var html = '';
    var listType = null;   // 'ul' | 'ol' | null
    function closeList() { if (listType) { html += '</' + listType + '>'; listType = null; } }
    // a GFM table: a header row containing '|' followed by a |---|:--:| separator row
    function isSep(l) { return l.indexOf('|') >= 0 && /-/.test(l) && /^[\s|:-]+$/.test(l); }
    function cells(l) { return l.trim().replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim(); }); }
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.indexOf('|') >= 0 && i + 1 < lines.length && isSep(lines[i + 1])) {
        closeList();
        var head = cells(line), rows = [], j = i + 2;
        while (j < lines.length && lines[j].indexOf('|') >= 0 && lines[j].trim() !== '') { rows.push(cells(lines[j])); j++; }
        html += '<table class="wsc-table"><thead><tr>' +
          head.map(function (c) { return '<th>' + mdInline(c) + '</th>'; }).join('') +
          '</tr></thead><tbody>' +
          rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + mdInline(c) + '</td>'; }).join('') + '</tr>'; }).join('') +
          '</tbody></table>';
        i = j - 1;
        continue;
      }
      var ul = line.match(/^\s*[-•]\s+(.*)$/);
      var ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
      var h = line.match(/^\s*#{1,4}\s+(.*)$/);
      var q = line.match(/^\s*>\s?(.*)$/);
      if (ul) {
        if (listType !== 'ul') { closeList(); html += '<ul>'; listType = 'ul'; }
        html += '<li>' + mdInline(ul[1]) + '</li>';
      } else if (ol) {
        if (listType !== 'ol') { closeList(); html += '<ol>'; listType = 'ol'; }
        html += '<li>' + mdInline(ol[1]) + '</li>';
      } else if (h) {
        closeList(); html += '<span class="wsc-h">' + mdInline(h[1]) + '</span>';
      } else if (q) {
        closeList(); html += '<span class="wsc-quote">' + mdInline(q[1]) + '</span>';
      } else {
        closeList();
        html += mdInline(line);
        if (i < lines.length - 1) html += '<br>';
      }
    }
    closeList();
    return html;
  }

  // =====================================================================
  //  TIME helpers
  // =====================================================================
  function relTime(ms) {
    if (!ms) return '';
    var d = Date.now() - ms;
    if (d < 60000) return 'just now';
    var m = Math.floor(d / 60000); if (m < 60) return m + 'm ago';
    var h = Math.floor(m / 60); if (h < 24) return h + 'h ago';
    var days = Math.floor(h / 24); if (days < 7) return days + 'd ago';
    var w = Math.floor(days / 7); if (w < 5) return w + 'w ago';
    return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function dayKey(ms) { var d = new Date(ms); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  function dayLabel(ms) {
    var d = new Date(ms), n = new Date();
    var startOf = function (x) { return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); };
    var diff = Math.round((startOf(n) - startOf(d)) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  }
  // recency bucket for grouping the session list by `updated`
  function bucketOf(ms) {
    var d = new Date(ms), n = new Date();
    var startOf = function (x) { return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); };
    var diff = Math.round((startOf(n) - startOf(d)) / 86400000);
    if (diff <= 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff <= 7) return 'This week';
    return 'Older';
  }
  var BUCKET_ORDER = ['Today', 'Yesterday', 'This week', 'Older'];

  // =====================================================================
  //  MESSAGE RENDERING (chat log)
  // =====================================================================
  function scrollToBottom(ui, smooth) {
    ui.log.scrollTo ? ui.log.scrollTo({ top: ui.log.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }) : (ui.log.scrollTop = ui.log.scrollHeight);
  }
  function isNearBottom(ui) { return (ui.log.scrollHeight - ui.log.scrollTop - ui.log.clientHeight) <= 80; }
  function maybeScroll(ui) { if (ui.nearBottom) scrollToBottom(ui, false); else showJump(ui); }
  function showJump(ui) { if (ui.jump) ui.jump.classList.add('show'); }
  function hideJump(ui) { if (ui.jump) ui.jump.classList.remove('show'); }

  function hideEmpty(ui) { if (ui.empty && ui.empty.parentNode) ui.empty.parentNode.removeChild(ui.empty); ui.empty = null; }

  // insert a day separator when a message's day differs from the previous one
  function maybeDaySep(ui, ts) {
    if (!ts) return;
    var k = dayKey(ts);
    if (ui.lastDay === k) return;
    ui.lastDay = k;
    var sep = textNode('wsc-day', dayLabel(ts));
    ui.log.appendChild(sep);
  }

  function addMsg(ui, role, text, ts, animate, imageUrl) {
    hideEmpty(ui);
    maybeDaySep(ui, ts);
    var turn = el('wsc-turn ' + (role === 'user' ? 'user' : 'coach'));
    if (animate) turn.classList.add('wsc-enter');
    if (role === 'coach') {
      var mono = document.createElement('div'); mono.className = 'wsc-mono'; mono.setAttribute('aria-hidden', 'true');
      // mini pick avatar — panel fill, amber stroke, serif W (shared silhouette)
      mono.innerHTML = pickSvg(18, 20, 'var(--panel)', 'hsl(var(--brand))', 'hsl(var(--brand))', 15, 1.5);
      turn.appendChild(mono);
    }
    var bwrap = el('wsc-bwrap');
    var m = document.createElement('div'); m.className = 'wsc-msg';
    if (role === 'coach') { m.innerHTML = md(text); }
    else {
      // a sent photo renders as a thumbnail above the text
      if (imageUrl) { var im = document.createElement('img'); im.className = 'wsc-msgimg'; im.src = imageUrl; im.alt = 'Attached photo'; m.appendChild(im); }
      if (text) { var tn = document.createElement('span'); tn.textContent = text; m.appendChild(tn); }
    }
    if (ts) turn.title = new Date(ts).toLocaleString();
    bwrap.appendChild(m);
    if (role === 'coach') {
      var cp = document.createElement('button'); cp.type = 'button'; cp.className = 'wsc-copy'; cp.innerHTML = IC_COPY; cp.title = 'Copy'; cp.setAttribute('aria-label', 'Copy message');
      cp.addEventListener('click', function () { copyText(cp, m._plain != null ? m._plain : m.textContent); });
      bwrap.appendChild(cp);
    }
    turn.appendChild(bwrap);
    ui.log.appendChild(turn);
    maybeScroll(ui);
    return m;   // the bubble; streaming updates .innerHTML on it
  }
  function copyText(btn, text) {
    var done = function () { btn.classList.add('ok'); btn.innerHTML = IC_CHECK; setTimeout(function () { btn.classList.remove('ok'); btn.innerHTML = IC_COPY; }, 1200); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, function () {}); return; }
    } catch (e) {}
    try { var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); done(); } catch (e) {}
  }

  // friendly tool status lines: verb + icon + optional path/name
  var TOOL_VERBS = {
    read_file: function (n) { return n ? 'reading ' + n : 'reading a file'; },
    list_files: function (n) { return n ? 'browsing ' + n : 'browsing files'; },
    write_file: function (n) { return n ? 'writing ' + n : 'writing a file'; },
    web_search: function () { return 'searching the web'; },
    add_resource: function () { return 'saving to your library'; },
    update_memory: function () { return 'making a note'; },
    set_pref: function () { return 'adjusting a tool'; },
    schedule_review: function () { return "updating tomorrow's bench"; },
    complete_review: function () { return "updating tomorrow's bench"; },
    start_practice_session: function () { return 'setting up your session'; },
    upload: function () { return 'saving your take'; }
  };
  function addTool(ui, name, detail) {
    hideEmpty(ui);
    var fn = TOOL_VERBS[name];
    var label = fn ? fn(detail) : (name + (detail ? ' ' + detail : ''));
    var t = el('wsc-tool wsc-enter', IC_TOOL + '<span>' + escapeHtml(label) + '…</span>');
    ui.log.appendChild(t); maybeScroll(ui);
    ui.toolLines.push(t);
    return t;
  }
  // a plain status line (no tool framing) — used by the record → analyze flow
  function addStatus(ui, text) { hideEmpty(ui); var t = el('wsc-tool wsc-enter', IC_MIC + '<span>' + escapeHtml(text) + '</span>'); ui.log.appendChild(t); maybeScroll(ui); return t; }
  function addErr(ui, msg) { var e = textNode('wsc-err wsc-enter', msg); ui.log.appendChild(e); maybeScroll(ui); }

  // thinking indicator (three-dot bubble) shown until the first token
  function showThinking(ui) {
    if (ui.think) return;
    hideEmpty(ui);
    var t = el('wsc-think', '<span></span><span></span><span></span>');
    t.setAttribute('aria-label', 'The Instructor is thinking');
    ui.log.appendChild(t); ui.think = t; maybeScroll(ui);
  }
  function hideThinking(ui) { if (ui.think && ui.think.parentNode) ui.think.parentNode.removeChild(ui.think); ui.think = null; }

  function clearLog(ui) {
    while (ui.log.firstChild) ui.log.removeChild(ui.log.firstChild);
    ui.think = null; ui.toolLines = []; ui.lastDay = null;
  }

  // =====================================================================
  //  QUICK CHIPS (shown on any empty session)
  // =====================================================================
  var QUICK_CHIPS = [
    'Plan today’s session',
    'What’s due today?',
    'Find me a lesson on what’s weakest'
  ];
  function showEmpty(ui, msg) {
    clearLog(ui);
    ui.empty = textNode('wsc-empty', msg || 'Ask about today’s plan, a take you just recorded, or a technique that keeps breaking down. The Instructor sees this page and your recent stats.');
    ui.log.appendChild(ui.empty);
    renderChips(ui);
  }
  function renderChips(ui) {
    if (!ui.empty || !ui.empty.parentNode) return;
    if (ui.chips && ui.chips.parentNode) ui.chips.parentNode.removeChild(ui.chips);
    var box = el('wsc-chips');
    QUICK_CHIPS.forEach(function (label) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'wsc-qchip'; b.textContent = label;
      b.addEventListener('click', function () {
        if (streaming) return;
        ui.ta.value = label; updateSendState(ui);
        doSend(ui);
      });
      box.appendChild(b);
    });
    ui.empty.appendChild(box);
    ui.chips = box;
  }

  // =====================================================================
  //  HISTORY RENDER (a loaded session)
  // =====================================================================
  function renderHistory(ui, messages) {
    clearLog(ui);
    if (!messages || !messages.length) { showEmpty(ui, ui.freshMsg || undefined); return; }
    ui.empty = null;
    messages.forEach(function (m) { addMsg(ui, m.role === 'user' ? 'user' : 'coach', m.text, m.ts); });
    ui.nearBottom = true; scrollToBottom(ui, false);
  }

  // =====================================================================
  //  CLIENT BRIDGE (unchanged behavior)
  // =====================================================================
  function applyClientAction(evt) {
    try {
      // the guided-session strip owns no Stats dependency for startup — handle it first
      if (evt.action === 'practice_session') { startPracticeSession(evt.steps); return }
      if (typeof Stats === 'undefined') return
      if (evt.action === 'setPref') Stats.setPref(evt.tool, evt.key, evt.value)
      else if (evt.action === 'scheduleReview' && Stats.review) Stats.review.add(evt.tool, evt.key, { note: evt.note })
      else if (evt.action === 'completeReview' && Stats.review) Stats.review.complete(evt.tool, evt.key, !!evt.pass)
    } catch (e) { /* never break the stream over a bridge action */ }
  }

  // =====================================================================
  //  GUIDED SESSION STRIP ("Practice with me")
  //  A small floating strip (fixed bottom-center, above the save bar) that walks
  //  the student through timed steps. State persists in localStorage so the strip
  //  survives navigation between tool pages (coach.js loads on every page). Timer
  //  chimes softly + auto-advances at each step's end; on finish it clears state,
  //  records a coach activity, and shows a one-line summary toast.
  // =====================================================================
  var PS_KEY = 'wscPracticeSession';   // { steps:[{tool,title,minutes,note}], cur, stepStartedAt, running }
  var psTimer = null, psEl = null;

  function psLoad() {
    try { var d = JSON.parse(localStorage.getItem(PS_KEY) || 'null'); return (d && Array.isArray(d.steps) && d.steps.length) ? d : null; }
    catch (e) { return null; }
  }
  function psSave(state) { try { localStorage.setItem(PS_KEY, JSON.stringify(state)); } catch (e) {} }
  function psClear() { try { localStorage.removeItem(PS_KEY); } catch (e) {} }

  function psInjectStyles() {
    if (document.getElementById('wsc-ps-style')) return;
    var s = document.createElement('style'); s.id = 'wsc-ps-style';
    s.textContent =
      '.wsc-ps{position:fixed;left:50%;bottom:16px;transform:translateX(-50%) translateY(8px);z-index:70;'
      + 'display:flex;align-items:center;gap:12px;max-width:min(560px,calc(100vw - 24px));'
      + 'background:hsl(26 30% 10%/.97);color:hsl(38 30% 92%);border:1px solid hsl(38 35% 30%);'
      + 'border-radius:12px;padding:9px 12px;box-shadow:0 8px 24px hsl(26 30% 4%/.5);'
      + 'font-family:var(--font-ui),Inter,system-ui,sans-serif;font-size:.8rem;line-height:1.25;'
      + 'opacity:0;transition:opacity .2s ease,transform .2s ease}'
      + '.wsc-ps.show{opacity:1;transform:translateX(-50%) translateY(0)}'
      + '.wsc-ps-num{flex:none;font-size:.66rem;letter-spacing:.05em;color:hsl(38 30% 62%);white-space:nowrap}'
      + '.wsc-ps-mid{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1 1 auto}'
      + '.wsc-ps-title{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:hsl(40 35% 94%)}'
      + '.wsc-ps-note{font-size:.7rem;color:hsl(38 22% 66%);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
      + '.wsc-ps-time{flex:none;font-variant-numeric:tabular-nums;font-weight:600;font-size:.92rem;color:hsl(40 90% 62%);min-width:44px;text-align:right}'
      + '.wsc-ps-open{flex:none;text-decoration:none;border:1px solid hsl(40 90% 55%/.55);color:hsl(40 90% 62%);'
      + 'border-radius:8px;padding:4px 9px;font-size:.74rem;font-weight:600;white-space:nowrap;transition:.15s}'
      + '.wsc-ps-open:hover{background:hsl(40 90% 55%/.14)}'
      + '.wsc-ps-btn{flex:none;border:1px solid hsl(38 35% 30%);background:hsl(26 30% 14%);color:hsl(38 30% 82%);'
      + 'border-radius:8px;padding:4px 8px;font-size:.72rem;cursor:pointer;transition:.15s;white-space:nowrap}'
      + '.wsc-ps-btn:hover{border-color:hsl(40 90% 55%);color:hsl(40 90% 62%)}'
      + '.wsc-ps-ic{display:inline-flex;align-items:center;justify-content:center;padding:4px 6px;text-decoration:none;line-height:0}'
      // min/max pinned: tool pages set global svg{width:100%;min-width:560px} for their fretboards
      + '.wsc-ps-ic svg{width:14px;height:14px;min-width:14px;max-width:14px;min-height:14px;max-height:14px;stroke:currentColor;stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round;display:block}'
      + '.wsc-ps-end{color:hsl(38 22% 60%)}'
      + '.wsc-ps-toast{position:fixed;left:50%;bottom:16px;transform:translateX(-50%) translateY(8px);z-index:70;'
      + 'background:hsl(26 30% 10%/.97);color:hsl(40 35% 92%);border:1px solid hsl(40 90% 55%/.5);border-radius:12px;'
      + 'padding:10px 16px;font-family:var(--font-ui),Inter,system-ui,sans-serif;font-size:.82rem;'
      + 'box-shadow:0 8px 24px hsl(26 30% 4%/.5);opacity:0;transition:opacity .25s ease,transform .25s ease}'
      + '.wsc-ps-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}';
    document.head.appendChild(s);
  }

  // soft WebAudio chime at a step boundary
  function psChime() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      var ac = new AC();
      var o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine'; o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.15, ac.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.5);
      o.connect(g); g.connect(ac.destination);
      o.start(); o.stop(ac.currentTime + 0.55);
      setTimeout(function () { try { ac.close(); } catch (e) {} }, 800);
    } catch (e) {}
  }

  function fmtCountdown(sec) {
    if (sec < 0) sec = 0;
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + String(s).padStart(2, '0');
  }

  // start a fresh session (from the coach client bridge)
  function startPracticeSession(steps) {
    if (!Array.isArray(steps) || !steps.length) return;
    var clean = steps.slice(0, 5).map(function (s) {
      return { tool: String((s && s.tool) || 'chat'), title: String((s && s.title) || 'Practice'),
        minutes: Math.max(1, Math.min(60, Math.round(Number(s && s.minutes) || 5))), note: String((s && s.note) || '') };
    });
    // baseline snapshot: today's per-tool tallies AT START, so this encounter's
    // numbers are deltas — tool pages resume mid-session, and a second session
    // the same day starts clean (Stats.session reads against this).
    var baseline = {};
    try { if (typeof Stats !== 'undefined' && Stats.sessionBaseline) baseline = Stats.sessionBaseline(); } catch (e) {}
    psSave({ steps: clean, cur: 0, stepStartedAt: Date.now(), startedAt: Date.now(), running: true,
      coachSessionId: sessionId || '', baseline: baseline });
    renderPracticeStrip();
  }

  // (re)build + tick the strip from persisted state; called on boot and on start
  function renderPracticeStrip() {
    var state = psLoad();
    if (psTimer) { clearInterval(psTimer); psTimer = null; }
    if (psEl && psEl.parentNode) { psEl.parentNode.removeChild(psEl); psEl = null; }
    if (!state || !state.running) return;
    if (state.cur >= state.steps.length) { finishPracticeSession(state); return; }
    psInjectStyles();

    psEl = document.createElement('div'); psEl.className = 'wsc-ps'; psEl.setAttribute('role', 'status'); psEl.setAttribute('aria-live', 'polite');
    var step = state.steps[state.cur];
    var num = document.createElement('span'); num.className = 'wsc-ps-num'; num.textContent = 'Step ' + (state.cur + 1) + '/' + state.steps.length;
    var mid = document.createElement('div'); mid.className = 'wsc-ps-mid';
    var title = document.createElement('span'); title.className = 'wsc-ps-title'; title.textContent = step.title;
    mid.appendChild(title);
    if (step.note) { var note = document.createElement('span'); note.className = 'wsc-ps-note'; note.textContent = step.note; mid.appendChild(note); }
    var time = document.createElement('span'); time.className = 'wsc-ps-time';
    // inline-pinned icon size: immune to page CSS (tool pages set global
    // svg{width:100%;min-width:560px} for fretboards) AND to a stale cached
    // stylesheet — the dimensions travel with the markup itself.
    var PS_IC_CSS = 'width:14px;height:14px;min-width:14px;max-width:14px;min-height:14px;max-height:14px;display:block';
    var here = (location.pathname.split('/').pop() || '');
    // one click back to the bench: on a tool page, a small home-to-session link
    if (here !== 'session.html') {
      var bench = document.createElement('a'); bench.className = 'wsc-ps-btn wsc-ps-ic'; bench.href = 'session.html';
      bench.title = 'Back to your session'; bench.setAttribute('aria-label', 'Back to the session view');
      bench.innerHTML = '<svg viewBox="0 0 24 24" style="' + PS_IC_CSS + '"><path d="m11 17-5-5 5-5"/><path d="M18 19V5a1 1 0 0 0-1-1h-4"/><path d="M6 12h12"/></svg>';
      psEl.appendChild(bench);
    }
    psEl.appendChild(num); psEl.appendChild(mid); psEl.appendChild(time);

    // timer controls: restart this step (rewind) + play/pause toggle — icons, like a transport
    var restartBtn = document.createElement('button'); restartBtn.type = 'button'; restartBtn.className = 'wsc-ps-btn wsc-ps-ic';
    restartBtn.title = 'Restart this step'; restartBtn.setAttribute('aria-label', 'Restart this step\'s timer');
    restartBtn.innerHTML = '<svg viewBox="0 0 24 24" style="' + PS_IC_CSS + '"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>';
    restartBtn.addEventListener('click', function () { restartPracticeStep(); });
    psEl.appendChild(restartBtn);
    var pauseBtn = document.createElement('button'); pauseBtn.type = 'button'; pauseBtn.className = 'wsc-ps-btn wsc-ps-ic';
    pauseBtn.title = state.paused ? 'Resume' : 'Pause';
    pauseBtn.setAttribute('aria-label', state.paused ? 'Resume the timer' : 'Pause the timer');
    pauseBtn.innerHTML = state.paused
      ? '<svg viewBox="0 0 24 24" style="' + PS_IC_CSS + '"><polygon points="7 4 19 12 7 20 7 4" fill="currentColor" stroke="none"/></svg>'
      : '<svg viewBox="0 0 24 24" style="' + PS_IC_CSS + '"><rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/></svg>';
    pauseBtn.addEventListener('click', function () { togglePausePracticeSession(); });
    psEl.appendChild(pauseBtn);

    // Open-tool link — plain navigation to the step's page (unless it's a chat-only step)
    if (step.tool && step.tool !== 'chat' && here !== step.tool) {
      var open = document.createElement('a'); open.className = 'wsc-ps-open'; open.href = step.tool; open.textContent = 'Open tool';
      psEl.appendChild(open);
    }
    var prevBtn = document.createElement('button'); prevBtn.type = 'button'; prevBtn.className = 'wsc-ps-btn';
    prevBtn.textContent = 'Back'; prevBtn.disabled = state.cur <= 0;
    prevBtn.setAttribute('aria-label', 'Previous step');
    prevBtn.addEventListener('click', function () { gotoPracticeStep(state.cur - 1); });
    psEl.appendChild(prevBtn);
    var nextBtn = document.createElement('button'); nextBtn.type = 'button'; nextBtn.className = 'wsc-ps-btn';
    nextBtn.textContent = (state.cur >= state.steps.length - 1) ? 'Finish' : 'Next';
    nextBtn.addEventListener('click', function () { advancePracticeSession(); });
    var endBtn = document.createElement('button'); endBtn.type = 'button'; endBtn.className = 'wsc-ps-btn wsc-ps-end'; endBtn.textContent = 'End';
    endBtn.title = 'End session'; endBtn.setAttribute('aria-label', 'End practice session');
    endBtn.addEventListener('click', function () { endPracticeSession(); });
    psEl.appendChild(nextBtn); psEl.appendChild(endBtn);

    document.body.appendChild(psEl);
    requestAnimationFrame(function () { if (psEl) psEl.classList.add('show'); });

    function tick() {
      var st = psLoad(); if (!st || !st.running) { renderPracticeStrip(); return; }
      var total = st.steps[st.cur].minutes * 60;
      // while paused the clock reads as of the pause moment — frozen, dimmed
      var asOf = (st.paused && st.pausedAt) ? st.pausedAt : Date.now();
      var left = total - Math.floor((asOf - st.stepStartedAt) / 1000);
      time.textContent = fmtCountdown(left);   // the play/pause icon carries the paused state
      time.style.opacity = st.paused ? '.55' : '';
      if (!st.paused && left <= 0) { psChime(); advancePracticeSession(); }
    }
    tick();
    psTimer = setInterval(tick, 1000);
  }

  // rewind: reset the current step's countdown to the top (also resumes if paused)
  function restartPracticeStep() {
    var state = psLoad(); if (!state || !state.running) return;
    settlePause(state);
    state.stepStartedAt = Date.now();
    psSave(state);
    renderPracticeStrip();
  }

  function togglePausePracticeSession() {
    var state = psLoad(); if (!state || !state.running) return;
    if (state.paused) {
      // resume: shift the step clock forward by the pause span; bank it for the record
      var span = Date.now() - (state.pausedAt || Date.now());
      state.stepStartedAt += span;
      state.pausedMs = (state.pausedMs || 0) + span;
      state.paused = false; delete state.pausedAt;
    } else {
      state.paused = true; state.pausedAt = Date.now();
    }
    psSave(state);
    renderPracticeStrip();
  }
  // fold a live pause into the banked total (used before recording/judging duration)
  function settlePause(state) {
    if (state && state.paused && state.pausedAt) {
      state.pausedMs = (state.pausedMs || 0) + (Date.now() - state.pausedAt);
      state.paused = false; delete state.pausedAt;
    }
    return state;
  }

  function advancePracticeSession() {
    var state = psLoad(); if (!state) return;
    settlePause(state);                                // Next while paused banks the pause + resumes
    if (state.steps[state.cur]) state.steps[state.cur].done = true;  // advancing past a step completes it
    state.cur += 1; state.stepStartedAt = Date.now();
    if (state.cur >= state.steps.length) { finishPracticeSession(state); return; }
    psSave(state);
    renderPracticeStrip();
  }

  // jump the strip to any step (back or forward) — drives the tool-preview bar; the
  // session page calls this when the student clicks a plan row.
  function gotoPracticeStep(idx) {
    var state = psLoad(); if (!state || !state.running) return;
    idx = Math.max(0, Math.min(state.steps.length - 1, idx | 0));
    if (idx === state.cur) return;
    settlePause(state);                                // jumping to a step resumes the clock
    state.cur = idx; state.stepStartedAt = Date.now();
    psSave(state);
    renderPracticeStrip();
    document.dispatchEvent(new CustomEvent('wsc:practicestep', { detail: { cur: idx } }));
  }

  function endPracticeSession() {
    var state = settlePause(psLoad());
    if (psTimer) { clearInterval(psTimer); psTimer = null; }
    if (psEl && psEl.parentNode) { psEl.parentNode.removeChild(psEl); psEl = null; }
    psClear();
    // an early End still writes the partial record — unless it was a false start
    // (<2 min of ACTIVE time; paused minutes don't count toward being a session)
    if (state && state.startedAt && (Date.now() - state.startedAt - (state.pausedMs || 0)) >= 2 * 60 * 1000) {
      var rec = buildSessionRecord(state);
      postSessionRecord(rec);
      showSessionCeremony(rec);
    }
  }

  function finishPracticeSession(state) {
    state = settlePause(state);
    if (psTimer) { clearInterval(psTimer); psTimer = null; }
    if (psEl && psEl.parentNode) { psEl.parentNode.removeChild(psEl); psEl = null; }
    psClear();
    try { if (typeof Stats !== 'undefined' && Stats.activity) Stats.activity('coach'); } catch (e) {}
    psChime();
    var rec = buildSessionRecord(state);
    postSessionRecord(rec);          // record first (upsert by id), grade amends after
    showSessionCeremony(rec);
  }

  // =====================================================================
  //  SESSION RECORDS — every guided sitting becomes a durable record in
  //  student/sessions.json (via /api/sessions; upsert by id, so the grade
  //  ceremony amends the same record it just wrote).
  // =====================================================================
  function buildSessionRecord(state) {
    var now = Date.now(), started = (state && state.startedAt) || now;
    var d = new Date(started);
    var p2 = function (n) { return String(n).padStart(2, '0'); };
    var date = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
    var rec = {
      id: 's-' + date.replace(/-/g, '') + '-' + p2(d.getHours()) + p2(d.getMinutes()),
      date: date, startedAt: started, endedAt: now,
      // paused time doesn't count as practice
      minutes: Math.max(1, Math.min(600, Math.round((now - started - ((state && state.pausedMs) || 0)) / 60000))),
      source: 'guided', phase: '',
      steps: ((state && state.steps) || []).map(function (s) {
        return { tool: s.tool, title: s.title, minutes: s.minutes, completed: !!s.done };
      }),
      toolStats: sessionToolStats(state)
    };
    if (state && state.coachSessionId) rec.coachSessionId = state.coachSessionId;
    return rec;
  }
  // digest THIS ENCOUNTER's numbers for the tools this session touched:
  // today's tallies minus the baseline snapped at session start, so two
  // sessions in one day each carry their own numbers.
  function sessionToolStats(state) {
    var out = {};
    try {
      if (typeof Stats === 'undefined' || !Stats.recentDays) return out;
      var day = (Stats.recentDays(1)[0] || {}).data || {};
      var base = (state && state.baseline) || {};
      var bases = ((state && state.steps) || []).map(function (s) { return String(s.tool).replace(/\.html$/, ''); });
      Object.keys(day).forEach(function (key) {
        var hit = bases.some(function (b) { return b.indexOf(key) === 0 || key.indexOf(b) === 0; });
        if (!hit) return;
        var r = day[key] || {}, b = base[key] || {}, dig = {};
        var count = (r.answered || 0) - (b.answered || 0);
        var correct = (r.correct || 0) - (b.correct || 0);
        var events = (r.events || 0) - (b.events || 0);
        if (count > 0) { dig.count = count; dig.correct = Math.max(0, correct); }
        if (events > 0) dig.events = events;
        if (Object.keys(dig).length) out[key] = dig;
      });
    } catch (e) {}
    return out;
  }
  var SQ_KEY = 'wscSessionQueue';
  var sqChain = Promise.resolve();   // serialize posts so a grade amend can never lose to its own record
  function postSessionRecord(rec) {
    sqChain = sqChain.then(function () { return postSessionRecordNow(rec); });
    return sqChain;
  }
  function postSessionRecordNow(rec) {
    // stamp the plan phase in (best-effort, async), then send
    return fetch('../student/current-plan.json').then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (plan) {
        if (plan && plan.phase) rec.phase = String(plan.phase).slice(0, 200);
        return fetch('/api/sessions', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rec)
        });
      })
      .then(function (r) {
        if (!r || !r.ok) throw new Error('post failed');
        try { document.dispatchEvent(new CustomEvent('wsc:sessionrecorded', { detail: rec })); } catch (e) {}
      })
      .catch(function () {
        // offline / file:// — queue it; flushed on next script load
        try {
          var q = JSON.parse(localStorage.getItem(SQ_KEY) || '[]');
          q = q.filter(function (r) { return r.id !== rec.id; }); q.push(rec);
          localStorage.setItem(SQ_KEY, JSON.stringify(q.slice(-30)));
        } catch (e) {}
      });
  }
  function flushSessionQueue() {
    var q; try { q = JSON.parse(localStorage.getItem(SQ_KEY) || '[]'); } catch (e) { q = []; }
    if (!q.length) return;
    fetch('/api/sessions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessions: q })
    }).then(function (r) {
      if (r.ok) { try { localStorage.removeItem(SQ_KEY); } catch (e) {} document.dispatchEvent(new CustomEvent('wsc:sessionrecorded', { detail: null })); }
    }).catch(function () {});
  }

  // the closing ritual: duration + steps, one tap to grade, optional note
  function showSessionCeremony(rec) {
    psInjectStyles();
    var doneN = rec.steps.filter(function (s) { return s.completed; }).length;
    var card = document.createElement('div'); card.className = 'wsc-ps wsc-ceremony show'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'Session complete');
    card.style.cssText = 'flex-direction:column;align-items:stretch;gap:8px;max-width:min(430px,calc(100vw - 24px))';
    card.innerHTML =
      '<div style="display:flex;align-items:baseline;gap:10px"><b style="font-size:.92rem;color:hsl(40 35% 94%)">Session done — ' + rec.minutes + ' min</b>' +
      '<span style="color:hsl(38 22% 66%)">' + doneN + '/' + rec.steps.length + ' steps</span></div>' +
      '<div style="display:flex;gap:6px" class="wsc-cer-grades">' +
        ['Nailed it', 'Solid', 'Rough'].map(function (g) {
          return '<button type="button" class="wsc-ps-btn" data-grade="' + g + '" style="flex:1">' + g + '</button>';
        }).join('') + '</div>' +
      '<input class="wsc-cer-note" placeholder="one-line note (optional) — e.g. gate stuck at 56" style="background:hsl(26 30% 14%);border:1px solid hsl(38 35% 30%);border-radius:8px;color:inherit;font:inherit;font-size:.78rem;padding:6px 9px">' +
      '<div style="display:flex;gap:6px;justify-content:flex-end"><button type="button" class="wsc-ps-btn wsc-ps-end" data-act="skip">Skip</button>' +
      '<button type="button" class="wsc-ps-btn" data-act="save" style="border-color:hsl(40 90% 55%);color:hsl(40 90% 62%)">Save</button></div>';
    document.body.appendChild(card);
    var grade = '';
    card.querySelectorAll('[data-grade]').forEach(function (b) {
      b.addEventListener('click', function () {
        grade = b.dataset.grade;
        card.querySelectorAll('[data-grade]').forEach(function (x) { x.style.background = ''; x.style.borderColor = ''; });
        b.style.background = 'hsl(40 90% 55%/.16)'; b.style.borderColor = 'hsl(40 90% 55%)';
      });
    });
    function close() { if (card.parentNode) card.parentNode.removeChild(card); }
    card.querySelector('[data-act="skip"]').addEventListener('click', close);
    card.querySelector('[data-act="save"]').addEventListener('click', function () {
      var note = card.querySelector('.wsc-cer-note').value.trim().slice(0, 500);
      if (grade) rec.grade = grade;
      if (note) rec.note = note;
      if (grade || note) postSessionRecord(rec);   // same id → upsert amends
      close();
      psToast('Logged. Nice work.');
    });
    setTimeout(function () { if (card.parentNode) close(); }, 90 * 1000);  // don't haunt the page
  }

  function psToast(text) {
    psInjectStyles();
    var t = document.createElement('div'); t.className = 'wsc-ps-toast'; t.setAttribute('role', 'status'); t.textContent = text;
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });
    setTimeout(function () { t.classList.remove('show'); setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 300); }, 4200);
  }

  // =====================================================================
  //  MODEL KNOB (amp-style) — unchanged
  // =====================================================================
  var COACH_MODELS = [
    ['claude-sonnet-4-6', 'Sonnet 4.6', 'The everyday coach — quick and sharp'],
    ['claude-opus-4-6', 'Opus 4.6', 'More headroom'],
    ['claude-opus-4-7', 'Opus 4.7', 'Deep listening'],
    ['claude-opus-4-8', 'Opus 4.8', 'The master class'],
  ]
  function getModelIdx() {
    var saved = ''
    try { saved = localStorage.getItem('coachModel') || '' } catch (e) {}
    var i = COACH_MODELS.findIndex(function (m) { return m[0] === saved })
    return i >= 0 ? i : 0
  }
  function makeKnob(onChange) {
    var wrap = document.createElement('button')
    wrap.type = 'button'; wrap.className = 'wsc-knob'
    var idx = getModelIdx()
    function draw() {
      idx = getModelIdx()
      var m = COACH_MODELS[idx]
      var angle = -135 + (270 / (COACH_MODELS.length - 1)) * idx
      var ticks = COACH_MODELS.map(function (_, i) {
        var a = (-135 + (270 / (COACH_MODELS.length - 1)) * i) * Math.PI / 180
        var x1 = 15 + Math.sin(a) * 12.5, y1 = 15 - Math.cos(a) * 12.5
        var x2 = 15 + Math.sin(a) * 14.5, y2 = 15 - Math.cos(a) * 14.5
        return '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '" stroke="' + (i === idx ? 'hsl(var(--brand))' : 'var(--muted)') + '" stroke-width="1.6" stroke-linecap="round" opacity="' + (i === idx ? '1' : '.55') + '"/>'
      }).join('')
      wrap.innerHTML =
        '<svg viewBox="0 0 30 30" width="26" height="26" aria-hidden="true">' + ticks +
        '<circle cx="15" cy="15" r="10.5" fill="var(--panel2)" stroke="hsl(38 35% 42%)" stroke-width="1.4"/>' +
        '<line x1="15" y1="15" x2="' + (15 + Math.sin(angle * Math.PI / 180) * 8).toFixed(1) + '" y2="' + (15 - Math.cos(angle * Math.PI / 180) * 8).toFixed(1) + '" stroke="hsl(var(--brand))" stroke-width="2.4" stroke-linecap="round"/>' +
        '</svg><span class="wsc-knob-label">' + m[1] + '</span>'
      wrap.title = 'Coach model: ' + m[1] + ' — ' + m[2] + ' (click to switch)'
      wrap.setAttribute('aria-label', wrap.title)
    }
    wrap.addEventListener('click', function () {
      idx = (getModelIdx() + 1) % COACH_MODELS.length
      try { localStorage.setItem('coachModel', COACH_MODELS[idx][0]) } catch (e) {}
      draw()
      modelPills.forEach(function (p) { p.redraw(); })
      if (onChange) onChange()
    })
    draw()
    wrap._redraw = draw
    return wrap
  }
  function currentModel() { return COACH_MODELS[getModelIdx()][0] }

  // model selection as a readable pill + compact popover (drawer header).
  // Every mounted pill re-renders its label when the choice changes.
  var modelPills = [];   // {label, redraw}
  function setModel(idx) {
    if (idx < 0 || idx >= COACH_MODELS.length) return;
    try { localStorage.setItem('coachModel', COACH_MODELS[idx][0]); } catch (e) {}
    modelPills.forEach(function (p) { p.redraw(); });
    mountedUIs.forEach(function (u) { if (u.knobRedraw) u.knobRedraw(); });
  }
  function makeModelPill() {
    var wrap = document.createElement('div'); wrap.className = 'wsc-mwrap';
    var pill = document.createElement('button'); pill.type = 'button'; pill.className = 'wsc-mpill';
    var label = document.createElement('span');
    var pop = document.createElement('div'); pop.className = 'wsc-mpop'; pop.setAttribute('role', 'menu');
    function redraw() {
      var m = COACH_MODELS[getModelIdx()];
      label.textContent = m[1];
      pill.title = 'Coach model: ' + m[1] + ' — ' + m[2] + ' (click to switch)';
      pill.setAttribute('aria-label', pill.title);
      // repaint option rows' selection state
      Array.prototype.forEach.call(pop.children, function (opt, i) {
        opt.classList.toggle('sel', i === getModelIdx());
        var tick = opt.querySelector('.wsc-mopt-tick');
        if (tick) tick.innerHTML = (i === getModelIdx()) ? IC_CHECK : '';
      });
    }
    pill.innerHTML = ''; pill.appendChild(label);
    var chev = document.createElement('span'); chev.innerHTML = IC_CHEV; pill.appendChild(chev);
    COACH_MODELS.forEach(function (m, i) {
      var opt = document.createElement('button'); opt.type = 'button'; opt.className = 'wsc-mopt'; opt.setAttribute('role', 'menuitem');
      opt.innerHTML = '<span class="wsc-mopt-name"><span class="wsc-mopt-tick"></span>' + escapeHtml(m[1]) + '</span>'
        + '<span class="wsc-mopt-desc">' + escapeHtml(m[2]) + '</span>';
      opt.addEventListener('click', function (e) { e.stopPropagation(); setModel(i); closePop(); });
      pop.appendChild(opt);
    });
    function openPop() { pop.classList.add('open'); document.addEventListener('click', onDoc, true); }
    function closePop() { pop.classList.remove('open'); document.removeEventListener('click', onDoc, true); }
    function onDoc(e) { if (!wrap.contains(e.target)) closePop(); }
    pill.addEventListener('click', function (e) { e.stopPropagation(); if (pop.classList.contains('open')) closePop(); else openPop(); });
    wrap.appendChild(pill); wrap.appendChild(pop);
    redraw();
    modelPills.push({ redraw: redraw });
    return wrap;
  }

  // =====================================================================
  //  SESSIONS API
  // =====================================================================
  function apiListSessions() {
    return fetch('/api/coach/sessions').then(function (r) { return r.json(); }).then(function (d) {
      sessionList = (d && d.sessions) || []; return sessionList;
    });
  }
  function apiCreateSession() {
    return fetch('/api/coach/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(function (r) { return r.json(); });
  }
  function apiLoadSession(id) {
    return fetch('/api/coach/sessions/' + encodeURIComponent(id)).then(function (r) { return r.ok ? r.json() : null; });
  }
  function apiRenameSession(id, title) {
    return fetch('/api/coach/sessions/' + encodeURIComponent(id), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title })
    }).then(function (r) { return r.ok ? r.json() : null; });
  }
  function apiDeleteSession(id) {
    return fetch('/api/coach/sessions/' + encodeURIComponent(id), { method: 'DELETE' }).then(function (r) { return r.ok; });
  }

  function setActiveSession(id, title) {
    sessionId = id || '';
    sessionTitle = title || '';
    try { if (sessionId) localStorage.setItem('coachSession', sessionId); } catch (e) {}
    mountedUIs.forEach(applyTitle);
    refreshSessionLists();
  }
  // reflect the active session's title in each UI header (drawer title line + full header)
  function applyTitle(ui) {
    var t = (sessionTitle && sessionTitle !== 'New session') ? sessionTitle : 'The Instructor';
    if (ui.titleEl) { ui.titleEl.textContent = t; ui.titleEl.title = t; }
  }

  // update one session summary in the local list (title/updated), keeping sort by updated
  function bumpSession(id, patch) {
    var found = null;
    for (var i = 0; i < sessionList.length; i++) { if (sessionList[i].id === id) { found = sessionList[i]; break; } }
    if (!found) { found = { id: id, title: 'New session', created: Date.now(), updated: Date.now(), count: 0, preview: '' }; sessionList.push(found); }
    if (patch) for (var k in patch) found[k] = patch[k];
    sessionList.sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); });
    refreshSessionLists();
  }

  // =====================================================================
  //  SESSIONS LIST RENDER (built once, mounted twice)
  // =====================================================================
  var sessionListMounts = [];   // {node, ui} — every place the grouped list lives
  function refreshSessionLists() { sessionListMounts.forEach(function (mnt) { renderSessionList(mnt.node, mnt.ui); }); }

  function renderSessionList(node, ui) {
    while (node.firstChild) node.removeChild(node.firstChild);
    // New session primary row
    var nb = document.createElement('button'); nb.type = 'button'; nb.className = 'wsc-newrow';
    nb.innerHTML = IC_NEW + '<span>New session</span>'; nb.setAttribute('aria-label', 'New session');
    nb.addEventListener('click', function () { newSession(ui); });
    node.appendChild(nb);

    if (!sessionList.length) {
      node.appendChild(textNode('wsc-sempty', 'No conversations yet. Start one and it lands here.'));
      return;
    }
    var groups = {}; BUCKET_ORDER.forEach(function (b) { groups[b] = []; });
    sessionList.forEach(function (s) { (groups[bucketOf(s.updated)] || groups.Older).push(s); });
    BUCKET_ORDER.forEach(function (bucket) {
      var rows = groups[bucket];
      if (!rows.length) return;
      node.appendChild(textNode('wsc-group', bucket));
      rows.forEach(function (s) { node.appendChild(sessionRow(s, ui)); });
    });
  }

  function sessionRow(s, ui) {
    var row = document.createElement('button'); row.type = 'button';
    row.className = 'wsc-srow' + (s.id === sessionId ? ' active' : '');
    if (s.id === sessionId) row.setAttribute('aria-current', 'true');

    var meta = el('wsc-smeta');
    var title = textNode('wsc-stitle', s.title || 'Untitled');
    title.title = s.title || '';
    var sub = el('wsc-ssub');
    sub.innerHTML = '<span>' + escapeHtml(relTime(s.updated)) + '</span>' + (s.count ? '<span>· ' + s.count + '</span>' : '');
    meta.appendChild(title); meta.appendChild(sub);

    var acts = el('wsc-srow-acts');
    var pen = document.createElement('button'); pen.type = 'button'; pen.className = 'wsc-sbtn'; pen.innerHTML = IC_PENCIL; pen.title = 'Rename'; pen.setAttribute('aria-label', 'Rename session');
    var del = document.createElement('button'); del.type = 'button'; del.className = 'wsc-sbtn del'; del.innerHTML = IC_TRASH; del.title = 'Delete'; del.setAttribute('aria-label', 'Delete session');
    acts.appendChild(pen); acts.appendChild(del);

    row.appendChild(meta); row.appendChild(acts);

    row.addEventListener('click', function () { openSession(ui, s.id); });

    // inline rename
    pen.addEventListener('click', function (e) {
      e.stopPropagation();
      var input = document.createElement('input'); input.type = 'text'; input.className = 'wsc-srename'; input.value = s.title || '';
      input.setAttribute('aria-label', 'Session title');
      row.replaceChild(input, meta);
      acts.style.display = 'none';
      input.focus(); input.select();
      var commit = function (save) {
        if (save) {
          var v = input.value.trim().slice(0, 80);
          if (v && v !== s.title) {
            apiRenameSession(s.id, v).then(function (r) {
              if (r && r.ok) { s.title = r.title; if (s.id === sessionId) setActiveSession(sessionId, r.title); }
              refreshSessionLists();
            });
            return;
          }
        }
        refreshSessionLists();
      };
      input.addEventListener('click', function (ev) { ev.stopPropagation(); });
      input.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); commit(true); }
        else if (ev.key === 'Escape') { ev.preventDefault(); commit(false); }
      });
      input.addEventListener('blur', function () { commit(true); });
    });

    // inline two-tap delete confirm (never window.confirm)
    del.addEventListener('click', function (e) {
      e.stopPropagation();
      var confirmBtn = document.createElement('button'); confirmBtn.type = 'button'; confirmBtn.className = 'wsc-sbtn confirm'; confirmBtn.textContent = 'Delete?';
      confirmBtn.setAttribute('aria-label', 'Confirm delete');
      acts.replaceChild(confirmBtn, del);
      var revert = setTimeout(function () { if (confirmBtn.parentNode) acts.replaceChild(del, confirmBtn); }, 3000);
      confirmBtn.addEventListener('click', function (ev) {
        ev.stopPropagation(); clearTimeout(revert);
        apiDeleteSession(s.id).then(function (ok) {
          if (!ok) { refreshSessionLists(); return; }
          sessionList = sessionList.filter(function (x) { return x.id !== s.id; });
          delete drafts[s.id];
          if (s.id === sessionId) {
            // deleted the active one → fall back to most recent, else empty
            if (sessionList.length) { openSession(ui, sessionList[0].id); }
            else { setActiveSession('', ''); mountedUIs.forEach(function (u) { showEmpty(u, 'Fresh start. What are we working on?'); showChatView(u); }); try { localStorage.removeItem('coachSession'); } catch (er) {} }
          }
          refreshSessionLists();
        });
      });
    });

    return row;
  }

  // =====================================================================
  //  SESSION NAVIGATION
  // =====================================================================
  function openSession(ui, id) {
    if (id === sessionId && ui.log && ui.log.childNodes.length) { showChatView(ui); return; }
    saveDraft(ui);
    var summary = null;
    for (var i = 0; i < sessionList.length; i++) { if (sessionList[i].id === id) { summary = sessionList[i]; break; } }
    setActiveSession(id, summary ? summary.title : '');
    // load into every mounted UI so drawer + full page stay consistent
    apiLoadSession(id).then(function (d) {
      var msgs = (d && d.messages) || [];
      mountedUIs.forEach(function (u) { renderHistory(u, msgs); restoreDraft(u); showChatView(u); });
      if (d && d.title) setActiveSession(id, d.title);
    }).catch(function () { mountedUIs.forEach(function (u) { showEmpty(u); showChatView(u); }); });
  }

  function newSession(ui) {
    if (streaming) return;
    saveDraft(ui);
    apiCreateSession().then(function (s) {
      if (!s || !s.id) return;
      sessionList.unshift(s);
      setActiveSession(s.id, s.title || 'New session');
      mountedUIs.forEach(function (u) { u.freshMsg = 'Fresh start. What are we working on?'; showEmpty(u, u.freshMsg); u.freshMsg = null; restoreDraft(u); showChatView(u); });
    }).catch(function () {
      // offline / no server — clear locally; the server will lazily create on first send
      setActiveSession('', '');
      try { localStorage.removeItem('coachSession'); } catch (e) {}
      mountedUIs.forEach(function (u) { showEmpty(u, 'Fresh start. What are we working on?'); showChatView(u); });
    });
  }

  // =====================================================================
  //  DRAFT PERSISTENCE (per session, in-memory)
  // =====================================================================
  function draftKey() { return sessionId || '__new__'; }
  function saveDraft(ui) { if (ui && ui.ta) drafts[draftKey()] = ui.ta.value; }
  function restoreDraft(ui) {
    if (!ui || !ui.ta) return;
    ui.ta.value = drafts[draftKey()] || '';
    autosizeTa(ui.ta); updateSendState(ui);
  }
  function autosizeTa(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(140, ta.scrollHeight) + 'px'; }
  function updateSendState(ui) {
    if (streaming) { ui.send.disabled = false; return; }
    ui.send.disabled = !ui.ta.value.trim() && !pendingImage;
  }

  // =====================================================================
  //  PHOTO ATTACH — client-side downscale, one pending image per message
  // =====================================================================
  // pendingImage: { data (base64, no data: prefix), media_type, dataUrl (for thumbnail) }
  var pendingImage = null;
  var MAX_EDGE = 1568;   // long-edge cap (matches the server-side vision sweet spot)

  function ingestImageFile(file) {
    if (!file || !/^image\//.test(file.type || '')) return;
    var reader = new FileReader();
    reader.onload = function () { downscaleToJpeg(reader.result); };
    reader.onerror = function () { mountedUIs.forEach(function (u) { addErr(u, 'Could not read that image.'); }); };
    reader.readAsDataURL(file);
  }
  function downscaleToJpeg(dataUrl) {
    var img = new Image();
    img.onload = function () {
      var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
      var scale = Math.min(1, MAX_EDGE / Math.max(w, h));
      var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
      var canvas = document.createElement('canvas'); canvas.width = cw; canvas.height = ch;
      try {
        var g = canvas.getContext('2d'); g.drawImage(img, 0, 0, cw, ch);
        var jpeg = canvas.toDataURL('image/jpeg', 0.85);
        var base64 = jpeg.slice(jpeg.indexOf(',') + 1);
        setPendingImage({ data: base64, media_type: 'image/jpeg', dataUrl: jpeg });
      } catch (e) {
        mountedUIs.forEach(function (u) { addErr(u, 'Could not process that image.'); });
      }
    };
    img.onerror = function () { mountedUIs.forEach(function (u) { addErr(u, 'That file did not load as an image.'); }); };
    img.src = dataUrl;
  }
  function setPendingImage(imgObj) {
    pendingImage = imgObj;   // replaces any prior one — ONE image per message
    mountedUIs.forEach(renderThumb);
    mountedUIs.forEach(updateSendState);
  }
  function clearPendingImage() {
    pendingImage = null;
    mountedUIs.forEach(renderThumb);
    mountedUIs.forEach(updateSendState);
  }
  function renderThumb(ui) {
    if (!ui.thumbRow) return;
    while (ui.thumbRow.firstChild) ui.thumbRow.removeChild(ui.thumbRow.firstChild);
    if (!pendingImage) { ui.thumbRow.style.display = 'none'; if (ui.cam) ui.cam.classList.remove('armed'); return; }
    ui.thumbRow.style.display = 'flex';
    if (ui.cam) ui.cam.classList.add('armed');
    var chip = el('wsc-thumb');
    var im = document.createElement('img'); im.src = pendingImage.dataUrl; im.alt = 'Attached photo';
    var meta = textNode('wsc-thumb-meta', 'Photo attached — sends with your next message');
    var x = document.createElement('button'); x.type = 'button'; x.className = 'wsc-thumb-x'; x.innerHTML = IC_X; x.title = 'Remove photo'; x.setAttribute('aria-label', 'Remove photo');
    x.addEventListener('click', function () { clearPendingImage(); });
    chip.appendChild(im); chip.appendChild(meta); chip.appendChild(x);
    ui.thumbRow.appendChild(chip);
  }

  // =====================================================================
  //  VIEW SWAP (chat ⇄ sessions) — drawer only; full page uses the sidebar
  // =====================================================================
  function showChatView(ui) { if (ui.chatView && ui.sessView) { ui.chatView.hidden = false; ui.sessView.hidden = true; } }
  function showSessionsView(ui) {
    if (!ui.chatView || !ui.sessView) return;
    ui.chatView.hidden = true; ui.sessView.hidden = false;
    refreshSessionLists();
  }

  // =====================================================================
  //  UI CONSTRUCTION
  // =====================================================================
  function makeUI(mount, isFull) {
    var ui = { mount: mount, isFull: isFull, nearBottom: true, toolLines: [], lastDay: null, think: null };

    // --- header ---
    var head, title;
    if (isFull) {
      // full-page header keeps its established single-row layout (kicker + title + acts)
      head = el('wsc-head');
      var htxt = document.createElement('div');
      var kicker = document.createElement('p'); kicker.className = 'wsc-kicker'; kicker.textContent = 'The Woodshed · Coach';
      title = document.createElement('h2'); title.className = 'wsc-title'; title.textContent = 'The Instructor';
      htxt.appendChild(kicker); htxt.appendChild(title);
      ui.titleEl = title;
      title.classList.add('editable'); title.title = 'Click to rename';
      title.addEventListener('click', function () { inlineRenameHeader(ui); });
      head.appendChild(htxt);

      var acts = el('wsc-acts');
      var hamb = document.createElement('button'); hamb.type = 'button'; hamb.className = 'wsc-ibtn wsc-hamb'; hamb.innerHTML = IC_MENU; hamb.title = 'Sessions'; hamb.setAttribute('aria-label', 'Toggle sessions');
      hamb.addEventListener('click', function () { toggleSidebar(); });
      acts.appendChild(hamb);
      var newBtn = el('wsc-ibtn'); newBtn.innerHTML = IC_NEW; newBtn.title = 'New session'; newBtn.setAttribute('aria-label', 'New session');
      newBtn.addEventListener('click', function () { newSession(ui); });
      acts.appendChild(newBtn);
      head.appendChild(acts);
    } else {
      // DRAWER header — two-row stack.
      // Row 1: session title (sentence case, ellipsis) + close ✕ at far right.
      head = el('wsc-head drawer');
      var row1 = el('wsc-head-row');
      title = document.createElement('h2'); title.className = 'wsc-title'; title.textContent = 'The Instructor';
      ui.titleEl = title;
      row1.appendChild(title);
      var closeBtn = el('wsc-sbtn30'); closeBtn.innerHTML = IC_X; closeBtn.title = 'Close'; closeBtn.setAttribute('aria-label', 'Close coach');
      closeBtn.addEventListener('click', closeDrawer);
      row1.appendChild(closeBtn);
      head.appendChild(row1);

      // Row 2: quiet action strip — labeled +New, history toggle, model pill, pop-out.
      var strip = el('wsc-strip');
      var newBtnL = document.createElement('button'); newBtnL.type = 'button'; newBtnL.className = 'wsc-newbtn';
      newBtnL.innerHTML = IC_NEW + '<span>New session</span>'; newBtnL.title = 'New session'; newBtnL.setAttribute('aria-label', 'New session');
      newBtnL.addEventListener('click', function () { newSession(ui); });
      strip.appendChild(newBtnL);
      var histBtn = el('wsc-sbtn30'); histBtn.innerHTML = IC_HISTORY; histBtn.title = 'Sessions'; histBtn.setAttribute('aria-label', 'Show sessions');
      histBtn.addEventListener('click', function () { showSessionsView(ui); });
      strip.appendChild(histBtn);
      strip.appendChild(el('wsc-spacer'));
      strip.appendChild(makeModelPill());
      // float: a true always-on-top companion window (Document PiP; popup fallback)
      // so the Instructor can sit over the tools while you work.
      var floatBtn = document.createElement('button'); floatBtn.type = 'button'; floatBtn.className = 'wsc-sbtn30';
      floatBtn.innerHTML = '<svg viewBox="0 0 24 24" style="width:15px;height:15px;stroke:currentColor;stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round"><rect x="3" y="3" width="12" height="12" rx="2"/><rect x="11" y="11" width="10" height="10" rx="2"/></svg>';
      floatBtn.title = 'Float the Instructor over your other windows'; floatBtn.setAttribute('aria-label', floatBtn.title);
      floatBtn.addEventListener('click', function () { floatCoach(); });
      strip.appendChild(floatBtn);
      var popBtn = document.createElement('a'); popBtn.className = 'wsc-sbtn30'; popBtn.innerHTML = IC_POP; popBtn.href = 'coach.html'; popBtn.title = 'Pop out to full page'; popBtn.setAttribute('aria-label', 'Open full coach page');
      strip.appendChild(popBtn);
      head.appendChild(strip);
    }

    // --- body: chat view (+ sessions view for the drawer) ---
    var body = el('wsc-body');

    var chatView = el('wsc-view');
    var log = el('wsc-log'); log.setAttribute('role', 'log'); log.setAttribute('aria-live', 'polite'); log.setAttribute('aria-label', 'Conversation');
    var jump = document.createElement('button'); jump.type = 'button'; jump.className = 'wsc-jump'; jump.innerHTML = IC_DOWN + '<span>Latest</span>'; jump.setAttribute('aria-label', 'Jump to latest');
    jump.addEventListener('click', function () { ui.nearBottom = true; scrollToBottom(ui, true); hideJump(ui); });
    log.appendChild(jump);
    chatView.appendChild(log);
    ui.log = log; ui.jump = jump;
    log.addEventListener('scroll', function () {
      ui.nearBottom = isNearBottom(ui);
      if (ui.nearBottom) hideJump(ui);
    });

    var empty = textNode('wsc-empty', 'Ask about today’s plan, a take you just recorded, or a technique that keeps breaking down. The Instructor sees this page and your recent stats.');
    log.appendChild(empty); ui.empty = empty;

    // pending-image thumbnail row (hidden until a photo is attached)
    var thumbRow = el('wsc-thumbrow'); thumbRow.style.display = 'none';
    chatView.appendChild(thumbRow);
    ui.thumbRow = thumbRow;

    var foot = el('wsc-foot');
    var mic = document.createElement('button'); mic.className = 'wsc-mic'; mic.type = 'button'; mic.innerHTML = IC_MIC; mic.title = 'Record a take'; mic.setAttribute('aria-label', 'Record a take');
    var cam = document.createElement('button'); cam.className = 'wsc-cam'; cam.type = 'button'; cam.innerHTML = IC_CAMERA; cam.title = 'Attach a photo'; cam.setAttribute('aria-label', 'Attach a photo');
    var fileIn = document.createElement('input'); fileIn.type = 'file'; fileIn.accept = 'image/*'; fileIn.setAttribute('capture', 'environment'); fileIn.style.display = 'none';
    var ta = document.createElement('textarea'); ta.className = 'wsc-ta'; ta.rows = 1; ta.placeholder = 'Message the Instructor…'; ta.setAttribute('aria-label', 'Message the Instructor');
    var send = document.createElement('button'); send.className = 'wsc-send'; send.type = 'button'; send.innerHTML = IC_SEND; send.title = 'Send'; send.setAttribute('aria-label', 'Send message'); send.disabled = true;
    // full-page: dock the model knob in the footer, immediately left of the mic button
    if (isFull) { var footKnob = el('wsc-foot-knob'); var kb = makeKnob(); footKnob.appendChild(kb); foot.appendChild(footKnob); ui.knobRedraw = kb._redraw; }
    // order: [full-page: knob] · mic · camera · textarea · send
    foot.appendChild(mic); foot.appendChild(cam); foot.appendChild(fileIn); foot.appendChild(ta); foot.appendChild(send);
    chatView.appendChild(foot);
    ui.ta = ta; ui.send = send; ui.mic = mic; ui.cam = cam; ui.fileIn = fileIn;

    body.appendChild(chatView); ui.chatView = chatView;

    // sessions view (drawer only — full page has the sidebar instead)
    if (!isFull) {
      var sessView = el('wsc-view'); sessView.hidden = true;
      var sHead = el('wsc-head');
      var backBtn = el('wsc-ibtn'); backBtn.innerHTML = IC_BACK; backBtn.title = 'Back to chat'; backBtn.setAttribute('aria-label', 'Back to chat');
      backBtn.addEventListener('click', function () { showChatView(ui); });
      var sTitle = document.createElement('div'); sTitle.innerHTML = '<p class="wsc-kicker">The Woodshed · Coach</p><h2 class="wsc-title">Sessions</h2>';
      sHead.appendChild(backBtn); sHead.appendChild(sTitle);
      var slist = el('wsc-slist');
      sessView.appendChild(sHead); sessView.appendChild(slist);
      body.appendChild(sessView);
      ui.sessView = sessView;
      sessionListMounts.push({ node: slist, ui: ui });
    }

    mount.appendChild(head); mount.appendChild(body);

    // --- wiring ---
    ta.addEventListener('input', function () { autosizeTa(ta); updateSendState(ui); saveDraft(ui); });
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(ui); }
    });
    send.addEventListener('click', function () { if (streaming) stopStreaming(); else doSend(ui); });
    mic.addEventListener('click', function () { toggleRecord(ui); });
    // photo attach: file picker + clipboard paste
    cam.addEventListener('click', function () { if (!streaming) fileIn.click(); });
    fileIn.addEventListener('change', function () {
      var f = fileIn.files && fileIn.files[0];
      if (f) ingestImageFile(f);
      fileIn.value = '';
    });
    ta.addEventListener('paste', function (e) {
      var items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (var i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.indexOf('image/') === 0) {
          var f = items[i].getAsFile();
          if (f) { e.preventDefault(); ingestImageFile(f); return; }
        }
      }
    });

    mountedUIs.push(ui);
    applyTitle(ui);
    renderChips(ui);
    return ui;
  }

  // full-page: rename via the header title (inline input)
  function inlineRenameHeader(ui) {
    if (!sessionId) return;
    var cur = (sessionTitle && sessionTitle !== 'New session') ? sessionTitle : '';
    var input = document.createElement('input'); input.type = 'text'; input.className = 'wsc-title-in'; input.value = cur || sessionTitle || '';
    input.setAttribute('aria-label', 'Session title');
    var parent = ui.titleEl.parentNode;
    parent.replaceChild(input, ui.titleEl);
    input.focus(); input.select();
    var commit = function (save) {
      parent.replaceChild(ui.titleEl, input);
      if (save) {
        var v = input.value.trim().slice(0, 80);
        if (v && v !== sessionTitle) {
          apiRenameSession(sessionId, v).then(function (r) {
            if (r && r.ok) { setActiveSession(sessionId, r.title); bumpSession(sessionId, { title: r.title }); }
          });
        }
      }
    };
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); commit(true); }
      else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
    });
    input.addEventListener('blur', function () { commit(true); });
  }

  // =====================================================================
  //  SEND / STREAM (with AbortController, thinking indicator, session capture)
  // =====================================================================
  var abortCtrl = null;
  var activeUI = null;   // the UI that owns the in-flight stream

  function doSend(ui) {
    if (streaming) return;
    var text = ui.ta.value.trim();
    // an attached photo can carry the turn on its own (empty text is allowed)
    var img = pendingImage;
    if (!text && !img) return;
    ui.ta.value = ''; autosizeTa(ui.ta); saveDraft(ui);
    if (img) clearPendingImage();
    var sentAt = Date.now();
    var thumbUrl = img ? img.dataUrl : null;
    // reflect the user's turn in every mounted UI
    mountedUIs.forEach(function (u) { addMsg(u, 'user', text, sentAt, true, thumbUrl); });
    ui.nearBottom = true;

    streaming = true; activeUI = ui;
    mountedUIs.forEach(function (u) { u.think = null; updateSendState(u); });
    setSendStop(ui);
    showThinking(ui);

    var ctx = captureContext();
    pendingExtra = null; window.__coachTake = null;   // consumed

    var coachEl = null; var coachText = '';
    function ensureCoach() {
      hideThinking(ui);
      if (!coachEl) { coachEl = addMsg(ui, 'coach', '', Date.now(), true); }
    }
    // auto-title only fires via the server 'session' event; nothing to guess here

    abortCtrl = new AbortController();
    fetch('/api/coach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, context: ctx, model: currentModel(), sessionId: sessionId || undefined, image: img ? { media_type: img.media_type, data: img.data } : undefined }),
      signal: abortCtrl.signal
    }).then(function (resp) {
      if (!resp.ok || !resp.body) { throw new Error('HTTP ' + resp.status); }
      var reader = resp.body.getReader();
      var dec = new TextDecoder(); var buf = '';
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) { finish(); return; }
          buf += dec.decode(r.value, { stream: true });
          var parts = buf.split('\n\n');
          buf = parts.pop();
          parts.forEach(function (chunk) {
            var line = chunk.split('\n').find(function (l) { return l.indexOf('data: ') === 0; });
            if (!line) return;
            var evt; try { evt = JSON.parse(line.slice(6)); } catch (e) { return; }
            handleEvent(evt);
          });
          return pump();
        });
      }
      function handleEvent(evt) {
        if (evt.type === 'session') {
          // server created/identified the session and/or auto-titled it
          if (evt.id) {
            var wasNew = !sessionId;
            setActiveSession(evt.id, evt.title || sessionTitle);
            bumpSession(evt.id, { title: evt.title || 'New session', updated: Date.now() });
            if (wasNew) refreshSessionLists();
          }
        }
        else if (evt.type === 'text') { ensureCoach(); coachText += evt.delta; coachEl._plain = coachText; coachEl.innerHTML = md(coachText); maybeScroll(ui); }
        else if (evt.type === 'client') { applyClientAction(evt); }
        else if (evt.type === 'tool') { hideThinking(ui); addTool(ui, evt.name, evt.path || evt.detail || ''); coachEl = null; coachText = ''; }
        else if (evt.type === 'error') { hideThinking(ui); addErr(ui, evt.message || 'The coach hit an error.'); }
        else if (evt.type === 'done') { /* stream ends when body closes */ }
      }
      return pump();
    }).catch(function (e) {
      if (e && e.name === 'AbortError') { onStopped(ui); return; }
      hideThinking(ui);
      addErr(ui, 'Could not reach the Instructor. Is the dev server running? (' + (e && e.message ? e.message : 'network error') + ')');
      finish();
    });

    function finish() {
      streaming = false; abortCtrl = null; activeUI = null;
      hideThinking(ui);
      if (coachEl && !coachText) { coachEl.textContent = '(no response)'; }
      spendToolLines(ui);
      mountedUIs.forEach(function (u) { setSendReady(u); updateSendState(u); });
      // bump the active session's updated stamp + preview in the local list
      if (sessionId) bumpSession(sessionId, { updated: Date.now(), preview: (coachText || '').slice(0, 70) });
    }
    function onStopped(ui) {
      streaming = false; abortCtrl = null; activeUI = null;
      hideThinking(ui);
      var s = textNode('wsc-stopped', '— stopped —'); ui.log.appendChild(s); maybeScroll(ui);
      spendToolLines(ui);
      mountedUIs.forEach(function (u) { setSendReady(u); updateSendState(u); });
    }
  }

  function spendToolLines(ui) { (ui.toolLines || []).forEach(function (t) { t.classList.add('spent'); }); ui.toolLines = []; }

  function setSendStop(ui) {
    // only the owning UI shows the stop affordance; others just disable
    mountedUIs.forEach(function (u) {
      if (u === ui) { u.send.classList.add('stop'); u.send.innerHTML = IC_STOP; u.send.title = 'Stop'; u.send.setAttribute('aria-label', 'Stop generating'); u.send.disabled = false; }
      else { u.send.disabled = true; }
    });
  }
  function setSendReady(ui) {
    ui.send.classList.remove('stop'); ui.send.innerHTML = IC_SEND; ui.send.title = 'Send'; ui.send.setAttribute('aria-label', 'Send message'); ui.send.disabled = false;
  }
  function stopStreaming() { if (abortCtrl) { try { abortCtrl.abort(); } catch (e) {} } }

  // =====================================================================
  //  RECORDING (mic → analyze → upload → prefill) — unchanged flow
  // =====================================================================
  var recording = false, recorder = null, recStream = null, recChunks = [], recTimer = null, recStart = 0;
  function fmtElapsed(ms) { var s = Math.floor(ms / 1000); return String(Math.floor(s / 60)) + ':' + String(s % 60).padStart(2, '0'); }
  function setMicIdle(ui) {
    recording = false; ui.mic.classList.remove('rec'); ui.mic.innerHTML = IC_MIC; ui.mic.title = 'Record a take'; ui.mic.setAttribute('aria-label', 'Record a take'); ui.mic.disabled = false;
  }
  function toggleRecord(ui) {
    if (recording) { stopRecord(); return; }
    if (streaming) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { addErr(ui, 'This browser can’t open the mic here. Recording needs localhost or HTTPS.'); return; }
    (window.WoodshedMic && WoodshedMic.getStream ? WoodshedMic.getStream()
      : navigator.mediaDevices.getUserMedia({ audio: true })).then(function (stream) {
      recStream = stream; recChunks = [];
      try { recorder = new MediaRecorder(stream); }
      catch (e) { try { recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' }); } catch (e2) { addErr(ui, 'Couldn’t start recording on this browser.'); stopStream(); return; } }
      recorder.ondataavailable = function (e) { if (e.data && e.data.size) recChunks.push(e.data); };
      recorder.onstop = function () { onRecordingStopped(ui); };
      recorder.start();
      recording = true; recStart = Date.now();
      ui.mic.classList.add('rec'); ui.mic.innerHTML = IC_STOP + '<span>0:00</span>'; ui.mic.title = 'Stop recording'; ui.mic.setAttribute('aria-label', 'Stop recording');
      recTimer = setInterval(function () {
        var span = ui.mic.querySelector('span'); if (span) span.textContent = fmtElapsed(Date.now() - recStart);
      }, 500);
    }).catch(function (e) {
      var name = (e && e.name) || '';
      if (name === 'NotAllowedError' || name === 'SecurityError') addErr(ui, 'Mic access was blocked. Allow the microphone for this page, then tap record again.');
      else addErr(ui, 'Couldn’t open the mic (' + (name || (e && e.message) || 'error') + '). Recording needs localhost or HTTPS.');
    });
  }
  function stopStream() { if (recStream) { try { recStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} recStream = null; } }
  function stopRecord() { if (recorder && recorder.state !== 'inactive') { try { recorder.stop(); } catch (e) {} } if (recTimer) { clearInterval(recTimer); recTimer = null; } }
  function onRecordingStopped(ui) {
    if (recTimer) { clearInterval(recTimer); recTimer = null; }
    stopStream();
    var type = (recorder && recorder.mimeType) || 'audio/webm';
    var blob = new Blob(recChunks, { type: type });
    recorder = null; recChunks = [];
    setMicIdle(ui); ui.mic.disabled = true;
    if (!blob.size) { addErr(ui, 'That take was empty — nothing was captured.'); ui.mic.disabled = false; return; }
    var statusLine = addStatus(ui, 'analyzing take…');
    analyzeAndUpload(ui, blob, statusLine);
  }
  function analyzeAndUpload(ui, blob, statusLine) {
    var analysis = null;
    import('./analyze.js').then(function (mod) {
      return mod.analyzeBlob(blob);
    }).then(function (res) {
      analysis = res;
    }).catch(function (e) {
      analysis = null;
      if (statusLine) statusLine.querySelector('span').textContent = 'analysis failed — saving the raw take…';
    }).then(function () {
      return uploadTake(blob);
    }).then(function (up) {
      if (statusLine && statusLine.parentNode) statusLine.parentNode.removeChild(statusLine);
      ui.mic.disabled = false;
      var path = (up && up.ok) ? up.path : '';
      if (analysis) {
        window.__coachTake = { report: analysis.report, recording: path, noteCount: analysis.noteCount, durationSec: analysis.durationSec };
        addStatus(ui, 'take analyzed · ' + analysis.noteCount + ' notes · ' + analysis.durationSec.toFixed(1) + 's' + (path ? ' · saved' : ''));
      } else {
        window.__coachTake = { report: 'RECORDING ANALYSIS — automatic note detection failed on this take. The raw audio was saved' + (path ? ' at ' + path : '') + '; ask the student what they played and how it felt.', recording: path, noteCount: 0, durationSec: 0 };
        addErr(ui, 'Couldn’t analyze the notes, but the take was saved. Tell the Instructor what you played.');
      }
      if (!ui.ta.value) { ui.ta.value = 'Debrief this take.'; updateSendState(ui); saveDraft(ui); }
      ui.ta.focus();
    }).catch(function (e) {
      if (statusLine && statusLine.parentNode) statusLine.parentNode.removeChild(statusLine);
      ui.mic.disabled = false;
      addErr(ui, 'Recording saved locally but the upload failed (' + (e && e.message ? e.message : 'network error') + ').');
    });
  }
  function uploadTake(blob) {
    return fetch('/api/coach/upload', {
      method: 'POST',
      headers: { 'Content-Type': blob.type || 'audio/webm' },
      body: blob
    }).then(function (r) { return r.ok ? r.json() : { ok: false }; }).catch(function () { return { ok: false }; });
  }

  // =====================================================================
  //  SESSION BOOTSTRAP — pick the session to show on first open
  // =====================================================================
  var bootstrapped = false, bootstrapping = null;
  function bootstrapSessions() {
    if (bootstrapping) return bootstrapping;
    bootstrapping = apiListSessions().then(function (list) {
      sessionsLoaded = true;
      var target = null;
      if (sessionId) { for (var i = 0; i < list.length; i++) { if (list[i].id === sessionId) { target = list[i]; break; } } }
      if (!target && list.length) target = list[0];
      if (target) {
        setActiveSession(target.id, target.title);
        return apiLoadSession(target.id).then(function (d) {
          var msgs = (d && d.messages) || [];
          mountedUIs.forEach(function (u) { renderHistory(u, msgs); restoreDraft(u); });
          if (d && d.title) setActiveSession(target.id, d.title);
        });
      } else {
        // no sessions yet — the server creates one lazily on first send
        setActiveSession('', '');
        try { localStorage.removeItem('coachSession'); } catch (e) {}
        mountedUIs.forEach(function (u) { showEmpty(u); });
      }
    }).catch(function () {
      // offline: leave the empty prompt; server lazily creates on first send
      mountedUIs.forEach(function (u) { showEmpty(u); });
    });
    bootstrapped = true;
    return bootstrapping;
  }

  // =====================================================================
  //  DRAWER PLUMBING
  // =====================================================================
  var drawer = null, scrim = null, drawerUI = null;
  function buildDrawer() {
    if (drawer) return;
    scrim = el('wsc-scrim');
    scrim.addEventListener('click', closeDrawer);
    drawer = el('wsc-drawer');
    drawer.setAttribute('role', 'dialog'); drawer.setAttribute('aria-label', 'The Instructor');
    document.body.appendChild(scrim); document.body.appendChild(drawer);
    drawerUI = makeUI(drawer, false);
  }
  // Float the coach in an always-on-top companion window. Document Picture-in-
  // Picture (Chromium) genuinely stays over other windows; elsewhere we fall back
  // to a small popup the OS can pin. The window hosts the full coach page.
  function floatCoach() {
    closeDrawer();
    try {
      if (window.documentPictureInPicture && documentPictureInPicture.requestWindow) {
        documentPictureInPicture.requestWindow({ width: 430, height: 680 }).then(function (pip) {
          pip.document.body.style.margin = '0';
          pip.document.title = 'The Instructor';
          var f = pip.document.createElement('iframe');
          f.src = 'coach.html';
          f.style.cssText = 'border:0;width:100%;height:100%;display:block';
          pip.document.body.appendChild(f);
        }).catch(function () { floatPopup(); });
        return;
      }
    } catch (e) {}
    floatPopup();
  }
  function floatPopup() {
    window.open('coach.html', 'woodshedCoachFloat', 'width=440,height=720,menubar=no,toolbar=no,location=no,resizable=yes');
  }

  function openDrawer() {
    buildDrawer();
    scrim.classList.add('open'); drawer.classList.add('open');
    showChatView(drawerUI);
    if (!bootstrapped) bootstrapSessions();
    if (pendingExtra && pendingExtra.prefill && !drawerUI.ta.value) { drawerUI.ta.value = String(pendingExtra.prefill); updateSendState(drawerUI); }
    else if (pendingExtra && pendingExtra.take && !drawerUI.ta.value) { drawerUI.ta.value = 'Debrief this take.'; updateSendState(drawerUI); }
    // autosend (one-shot): the hub's Start-session CTA jumps straight into the turn.
    // Carry the text explicitly — on a cold drawer, bootstrapSessions()'s draft
    // restore can wipe the textarea between prefill and the deferred send.
    if (pendingExtra && pendingExtra.autosend && drawerUI.ta.value) {
      delete pendingExtra.autosend;
      var autoMsg = drawerUI.ta.value;
      setTimeout(function () {
        if (!drawerUI.ta.value) { drawerUI.ta.value = autoMsg; updateSendState(drawerUI); }
        doSend(drawerUI);
      }, 300);
    }
    setTimeout(function () { drawerUI.ta.focus(); }, 260);
  }
  function closeDrawer() { if (drawer) { drawer.classList.remove('open'); scrim.classList.remove('open'); } }
  function drawerOpen() { return drawer && drawer.classList.contains('open'); }

  // full-page sidebar toggle (narrow viewports)
  // Wide: collapse the inline sessions panel (persisted). Narrow: slide the
  // off-canvas overlay. The hamburger and the sidebar chevron both call this.
  function toggleSidebar() {
    if (!FULL) return;
    if (window.matchMedia && window.matchMedia('(min-width:721px)').matches) {
      var collapsed = FULL.classList.toggle('side-collapsed');
      try { localStorage.setItem('coachSideCollapsed', collapsed ? '1' : '0'); } catch (e) {}
    } else {
      var open = FULL.classList.toggle('side-open');
      // inline belt: guarantees the slide regardless of stylesheet cascade quirks
      var side = FULL.querySelector('.wsc-side');
      if (side) side.style.left = open ? '0px' : '';
    }
  }

  // =====================================================================
  //  PUBLIC API + EVENTS
  // =====================================================================
  var fullUI = null;
  window.WoodshedCoach = {
    open: function (extra) {
      if (extra) { pendingExtra = pendingExtra || {}; for (var k in extra) pendingExtra[k] = extra[k]; }
      if (fullUI) {
        if (pendingExtra && pendingExtra.prefill && !fullUI.ta.value) { fullUI.ta.value = String(pendingExtra.prefill); updateSendState(fullUI); }
        else if (pendingExtra && pendingExtra.take && !fullUI.ta.value) { fullUI.ta.value = 'Debrief this take.'; updateSendState(fullUI); }
        if (pendingExtra && pendingExtra.autosend && fullUI.ta.value) {
          delete pendingExtra.autosend;
          var fMsg = fullUI.ta.value;
          setTimeout(function () {
            if (!fullUI.ta.value) { fullUI.ta.value = fMsg; updateSendState(fullUI); }
            doSend(fullUI);
          }, 300);
        }
        fullUI.ta.focus();
        return;
      }
      if (FULL) { window.location.href = 'coach.html'; return; }
      openDrawer();
    },
    // pop the Instructor into a floating always-on-top window (PiP; popup fallback)
    float: function () { floatCoach(); },
    // jump the chat to a specific conversation (e.g. a session record's debrief)
    openSession: function (id) {
      if (!id) return;
      if (mountedUIs.length) { openSession(mountedUIs[mountedUIs.length - 1], id); return; }
      openDrawer();
      var tries = 0;
      (function poll() {
        if (mountedUIs.length) { openSession(mountedUIs[mountedUIs.length - 1], id); return; }
        if (++tries < 20) setTimeout(poll, 150);
      })();
    },
    // is a guided practice session running right now?
    sessionRunning: function () { var st = psLoad(); return !!(st && st.running); },
    // jump the guided strip to a step by index, or by its tool page (returns matched)
    gotoStep: function (i) { gotoPracticeStep(i); },
    gotoStepByTool: function (tool) {
      var st = psLoad(); if (!st || !st.running) return false;
      for (var i = 0; i < st.steps.length; i++) { if (st.steps[i].tool === tool) { gotoPracticeStep(i); return true; } }
      return false;
    },
    currentStep: function () { var st = psLoad(); return (st && st.running) ? st.cur : -1; }
  };
  document.addEventListener('coach:open', function (e) {
    var d = (e && e.detail) || {};
    window.WoodshedCoach.open(d);
  });

  // Esc: stop streaming if mid-stream, else close the drawer
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (streaming) { stopStreaming(); e.preventDefault(); return; }
    if (drawerOpen()) { closeDrawer(); }
  });

  // =====================================================================
  //  BOOT
  // =====================================================================
  function buildFullPage() {
    // sidebar (persistent session list) + main chat column
    FULL.classList.add('wsc-full');
    var side = el('wsc-side');
    var sideHead = el('wsc-side-head');
    var sk = document.createElement('div'); sk.innerHTML = '<p class="wsc-kicker">Sessions</p>';
    sideHead.appendChild(sk);
    var collapse = document.createElement('button'); collapse.type = 'button'; collapse.className = 'wsc-collapse';
    collapse.innerHTML = '<svg viewBox="0 0 24 24"><path d="m14 6-6 6 6 6"/></svg>';
    collapse.title = 'Collapse sessions'; collapse.setAttribute('aria-label', 'Collapse sessions panel');
    collapse.addEventListener('click', function () { toggleSidebar(); });
    sideHead.appendChild(collapse);
    var slist = el('wsc-slist');
    side.appendChild(sideHead); side.appendChild(slist);

    var main = el('wsc-main');
    FULL.appendChild(side); FULL.appendChild(main);

    fullUI = makeUI(main, true);
    sessionListMounts.push({ node: slist, ui: fullUI });
    // restore the wide-screen collapsed preference
    try { if (localStorage.getItem('coachSideCollapsed') === '1') FULL.classList.add('side-collapsed'); } catch (e) {}
    refreshSessionLists();
    bootstrapSessions();
  }

  function boot() {
    injectStyles();
    // a guided session persists across pages — re-mount the strip if one is running
    renderPracticeStrip();
    flushSessionQueue();   // deliver any session records stranded offline
    if (FULL) { buildFullPage(); return; }
    var chip = document.createElement('button');
    chip.className = 'wsc-chip'; chip.type = 'button';
    // guitar pick: classic rounded-triangle plectrum, point DOWN, ~46×52px
    // fat rounded shoulders, gentle taper; 'W' monogram — shares the avatar silhouette
    chip.innerHTML = pickSvg(46, 52, 'var(--panel)', 'hsl(var(--brand))', 'hsl(var(--brand))', 18, 1.5);
    chip.title = 'Ask the Instructor'; chip.setAttribute('aria-label', 'Open the Instructor coach');
    chip.addEventListener('click', openDrawer);
    document.body.appendChild(chip);
  }
  if (document.body) boot(); else document.addEventListener('DOMContentLoaded', boot);
})();
