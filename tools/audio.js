/* Shared Web-Audio synth for the practice tools.
   Plain classic script — load SYNCHRONOUSLY in <head> (NOT defer) BEFORE a tool's
   own inline <script>. Provides globals: ac(), tone(), setVoice(), getVoice().
   If the page has a checkbox id="audio", tone() treats it as a mute toggle.

   Three voices (picker auto-injected top-right, choice persisted in localStorage):
   - pluck : Karplus-Strong plucked string (noise burst through a lossy delay line)
   - piano : additive partials, sharp attack + exponential decay (percussive)
   - synth : filtered sawtooth with an ADSR-ish envelope
   No samples, no dependencies. */

let __toneCtx=null;
function ac(){if(!__toneCtx)__toneCtx=new(window.AudioContext||window.webkitAudioContext)();__toneCtx.resume();return __toneCtx;}

// ---- voices: each renders one note at absolute time t for `dur` seconds at gain `vol` ----
function voicePluck(a,freq,t,dur,vol,dest){
  const sr=a.sampleRate, N=Math.max(2,Math.round(sr/freq));
  const ring=new Float32Array(N); for(let i=0;i<N;i++) ring[i]=Math.random()*2-1;
  const len=Math.ceil(sr*(dur+0.05)), buf=a.createBuffer(1,len,sr), out=buf.getChannelData(0);
  let idx=0; const decay=0.996;
  for(let i=0;i<len;i++){ const c=ring[idx]; out[i]=c; ring[idx]=0.5*(c+ring[(idx+1)%N])*decay; idx=(idx+1)%N; }
  const atk=Math.max(1,(sr*0.004)|0), rel=Math.max(1,(sr*0.05)|0);
  for(let i=0;i<len;i++){ const e=i<atk?i/atk:(i>len-rel?(len-i)/rel:1); out[i]*=e*vol; }
  const g=a.createGain(); g.connect(dest);
  const s=a.createBufferSource(); s.buffer=buf; s.connect(g); s.start(t);
  return {src:s, gain:g};
}
function voicePiano(a,freq,t,dur,vol,dest){
  const sr=a.sampleRate, len=Math.ceil(sr*(dur+0.1)), buf=a.createBuffer(1,len,sr), out=buf.getChannelData(0);
  const partials=[[1,1],[2,0.5],[3,0.28],[4,0.16],[5,0.09],[6,0.05]], TwoPi=2*Math.PI;
  const tau=0.4+200/freq;                                   // lower notes ring longer
  for(let i=0;i<len;i++){
    const tt=i/sr; let s=0;
    for(const [h,amp] of partials){ const inh=1+0.0008*h*h; s+=amp*Math.sin(TwoPi*freq*h*inh*tt); }
    out[i]=s*Math.exp(-tt/tau)*Math.min(1,tt*400);           // sharp attack, exp decay
  }
  const norm=(0.5/2.08)*vol; for(let i=0;i<len;i++) out[i]*=norm;
  const rel=Math.max(1,(sr*0.04)|0); for(let i=len-rel;i<len;i++) out[i]*=(len-i)/rel;
  const g=a.createGain(); g.connect(dest);
  const s=a.createBufferSource(); s.buffer=buf; s.connect(g); s.start(t);
  return {src:s, gain:g};
}
function voiceSynth(a,freq,t,dur,vol,dest){
  const o=a.createOscillator(), g=a.createGain(), lp=a.createBiquadFilter();
  o.type='triangle'; o.frequency.value=freq;               // soft, rounded tone
  lp.type='lowpass'; lp.frequency.value=Math.min(3200,freq*3); lp.Q.value=0.4;
  g.gain.setValueAtTime(0,t);
  g.gain.linearRampToValueAtTime(vol,t+0.05);              // gentle attack
  g.gain.setValueAtTime(vol,t+Math.max(0.06,dur*0.7));
  g.gain.exponentialRampToValueAtTime(0.0008,t+dur);
  const k=a.createGain(); k.gain.value=1;                  // dedicated kill-gain for stopTones() (separate from the ADSR on g)
  o.connect(lp).connect(g).connect(k).connect(dest);
  o.start(t); o.stop(t+dur+0.05);
  return {src:o, gain:k};
}
const VOICES={pluck:voicePluck, piano:voicePiano, synth:voiceSynth};

let __voice='pluck';
try{ __voice=VOICES[localStorage.getItem('toneVoice')]?localStorage.getItem('toneVoice'):'pluck'; }catch(e){}
function getVoice(){return __voice;}
function setVoice(v){ if(VOICES[v]){ __voice=v; try{ localStorage.setItem('toneVoice',v); }catch(e){} } }

// ---- global mute (persisted; toggled by the header's speaker button) ----
let __muted=false;
try{ __muted=localStorage.getItem('toneMute')==='1'; }catch(e){}
function getMuted(){return __muted;}
function setMuted(m){ __muted=!!m; try{ localStorage.setItem('toneMute',__muted?'1':'0'); }catch(e){}
  if(__muted)stopTones();
  document.dispatchEvent(new CustomEvent('tonemute',{detail:__muted})); }

// ---- active-voice registry so a tool can cut carryover when starting the next sound ----
let __activeVoices=[];
function stopTones(){                                       // fade out + stop every note currently sounding or scheduled
  if(!__toneCtx) return;
  const now=__toneCtx.currentTime, voices=__activeVoices; __activeVoices=[];
  for(const v of voices){
    try{ if(v.gain){ v.gain.gain.cancelScheduledValues(now); v.gain.gain.setValueAtTime(v.gain.gain.value,now); v.gain.gain.linearRampToValueAtTime(0.0001, now+0.012); } }catch(e){}
    try{ v.src.stop(now+0.02); }catch(e){}                  // before its start time => the note is cancelled; while playing => 20ms tail under the fade
  }
}

// midi note · start offset (s) · duration (s) · peak gain — all optional (tone(midi) = 1s note at 0.3)
function tone(midi,start,dur,vol,dest){
  if(__muted)return;                                                    // header speaker toggle
  const cb=document.getElementById('audio'); if(cb&&!cb.checked)return; // optional per-page mute
  const a=ac(), freq=440*Math.pow(2,(midi-69)/12);
  const v=(VOICES[__voice]||voicePluck)(a, freq, a.currentTime+(start||0), dur||1.0, vol||0.3, dest||a.destination, midi);
  if(v&&v.src){ __activeVoices.push(v); v.src.onended=()=>{ const i=__activeVoices.indexOf(v); if(i>=0)__activeVoices.splice(i,1); }; }
  return v;
}

// ---- auto-inject a compact voice picker (top-right, left of the theme toggle) ----
(function(){
  function add(){
    if(document.getElementById('voicePick')) return;
    const sel=document.createElement('select');
    sel.id='voicePick'; sel.title='Instrument voice';
    sel.style.cssText='position:fixed;top:16px;right:60px;height:36px;border-radius:8px;border:1px solid var(--line);background:var(--panel);color:var(--ink);font-size:13px;padding:0 8px;z-index:50;cursor:pointer';
    [['pluck','Plucked'],['piano','Piano'],['synth','Synth']].forEach(([v,label])=>{
      const o=document.createElement('option'); o.value=v; o.textContent=label; if(v===__voice)o.selected=true; sel.appendChild(o);
    });
    sel.addEventListener('change',function(){ setVoice(sel.value); try{ tone(64,0,0.7,0.3); }catch(e){} }); // preview the voice
    document.body.appendChild(sel);
  }
  if(document.body) add(); else document.addEventListener('DOMContentLoaded',add);
})();
