/* Shared practice-stats + prefs layer for the practice tools.
   Plain classic script (no modules) — load SYNCHRONOUSLY in <head> AFTER theory.js
   and BEFORE the tool's inline <script>:  <script src="stats.js"></script>
   Provides globals: Stats, DOMAINS, DOMAIN_SHORT.

   Everything is stored per LOCAL day per tool under one localStorage key, so the
   dashboard (same origin) can read every tool's history, and Stats.export() gives
   The Instructor one JSON blob to fold into student/progress-data.json. */

// The six curriculum skill domains — single source of truth for hub + dashboard.
const DOMAINS=[['A','Technique'],['B','Fretboard'],['C','Ear'],['D','Time'],['E','Improv'],['F','Repertoire']];
const DOMAIN_SHORT={A:'Tech',B:'Fret',C:'Ear',D:'Time',E:'Improv',F:'Rep'};

/* ---- pure merge helpers (exported for tests; see module.exports guard at bottom) ----
   The server doc is DEVICE-BRANCHED: each device writes only its own branch under
   devices:{<id>:{days,reviewQueue,lastPush}}. Reads MERGE every device's days on the
   fly, so re-pushing the same data can never double-count — a device only ever
   overwrites its own branch, and the merge is idempotent over identical branches. */

// Merge two per-(day,tool) records into one. Counters SUM, bestStreak MAX,
// firstTs MIN, lastTs MAX, byKey per-key {a,c} SUM, tempos/confirms concat+dedup by ts.
function mergeRec(a,b){
  a=a||{}; b=b||{}; const r={};
  const SUM=['answered','correct','skipped','events','msSum','msCount'];
  for(const k of SUM){ const v=(a[k]||0)+(b[k]||0); if(v)r[k]=v; }
  const bs=Math.max(a.bestStreak||0,b.bestStreak||0); if(bs)r.bestStreak=bs;
  // firstTs = earliest seen; lastTs = latest seen
  const fts=[a.firstTs,b.firstTs].filter(x=>typeof x==='number');
  if(fts.length)r.firstTs=Math.min(...fts);
  const lts=[a.lastTs,b.lastTs].filter(x=>typeof x==='number');
  if(lts.length)r.lastTs=Math.max(...lts);
  // byKey — per-key {a,c} summed across both sides
  if(a.byKey||b.byKey){ const m={};
    for(const src of [a.byKey,b.byKey]){ if(!src)continue;
      for(const k in src){ m[k]=m[k]||{a:0,c:0}; m[k].a+=src[k].a||0; m[k].c+=src[k].c||0; } }
    r.byKey=m; }
  // tempos / confirms — concat then dedup by ts (ts is a per-event unique stamp)
  const dedupTs=arr=>{ const seen={},out=[]; for(const e of arr){ if(e&&e.ts!=null&&!seen[e.ts]){ seen[e.ts]=1; out.push(e); } else if(e&&e.ts==null){ out.push(e); } } return out; };
  if(a.tempos||b.tempos){ const t=dedupTs([...(a.tempos||[]),...(b.tempos||[])]); if(t.length)r.tempos=t; }
  if(a.confirms||b.confirms){ const c=dedupTs([...(a.confirms||[]),...(b.confirms||[])]); if(c.length)r.confirms=c; }
  return r;
}

// Merge two {day:{tool:rec}} maps. Days present on only one side copy through;
// shared days merge tool-by-tool via mergeRec.
function mergeDayMaps(A,B){
  A=A||{}; B=B||{}; const out={};
  for(const day of new Set([...Object.keys(A),...Object.keys(B)])){
    const da=A[day]||{}, db=B[day]||{}, m={};
    for(const tool of new Set([...Object.keys(da),...Object.keys(db)])){
      if(da[tool]&&db[tool]) m[tool]=mergeRec(da[tool],db[tool]);
      else m[tool]=da[tool]||db[tool];
    }
    out[day]=m;
  }
  return out;
}

// Merge a whole local doc {days} against a remote server doc {devices,days} into a
// single {version,days} view. Folds every device branch's days together plus any
// top-level days (legacy/compat), with `local` as one more branch. Pure + idempotent.
function mergeStatsDocs(local,remote){
  local=local||{}; remote=remote||{};
  let days=local.days||{};
  if(remote.days) days=mergeDayMaps(days,remote.days);
  const devs=remote.devices||{};
  for(const id in devs){ const b=devs[id]; if(b&&b.days) days=mergeDayMaps(days,b.days); }
  return {version:1,days:days};
}

const Stats=(function(){
  const KEY='practiceStats';           // {version:1, days:{ 'YYYY-MM-DD': { tool: rec } }}
  const PREF='toolPrefs';              // { tool: { k: v } }
  const MAX_DAYS=400;                  // cap history so the blob never grows unbounded

  const RKEY='reviewQueue';            // {version:1, items:{ 'tool|key': {tool,key,note,added,due,attempts} }}
  const DKEY='statsDeviceId';          // this device's stable random branch id

  let cache=null, prefCache=null, revCache=null;

  /* ---- cross-device sync (spec: student/practice-stats.json is shared truth) ----
     localStorage stays the synchronous LIVE store for THIS device's branch. On boot
     we fetch the server doc once and cache OTHER devices' merged days in `remoteDays`
     (+ their due review items in `remoteDue`); read helpers overlay these when present.
     Writes always go to the local branch only. Silent no-op when the API is absent
     (static hosting) — never throws, never blocks a render. */
  let remoteDays=null;      // {day:{tool:rec}} merged from OTHER device branches (view only)
  let remoteDue=[];         // other devices' review items, for the due()/pending() overlay view
  let pushTimer=null;       // debounce handle for pushes
  const syncCbs=[];         // Stats.onSync listeners (pages opt in to re-render)
  const hasAPI=typeof fetch==='function'&&typeof window!=='undefined'&&!!window.location;

  function deviceId(){ let id=null;
    try{ id=localStorage.getItem(DKEY); }catch(e){}
    if(!id){ id='d-'+Math.random().toString(36).slice(2)+Date.now().toString(36);
      try{ localStorage.setItem(DKEY,id); }catch(e){} }
    return id; }

  // The days view = this device's local branch overlaid with other devices' branches.
  function viewDays(){ const local=load().days;
    if(!remoteDays) return local;
    return mergeDayMaps(local,remoteDays); }

  function fireSync(){ for(const cb of syncCbs){ try{ cb(); }catch(e){} } }

  // Boot fetch: pull the whole doc, stash OTHER devices' branches (never our own — we
  // already have that live in localStorage), then let pages re-render via onSync.
  function boot(){ if(!hasAPI) return;
    const myId=deviceId();
    fetch('/api/stats',{headers:{'Accept':'application/json'}}).then(r=>r.ok?r.json():null).then(doc=>{
      if(!doc||typeof doc!=='object') return;
      const devs=doc.devices||{}; let days={}, due=[];
      for(const id in devs){ if(id===myId) continue;   // skip our own branch — localStorage is truth for it
        const b=devs[id]; if(!b) continue;
        if(b.days) days=mergeDayMaps(days,b.days);
        if(Array.isArray(b.reviewQueue)) due=due.concat(b.reviewQueue); }
      // top-level days (legacy/compat) fold in too
      if(doc.days) days=mergeDayMaps(days,doc.days);
      remoteDays=days; remoteDue=due;
      fireSync();
    }).catch(()=>{});   // API absent / offline — silently keep localStorage-only view
  }

  // Push THIS device's branch: {deviceId, days, reviewQueue}. Debounced 3s after a
  // save; also flushed on visibilitychange→hidden. Silent failure.
  function pushNow(){ if(!hasAPI) return;
    let items=[]; try{ items=Object.values(loadRev().items); }catch(e){}
    const body={deviceId:deviceId(),days:load().days,reviewQueue:items};
    try{
      fetch('/api/stats',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).catch(()=>{});
    }catch(e){}
  }
  function schedulePush(){ if(!hasAPI) return;
    if(pushTimer) clearTimeout(pushTimer);
    pushTimer=setTimeout(()=>{ pushTimer=null; pushNow(); },3000); }
  function load(){ if(cache)return cache;
    try{ cache=JSON.parse(localStorage.getItem(KEY))||null; }catch(e){ cache=null; }
    if(!cache||cache.version!==1) cache={version:1,days:{}};
    return cache; }
  function save(){ try{
      const d=load().days, keys=Object.keys(d).sort();
      for(let i=0;i<keys.length-MAX_DAYS;i++) delete d[keys[i]];
      localStorage.setItem(KEY,JSON.stringify(cache));
    }catch(e){}
    schedulePush(); }   // fire-and-forget sync of this device's branch (debounced 3s)

  function today(){ const d=new Date(),p=n=>String(n).padStart(2,'0');
    return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); }
  // A local calendar day shifted by `delta` days from `base` (base defaults to today).
  // Parses YYYY-MM-DD as a LOCAL date so due-date math never drifts across time zones.
  function dayShift(delta,base){ const p=n=>String(n).padStart(2,'0');
    let d; if(base){ const [y,m,dd]=base.split('-').map(Number); d=new Date(y,m-1,dd); }
    else d=new Date();
    d.setDate(d.getDate()+delta);
    return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); }

  /* ---- review queue (sleep-aware confirmations, spec pillar 3) ---- */
  // Loaded lazily, same guarded pattern as the stats cache. Shape: RKEY above.
  function loadRev(){ if(revCache)return revCache;
    try{ revCache=JSON.parse(localStorage.getItem(RKEY))||null; }catch(e){ revCache=null; }
    if(!revCache||revCache.version!==1) revCache={version:1,items:{}};
    return revCache; }
  function saveRev(){ try{ localStorage.setItem(RKEY,JSON.stringify(revCache)); }catch(e){}
    schedulePush(); }   // review-queue edits ride the same debounced push
  function revId(tool,key){ return tool+'|'+key; }
  // Record a confirmed re-test onto the day record so the dashboard can count it.
  // Lives under day[tool].confirms=[{key,ts}] alongside the tool's other stats.
  function addConfirm(tool,key){ const r=rec(tool); tick(r);
    r.confirms=r.confirms||[]; r.confirms.push({key:key,ts:Date.now()}); save(); }
  function rec(tool,date){ const days=load().days, k=date||today();
    days[k]=days[k]||{}; const r=days[k][tool]=days[k][tool]||{};
    // lazily-created fields: answered, correct, skipped, bestStreak, msSum, msCount,
    // byKey:{key:{a,c}}, tempos:[{bpm,label,ts}], events, firstTs, lastTs
    return r; }
  function tick(r){ const now=Date.now(); if(!r.firstTs)r.firstTs=now; r.lastTs=now; }

  return {
    today, DOMAINS, // DOMAINS also exposed here for module-ish access

    /* ---- cross-device sync surface ----
       onSync(cb): register a callback fired once the boot fetch merges other devices'
       branches into the view. Pages that already render at boot need nothing (their
       first render is correct locally); this lets a page opt into a re-render when the
       merged data lands. Returns an unsubscribe fn. flush(): force an immediate push
       (used by the visibilitychange handler). deviceId(): this device's branch id. */
    onSync(cb){ if(typeof cb==='function'){ syncCbs.push(cb);
        return ()=>{ const i=syncCbs.indexOf(cb); if(i>=0)syncCbs.splice(i,1); }; } return ()=>{}; },
    flush(){ if(pushTimer){ clearTimeout(pushTimer); pushTimer=null; } pushNow(); },
    deviceId(){ return deviceId(); },

    /* Record one quiz answer. opts: {correct:bool, key:'m3' (optional grouping key),
       ms: response time in ms (optional), streak: current streak AFTER this answer}. */
    record(tool,opts){ const r=rec(tool); tick(r); opts=opts||{};
      r.answered=(r.answered||0)+1;
      if(opts.correct) r.correct=(r.correct||0)+1;
      if(typeof opts.ms==='number'&&opts.ms>=0){ r.msSum=(r.msSum||0)+opts.ms; r.msCount=(r.msCount||0)+1; }
      if(opts.key){ r.byKey=r.byKey||{}; const k=r.byKey[opts.key]=r.byKey[opts.key]||{a:0,c:0};
        k.a++; if(opts.correct)k.c++; }
      if(typeof opts.streak==='number') r.bestStreak=Math.max(r.bestStreak||0,opts.streak);
      save(); },

    /* A skipped question — counted separately, never hurts accuracy. */
    skip(tool){ const r=rec(tool); tick(r); r.skipped=(r.skipped||0)+1; save(); },

    /* Any non-quiz activity (played a drill, ran the metronome…) — keeps the
       day's first/last timestamps fresh so minutes/streaks count. */
    activity(tool){ const r=rec(tool); tick(r); r.events=(r.events||0)+1; save(); },

    /* A clean tempo achieved (metronome accuracy gate, drills). */
    tempo(tool,o){ const r=rec(tool); tick(r); r.tempos=r.tempos||[];
      r.tempos.push({bpm:o.bpm,label:o.label||'',ts:Date.now()}); save(); },

    /* ---- reads ----
       All reads consult viewDays() = this device's local branch overlaid with other
       devices' branches once the boot fetch lands. Writes never touch the overlay. */
    day(tool,date){ return (viewDays()[date||today()]||{})[tool]||null; },
    /* Last n days (oldest→newest) as [{date, data:{tool:rec}}]; includes empty days. */
    recentDays(n){ const out=[],days=viewDays();
      for(let i=n-1;i>=0;i--){ const d=new Date(); d.setDate(d.getDate()-i);
        const p=x=>String(x).padStart(2,'0');
        const key=d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());
        out.push({date:key,data:days[key]||{}}); }
      return out; },
    /* ---- live-session continuity (the guided strip) ----
       A guided session is an explicit ENCOUNTER: coach.js snapshots a per-tool
       baseline (sessionBaseline) into wscPracticeSession at start. session(tool)
       returns THIS encounter's tally — today's merged record minus that baseline —
       so tool pages resume their counters after a refresh/nav, and a second
       session the same day starts from zero. Null when no session is running. */
    sessionBaseline(){ const d=(this.recentDays(1)[0]||{}).data||{},out={};
      for(const t in d){ const r=d[t]||{};
        out[t]={answered:r.answered||0,correct:r.correct||0,events:r.events||0}; }
      return out; },
    session(tool){
      let st=null; try{ st=JSON.parse(localStorage.getItem('wscPracticeSession')||'null'); }catch(e){ return null; }
      if(!st||!st.running||!st.baseline) return null;
      const r=((this.recentDays(1)[0]||{}).data||{})[tool]||{};
      const b=st.baseline[tool]||{};
      return { answered:Math.max(0,(r.answered||0)-(b.answered||0)),
               correct:Math.max(0,(r.correct||0)-(b.correct||0)),
               events:Math.max(0,(r.events||0)-(b.events||0)) };
    },

    /* Totals for one tool over the last n days. */
    totals(tool,nDays){ const t={answered:0,correct:0,skipped:0,minutes:0,bestStreak:0,tempos:[]};
      this.recentDays(nDays||30).forEach(({data})=>{ const r=data[tool]; if(!r)return;
        t.answered+=r.answered||0; t.correct+=r.correct||0; t.skipped+=r.skipped||0;
        t.bestStreak=Math.max(t.bestStreak,r.bestStreak||0);
        if(r.tempos)t.tempos.push(...r.tempos);
        if(r.firstTs&&r.lastTs)t.minutes+=Math.max(1,Math.round((r.lastTs-r.firstTs)/60000)); });
      return t; },
    /* Per-key accuracy for one tool over the last n days: {key:{a,c}}. */
    byKey(tool,nDays){ const m={};
      this.recentDays(nDays||30).forEach(({data})=>{ const r=data[tool]; if(!r||!r.byKey)return;
        for(const k in r.byKey){ m[k]=m[k]||{a:0,c:0}; m[k].a+=r.byKey[k].a; m[k].c+=r.byKey[k].c; } });
      return m; },
    /* Keys with the worst accuracy (≥ min attempts, below the `below` ceiling so
       solid keys never count as weak), worst first — feed adaptive drills. */
    weakKeys(tool,opts){ opts=opts||{}; const min=opts.min||4, below=opts.below||0.86, m=this.byKey(tool,opts.days||30);
      return Object.entries(m).filter(([,v])=>v.a>=min&&v.c/v.a<below)
        .map(([k,v])=>({key:k,acc:v.c/v.a,attempts:v.a}))
        .sort((x,y)=>x.acc-y.acc).slice(0,opts.worst||3); },
    /* Consecutive practice days ending today (any tool activity counts). */
    streakDays(){ const days=viewDays(); let n=0;
      for(let i=0;;i++){ const d=new Date(); d.setDate(d.getDate()-i);
        const p=x=>String(x).padStart(2,'0');
        const key=d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());
        const rec=days[key]; const active=rec&&Object.keys(rec).length>0;
        if(active)n++; else if(i===0)continue; else break; }  // today may be empty and not break a streak
      return n; },

    /* One JSON blob for The Instructor — paste into /instructor or save to student/. */
    export(){ return JSON.stringify({generated:new Date().toISOString(),source:'tools/stats.js',
      streakDays:this.streakDays(),days:viewDays()},null,2); },

    /* ---- ceremony stamps (assets/stamps/*.png — BRAND.md Style B linocuts) ----
       Earned marks computed from the practice record; pages render only earned ones.
       Pressed, not drawn: these mark real events, never participation. */
    stamps(){ const days=viewDays();
      const activeDays=Object.keys(days).filter(k=>Object.keys(days[k]||{}).length>0);
      let answered=0, tempos=0, transcribed=false;
      this.recentDays(365).forEach(({data})=>{ for(const t in data){ const r=data[t];
        answered+=r.answered||0; tempos+=(r.tempos||[]).length;
        if(t==='transcribe')transcribed=true; } });
      const streak=this.streakDays();
      return [
        {id:'shed',     img:'stamp-shed.png',     label:'First day in the shed', earned:activeDays.length>=1},
        {id:'metronome',img:'stamp-metronome.png',label:'First clean tempo gate',earned:tempos>=1},
        {id:'string',   img:'stamp-string.png',   label:'First transcribed take',earned:transcribed},
        {id:'flame',    img:'stamp-flame.png',    label:'7-day streak',          earned:streak>=7},
        {id:'picks',    img:'stamp-picks.png',    label:'100 questions answered',earned:answered>=100},
        {id:'laurel',   img:'stamp-laurel.png',   label:'30 days at the bench',  earned:activeDays.length>=30},
      ]; },

    /* ---- review queue: sleep-aware confirmations (pillar 3) ----
       A drill/tempo/key passed tonight is only CONFIRMED when it's re-passed on a
       later calendar day — accuracy consolidates across sleep, so re-tests are never
       same-day (law 3). Items live under localStorage 'reviewQueue' keyed 'tool|key'. */
    review:{
      /* Enqueue a review, or refresh an existing one. due = next local calendar day
         minimum (never today). opts.note is an optional human hint for the bench card.
         Returns the stored item. */
      add(tool,key,opts){ opts=opts||{}; const items=loadRev().items, id=revId(tool,key);
        const min=dayShift(1); // tomorrow — the earliest a re-test may land
        const ex=items[id];
        if(ex){ if(opts.note!=null)ex.note=opts.note;
          if(!ex.due||ex.due<min)ex.due=min; } // never let a refresh pull the re-test into today
        else items[id]={tool:tool,key:key,note:opts.note||'',added:today(),due:min,attempts:0};
        saveRev(); return items[id]; },
      /* The queue VIEW: this device's local items overlaid with other devices' queued
         items (from the boot fetch, `remoteDue`), keyed by tool|key. LOCAL WINS on a
         collision — completes only ever touch the local branch, so a re-test this
         device already resolved must not reappear from a stale remote copy. Cross-device
         completion syncs on the next push cycle (the completing device drops the item
         from its branch; the other device sees it gone on its next boot fetch). */
      _view(){ const items=loadRev().items, m={};
        for(const it of remoteDue){ if(it&&it.tool&&it.key!=null){ const id=revId(it.tool,it.key); if(!m[id])m[id]=it; } }
        for(const id in items) m[id]=items[id];   // local overrides remote
        return m; },
      /* Items due on/before `dateStr` (defaults to today), oldest due first. */
      due(dateStr){ const d=dateStr||today(), items=this._view();
        return Object.values(items).filter(it=>it.due<=d)
          .sort((a,b)=>a.due<b.due?-1:a.due>b.due?1:0); },
      /* Resolve a due re-test. pass=true → confirmed: remove the item, record a
         confirmation on today's day record, return {confirmed:true,attempts}.
         pass=false → attempts++, push the re-test to tomorrow, {confirmed:false}.
         Completes only touch the LOCAL branch (see _view). */
      complete(tool,key,pass){ const items=loadRev().items, id=revId(tool,key), it=items[id];
        if(!it) return pass?{confirmed:true,attempts:0}:{confirmed:false};
        if(pass){ const attempts=(it.attempts||0)+1; delete items[id]; saveRev();
          addConfirm(tool,key); return {confirmed:true,attempts:attempts}; }
        it.attempts=(it.attempts||0)+1; it.due=dayShift(1); saveRev();
        return {confirmed:false}; },
      /* The queued item for tool|key (local or remote view), or null. */
      pending(tool,key){ return this._view()[revId(tool,key)]||null; },
      /* Every queued item in the view (unsorted array). */
      all(){ return Object.values(this._view()); }
    },

    /* Every confirmation earned across the last n days, flattened & newest-last:
       [{tool, key, ts}]. Feeds the dashboard confirmation counter + improvements. */
    confirmations(nDays){ const out=[];
      this.recentDays(nDays||30).forEach(({data})=>{ for(const tool in data){ const r=data[tool];
        if(r&&r.confirms) r.confirms.forEach(c=>out.push({tool:tool,key:c.key,ts:c.ts})); } });
      return out; },

    /* The "what improved this week" engine (pillar 4, law 4): compares the last
       nDays window against the prior window of equal length and returns an array of
       {kind, label, delta}. Only movements past a meaningful threshold are included,
       so the headline stays honest — no noise dressed up as progress.
         kind 'cleanTempo'    — max clean tempo per label (bpm), threshold |Δ|≥2
         kind 'accuracy'      — per tool, needs ≥10 answered in BOTH windows (pts), ≥3
         kind 'confirmations' — count earned this window (any is worth showing)
         kind 'minutes'       — practice minutes delta, threshold |Δ|≥15 */
    improvements(nDays){ nDays=nDays||7;
      const win=this.recentDays(nDays*2), recent=win.slice(nDays), prior=win.slice(0,nDays);
      // Best clean tempo per label within a window (confirmed-or-gate tempos).
      const tempoMax=days=>{ const m={};
        days.forEach(({data})=>{ for(const tool in data){ const r=data[tool]; if(!r||!r.tempos)continue;
          r.tempos.forEach(t=>{ const lab=t.label||''; m[lab]=Math.max(m[lab]||0,t.bpm||0); }); } });
        return m; };
      // Answered/correct totals per tool within a window.
      const acc=days=>{ const m={};
        days.forEach(({data})=>{ for(const tool in data){ const r=data[tool]; if(!r)continue;
          m[tool]=m[tool]||{a:0,c:0}; m[tool].a+=r.answered||0; m[tool].c+=r.correct||0; } });
        return m; };
      const mins=days=>{ let t=0;
        days.forEach(({data})=>{ for(const tool in data){ const r=data[tool];
          if(r&&r.firstTs&&r.lastTs) t+=Math.max(1,Math.round((r.lastTs-r.firstTs)/60000)); } });
        return t; };
      // Friendly names — sentence-case, no jargon, tool ids mapped to human labels.
      const TOOL_LABEL={'ear-trainer':'Ear trainer accuracy','fretboard-trainer':'Fretboard accuracy',
        'scale-trainer':'Scale trainer accuracy','triad-trainer':'Triad accuracy',
        'metronome':'Metronome accuracy','target-tone':'Target-tone accuracy',
        'technique-drills':'Technique drills accuracy','transcribe':'Transcribe accuracy',
        'tone':'Tone studio accuracy','circle-of-fifths':'Circle of fifths accuracy'};
      const toolLabel=t=>TOOL_LABEL[t]||(t.charAt(0).toUpperCase()+t.slice(1)+' accuracy');
      const out=[];
      // Clean tempo, per label.
      const tr=tempoMax(recent), tp=tempoMax(prior);
      Object.keys(tr).forEach(lab=>{ const delta=tr[lab]-(tp[lab]||0);
        if(Math.abs(delta)>=2) out.push({kind:'cleanTempo',
          label:'Clean tempo'+(lab?' — '+lab:''),delta:delta}); });
      // Accuracy, per tool (needs a real sample in BOTH windows).
      const ar=acc(recent), ap=acc(prior);
      Object.keys(ar).forEach(tool=>{ const R=ar[tool], P=ap[tool];
        if(!P||R.a<10||P.a<10) return;
        const delta=Math.round((R.c/R.a-P.c/P.a)*100);
        if(Math.abs(delta)>=3) out.push({kind:'accuracy',label:toolLabel(tool),delta:delta}); });
      // Confirmations earned this window (any count is worth surfacing).
      const conf=this.confirmations(nDays).length;
      if(conf>0) out.push({kind:'confirmations',label:'Re-tests confirmed',delta:conf});
      // Minutes delta.
      const md=mins(recent)-mins(prior);
      if(Math.abs(md)>=15) out.push({kind:'minutes',label:'Practice minutes',delta:md});
      return out; },

    /* Thin calendar wrapper: [{date, active, minutes}] for the last n days
       (oldest→newest), for the neutral practice-pattern grid (law 4, no flame). */
    patternDays(n){ return this.recentDays(n||14).map(({date,data})=>{
      let minutes=0, active=false;
      for(const tool in data){ active=true; const r=data[tool];
        if(r&&r.firstTs&&r.lastTs) minutes+=Math.max(1,Math.round((r.lastTs-r.firstTs)/60000)); }
      return {date:date,active:active,minutes:minutes}; }); },

    /* ---- per-tool UI prefs (settings that should survive reload) ---- */
    getPref(tool,key,fallback){ if(!prefCache){ try{ prefCache=JSON.parse(localStorage.getItem(PREF))||{}; }catch(e){ prefCache={}; } }
      const t=prefCache[tool]; return t&&key in t?t[key]:fallback; },
    setPref(tool,key,val){ this.getPref(tool,'',null); prefCache[tool]=prefCache[tool]||{};
      prefCache[tool][key]=val; try{ localStorage.setItem(PREF,JSON.stringify(prefCache)); }catch(e){} },

    // Exposed for tests + the module.exports guard below (pure, no side effects).
    mergeStatsDocs: mergeStatsDocs, _mergeRec: mergeRec, _mergeDayMaps: mergeDayMaps,

    /* Kick off the one-shot boot fetch + register the hidden-tab flush. Called
       automatically below; idempotent-safe to leave to auto-run. */
    _boot: boot
  };
})();

// Boot the sync layer: fetch other devices' branches once, flush any pending push
// when the tab is hidden (covers navigations/close before the 3s debounce fires).
// All silent + guarded — a static host with no /api/stats keeps working unchanged.
if(typeof window!=='undefined'){
  try{ Stats._boot(); }catch(e){}
  try{ document.addEventListener('visibilitychange',function(){ if(document.visibilityState==='hidden'){ try{ Stats.flush(); }catch(e){} } }); }catch(e){}
}

// Node/test guard — lets `require('./stats.js')` reach the pure merge helpers without
// a browser. (In the browser this block is skipped; classic-script globals stay.)
if(typeof module!=='undefined'&&module.exports){
  module.exports={ mergeStatsDocs:mergeStatsDocs, mergeRec:mergeRec, mergeDayMaps:mergeDayMaps, DOMAINS:DOMAINS, DOMAIN_SHORT:DOMAIN_SHORT };
}
