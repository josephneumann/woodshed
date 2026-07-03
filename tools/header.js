/* Shared site header — one identical brand bar on the home page AND every tool,
   so navigating between pages never jars. Classic script; load with `defer` in
   <head> after theme.css. Injects the header as the first child of .container /
   .wrap and wires the light/dark toggle. The pre-paint inline script in each
   <head> still applies the saved theme before render to avoid a flash. */
(function(){
  var SUN='<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var MOON='<svg viewBox="0 0 24 24"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
  function favicon(){
    if(document.querySelector('link[rel="icon"]')) return;
    var l=document.createElement('link'); l.rel='icon'; l.type='image/svg+xml'; l.href='../assets/pick-mark.svg';
    document.head.appendChild(l);
  }
  function pwa(){
    // installable app + offline shell: manifest link on every page, one service
    // worker at the origin root (public/sw.js — see its header for cache policy).
    if(!document.querySelector('link[rel="manifest"]')){
      var m=document.createElement('link'); m.rel='manifest'; m.href='/manifest.webmanifest';
      document.head.appendChild(m);
    }
    if('serviceWorker' in navigator && (location.protocol==='https:'||location.hostname==='localhost'||location.hostname==='127.0.0.1')){
      // Vite dev serves live edits — a caching SW would show stale pages after every
      // change. Register only in prod builds; in dev, unregister any old worker.
      var isDev=!!document.querySelector('script[src*="@vite/client"]');
      try{
        if(isDev){ navigator.serviceWorker.getRegistrations().then(function(rs){ rs.forEach(function(r){ r.unregister(); }); }).catch(function(){}); }
        else navigator.serviceWorker.register('/sw.js').catch(function(){});
      }catch(e){}
    }
  }
  function build(){
    favicon();
    pwa();
    if(document.querySelector('.site-header')) return;
    var mount=document.querySelector('.container,.wrap')||document.body;
    var isHome=/\/(index\.html)?$/.test(location.pathname);   // home = /tools/ or /tools/index.html
    var back=isHome?'':'<a class="hdr-back" href="index.html" title="Back to all tools" aria-label="Back to all tools"><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg></a>';
    var h=document.createElement('header');
    h.className='site-header';
    h.innerHTML=
      '<div class="hdr-left">'+back
      +'<a class="brand" href="index.html" title="The Woodshed — home">'
      +'<span class="logo"></span>'
      +'<span class="name">The Woodshed<small>Practice tools</small></span></a></div>'
      +'<div class="hdr-actions"><button class="hdr-toggle" type="button" aria-label="Toggle light or dark mode" title="Toggle light/dark"></button></div>';
    mount.insertBefore(h, mount.firstChild);
    var btn=h.querySelector('.hdr-toggle');
    // masthead motifs come in two grounds: sepia-on-white (light, multiply) and
    // ivory-on-black (-dark, screen) — swap the file with the theme
    function syncMotif(){
      var dark=document.documentElement.classList.contains('dark');
      document.querySelectorAll('img.masthead-plate').forEach(function(img){
        var src=img.getAttribute('src')||'';
        var want=dark?(/-dark\.png$/.test(src)?src:src.replace(/\.png$/,'-dark.png')):src.replace(/-dark\.png$/,'.png');
        if(want!==src)img.setAttribute('src',want);
      });
    }
    function sync(){ btn.innerHTML=document.documentElement.classList.contains('dark')?SUN:MOON; syncMotif(); }
    btn.addEventListener('click',function(){
      var d=document.documentElement.classList.toggle('dark');
      try{ localStorage.setItem('theme', d?'dark':'light'); }catch(e){}
      if(!d){ document.documentElement.classList.remove('stage'); try{ localStorage.setItem('stageMode','0'); }catch(e){} syncStage(); }
      sync();
    });
    sync();
    document.addEventListener('DOMContentLoaded',syncMotif);
    // stage mode — night practice: rides on dark, deeper blacks, dimmed art, bigger type
    var LAMP='<svg viewBox="0 0 24 24"><path d="M9 2h6l3 7H6l3-7Z"/><path d="M12 9v8"/><path d="M8 21h8"/><path d="M12 17c-2.5 0-4 1.8-4 4h8c0-2.2-1.5-4-4-4Z"/></svg>';
    var sb=document.createElement('button');
    sb.type='button'; sb.className='hdr-toggle hdr-stage';
    var stageBtn=sb;
    function syncStage(){ var on=document.documentElement.classList.contains('stage');
      stageBtn.style.color=on?'hsl(38 92% 55%)':'';
      stageBtn.innerHTML=LAMP;
      stageBtn.title=on?'Stage mode on — click for normal lighting':'Stage mode — dim the room for night practice';
      stageBtn.setAttribute('aria-label',stageBtn.title); }
    sb.addEventListener('click',function(){
      var on=document.documentElement.classList.toggle('stage');
      if(on&&!document.documentElement.classList.contains('dark')){
        document.documentElement.classList.add('dark');
        try{ localStorage.setItem('theme','dark'); }catch(e){}
        sync();
      }
      try{ localStorage.setItem('stageMode',on?'1':'0'); }catch(e){}
      syncStage();
    });
    try{ if(localStorage.getItem('stageMode')==='1'&&document.documentElement.classList.contains('dark'))document.documentElement.classList.add('stage'); }catch(e){}
    syncStage();
    h.querySelector('.hdr-actions').insertBefore(sb,btn);
    // pull the audio voice-picker (if any tool injected one) into the header so it
    // sits beside the toggle instead of floating in the corner.
    relocatePicker(h);
  }
  var SPK='<svg viewBox="0 0 24 24"><path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.4 5.6a9 9 0 0 1 0 12.8"/></svg>';
  var SPK_OFF='<svg viewBox="0 0 24 24"><path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="m22 9-6 6M16 9l6 6"/></svg>';
  function addMute(h){
    // only on pages that loaded audio.js (getMuted/setMuted are its globals)
    if(typeof getMuted!=='function' || h.querySelector('.hdr-mute')) return;
    var b=document.createElement('button');
    b.type='button'; b.className='hdr-toggle hdr-mute';
    function sync(){ var m=getMuted();
      b.innerHTML=m?SPK_OFF:SPK;
      b.title=m?'Sound off — click to unmute':'Sound on — click to mute';
      b.setAttribute('aria-label',b.title); }
    b.addEventListener('click',function(){ setMuted(!getMuted()); sync(); });
    sync();
    h.querySelector('.hdr-actions').insertBefore(b, h.querySelector('.hdr-toggle'));
  }
  function relocatePicker(h){
    var vp=document.getElementById('voicePick');
    if(vp){ vp.style.position='static'; vp.style.top=''; vp.style.right=''; vp.style.zIndex=''; h.querySelector('.hdr-actions').insertBefore(vp, h.querySelector('.hdr-toggle')); }
    addMute(h);
  }
  function injectCoach(){
    // The shared mic layer first (coach's recorder + every listening tool use it),
    // then The Instructor. Both idempotent; both live on every page.
    if(!window.WoodshedMic && !document.querySelector('script[data-mic]')){
      var m=document.createElement('script'); m.src='mic.js'; m.setAttribute('data-mic','');
      document.head.appendChild(m);
    }
    if(window.__coachInit) return;
    if(document.querySelector('script[data-coach]')) return;
    var s=document.createElement('script'); s.src='coach.js'; s.defer=true; s.setAttribute('data-coach','');
    document.head.appendChild(s);
  }
  // ---- collapsible sections (shared, opt-in per page) ----
  // Any element with data-collapse="<key>" becomes a toggle for the element(s) named
  // in data-collapse-target (comma-separated ids). Collapsed keys persist per page
  // (localStorage 'collapsedSections'). A chevron is injected; aria-expanded kept true.
  var CHEV='<svg viewBox="0 0 24 24" style="width:14px;height:14px;stroke:currentColor;stroke-width:2.4;fill:none;stroke-linecap:round;stroke-linejoin:round;transition:transform .18s ease"><path d="m6 9 6 6 6-6"/></svg>';
  function collapseStore(){ try{ return JSON.parse(localStorage.getItem('collapsedSections')||'{}'); }catch(e){ return {}; } }
  function collapseSave(s){ try{ localStorage.setItem('collapsedSections',JSON.stringify(s)); }catch(e){} }
  function wireCollapse(){
    var page=location.pathname.split('/').pop()||'index.html';
    var store=collapseStore(); store[page]=store[page]||{};
    document.querySelectorAll('[data-collapse]').forEach(function(h){
      if(h.dataset.collapseWired)return; h.dataset.collapseWired='1';
      var key=h.dataset.collapse;
      var targets=(h.dataset.collapseTarget||'').split(',').map(function(id){return document.getElementById(id.trim());}).filter(Boolean);
      var panel=targets.length?null:h.closest('.panel');   // panel mode: collapse the enclosing card
      if(!targets.length&&!panel)return;
      var chev=document.createElement('span'); chev.innerHTML=CHEV; chev.style.cssText='display:inline-flex;margin-left:7px;color:inherit;opacity:.55;vertical-align:-1px';
      h.appendChild(chev);
      h.style.cursor='pointer'; h.setAttribute('role','button'); h.tabIndex=0;
      function apply(collapsed,skipSave){
        if(panel)panel.classList.toggle('sec-collapsed',collapsed);
        targets.forEach(function(t){ t.style.display=collapsed?'none':''; });
        chev.firstChild.style.transform=collapsed?'rotate(-90deg)':'';
        h.setAttribute('aria-expanded',collapsed?'false':'true');
        if(!skipSave){ if(collapsed)store[page][key]=1; else delete store[page][key]; collapseSave(store); }
      }
      function toggle(){ apply(!(h.getAttribute('aria-expanded')==='false')); }
      h.addEventListener('click',function(e){ if(e.target.closest('a,button,select,input'))return; toggle(); });
      h.addEventListener('keydown',function(e){ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); toggle(); } });
      apply(!!store[page][key],true);
    });
  }
  window.WoodshedCollapse={wire:wireCollapse};

  function init(){ build(); injectCoach(); wireCollapse(); document.addEventListener('DOMContentLoaded',function(){ relocatePicker(document.querySelector('.site-header')); wireCollapse(); }); }
  if(document.body) init(); else document.addEventListener('DOMContentLoaded',init);
})();
