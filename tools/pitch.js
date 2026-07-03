/* pitch.js — shared monophonic pitch detection engine for The Woodshed.
   Classic script (no ES modules). Exposes window.WoodshedPitch in the browser,
   and module.exports in Node (for tests). Browser-only bits are guarded by
   typeof window so require()/eval works headless.

   Detection: McLeod Pitch Method (MPM) — normalized square difference function
   (NSDF) + parabolic peak interpolation. Robust against the strong harmonics of
   plucked guitar strings (won't lock onto an octave/overtone the way naive
   autocorrelation does).
*/
(function (root) {
  'use strict';

  var A4 = 440;
  var A4_MIDI = 69;
  var NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  // ---- note math -------------------------------------------------------------
  function freqToMidi(f) {
    return 69 + 12 * Math.log2(f / A4);
  }
  function midiToFreq(m) {
    return A4 * Math.pow(2, (m - A4_MIDI) / 12);
  }
  function midiToNoteName(m) {
    var r = Math.round(m);
    var name = NAMES[((r % 12) + 12) % 12];
    var octave = Math.floor(r / 12) - 1; // MIDI 60 = C4
    return name + octave;
  }
  // nearest equal-tempered pitch + how many cents the freq sits off it
  function centsOff(f) {
    var midiFloat = freqToMidi(f);
    var midi = Math.round(midiFloat);
    var cents = (midiFloat - midi) * 100;
    return { note: midiToNoteName(midi), midi: midi, cents: cents };
  }

  // ---- core detector ---------------------------------------------------------
  // detect(buf, sampleRate) — PURE. buf is a Float32Array time-domain window
  // (~2048 samples). Returns {freq, clarity, rms} or null (silence / unclear).
  var DEFAULT_RMS_THRESH = 0.008; // reject near-silence
  var DEFAULT_CLARITY_THRESH = 0.8; // MPM peak quality gate

  function detect(buf, sampleRate, opts) {
    opts = opts || {};
    var rmsThresh = opts.rmsThresh == null ? DEFAULT_RMS_THRESH : opts.rmsThresh;
    var clarityThresh =
      opts.clarityThresh == null ? DEFAULT_CLARITY_THRESH : opts.clarityThresh;

    var n = buf.length;
    if (n < 128) return null;

    // RMS gate
    var sumSq = 0;
    for (var i = 0; i < n; i++) sumSq += buf[i] * buf[i];
    var rms = Math.sqrt(sumSq / n);
    if (rms < rmsThresh) return null;

    // NSDF via the McLeod normalized square difference.
    //   m'(tau) = sum_{j} (x[j]-x[j+tau])^2  is minimized where signal is periodic.
    //   NSDF n'(tau) = 2*r'(tau) / m'(tau) where
    //     r'(tau) = sum x[j]*x[j+tau]   (autocorrelation)
    //     m'(tau) = sum x[j]^2 + x[j+tau]^2
    // n' ranges in [-1, 1]; periodicity shows up as peaks approaching 1.
    var maxTau = n >> 1; // only lags with reasonable overlap
    var nsdf = new Float32Array(maxTau);
    for (var tau = 0; tau < maxTau; tau++) {
      var acf = 0;
      var m = 0;
      for (var j = 0; j + tau < n; j++) {
        var a = buf[j];
        var b = buf[j + tau];
        acf += a * b;
        m += a * a + b * b;
      }
      nsdf[tau] = m > 0 ? (2 * acf) / m : 0;
    }

    // Peak picking (McLeod): find the first "key maximum" after the NSDF drops
    // below zero. Among all key maxima collect them, then pick the first that
    // clears clarityThresh * (highest key-max value). This defeats octave errors.
    var peaks = [];
    var pos = 0;
    // skip the initial positive lobe until nsdf crosses below zero
    while (pos < maxTau - 1 && nsdf[pos] > 0) pos++;
    // then skip the negative region until it comes back positive
    while (pos < maxTau - 1 && nsdf[pos] <= 0) pos++;

    var curMaxTau = -1;
    var curMaxVal = -1;
    for (; pos < maxTau; pos++) {
      if (nsdf[pos] > 0) {
        if (nsdf[pos] > curMaxVal) {
          curMaxVal = nsdf[pos];
          curMaxTau = pos;
        }
      } else {
        // just went negative — the max we were tracking is a key maximum
        if (curMaxTau !== -1) {
          peaks.push(curMaxTau);
          curMaxTau = -1;
          curMaxVal = -1;
        }
        // skip the negative region
        while (pos < maxTau - 1 && nsdf[pos] <= 0) pos++;
      }
    }
    if (curMaxTau !== -1) peaks.push(curMaxTau); // trailing max

    if (!peaks.length) return null;

    // highest key-max value
    var highest = 0;
    for (var p = 0; p < peaks.length; p++) {
      if (nsdf[peaks[p]] > highest) highest = nsdf[peaks[p]];
    }
    if (highest <= 0) return null;

    var threshold = clarityThresh * highest;
    var chosen = peaks[0];
    for (var q = 0; q < peaks.length; q++) {
      if (nsdf[peaks[q]] >= threshold) {
        chosen = peaks[q];
        break;
      }
    }

    // parabolic interpolation around the chosen lag for sub-sample precision
    var t0 = chosen;
    var refined = t0;
    var clarity = nsdf[t0];
    if (t0 > 0 && t0 < maxTau - 1) {
      var y0 = nsdf[t0 - 1];
      var y1 = nsdf[t0];
      var y2 = nsdf[t0 + 1];
      var denom = 2 * (2 * y1 - y2 - y0);
      if (denom !== 0) {
        var shift = (y2 - y0) / denom;
        // clamp — interpolation should stay within +-1 sample
        if (shift > -1 && shift < 1) {
          refined = t0 + shift;
          clarity = y1 - ((y0 - y2) * (y0 - y2)) / (8 * (2 * y1 - y0 - y2));
        }
      }
    }

    if (refined <= 0) return null;
    var freq = sampleRate / refined;

    // guitar-sane range gate: ~55 Hz (A1) to ~1400 Hz (well above E5)
    if (freq < 55 || freq > 1400) return null;
    if (clarity < clarityThresh) return null;

    return { freq: freq, clarity: clarity, rms: rms };
  }

  // ---- full frame helper (freq -> note/midi/cents) --------------------------
  function analyze(buf, sampleRate, opts) {
    var d = detect(buf, sampleRate, opts);
    if (!d) return { freq: null, clarity: 0, rms: 0 };
    var c = centsOff(d.freq);
    return {
      freq: d.freq,
      clarity: d.clarity,
      rms: d.rms,
      note: c.note,
      midi: c.midi,
      cents: c.cents,
    };
  }

  var api = {
    detect: detect,
    analyze: analyze,
    freqToMidi: freqToMidi,
    midiToFreq: midiToFreq,
    midiToNoteName: midiToNoteName,
    centsOff: centsOff,
    A4: A4,
    NAMES: NAMES,
  };

  // ---- mic wrapper (browser only) -------------------------------------------
  if (typeof window !== 'undefined') {
    // createMic({onFrame, onError, fftSize, intervalMs}) -> {stop()}
    // Must be called from a user gesture (getUserMedia + AudioContext).
    api.createMic = function (cfg) {
      cfg = cfg || {};
      var fftSize = cfg.fftSize || 2048;
      var intervalMs = cfg.intervalMs || 40; // ~25 fps analysis
      var onFrame = cfg.onFrame || function () {};
      var onError = cfg.onError || function () {};
      var opts = cfg.opts || {};

      var ctx = null;
      var stream = null;
      var source = null;
      var analyser = null;
      var raf = null;
      var buf = null;
      var stopped = false;
      var lastTime = 0;
      var t0 = 0;

      // Open through the shared mic layer when present (honors the site-wide input
      // device chosen in the header); raw-constraint fallback keeps this file
      // standalone-testable. Both paths disable EC/NS/AGC — vital for guitar.
      (window.WoodshedMic && window.WoodshedMic.getStream
        ? window.WoodshedMic.getStream()
        : navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
            video: false,
          }))
        .then(function (s) {
          if (stopped) {
            s.getTracks().forEach(function (t) { t.stop(); });
            return;
          }
          stream = s;
          ctx = new (window.AudioContext || window.webkitAudioContext)();
          source = ctx.createMediaStreamSource(stream);
          analyser = ctx.createAnalyser();
          analyser.fftSize = fftSize;
          source.connect(analyser);
          buf = new Float32Array(analyser.fftSize);
          t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
          loop();
        })
        .catch(function (err) {
          onError(err);
        });

      function loop() {
        if (stopped) return;
        raf = requestAnimationFrame(loop);
        var now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        if (now - lastTime < intervalMs) return;
        lastTime = now;
        analyser.getFloatTimeDomainData(buf);
        var res = analyze(buf, ctx.sampleRate, opts);
        onFrame({
          t: (now - t0) / 1000,
          freq: res.freq,
          note: res.note || null,
          midi: res.freq ? res.midi : null,
          cents: res.freq ? res.cents : null,
          clarity: res.clarity,
          rms: res.rms,
        });
      }

      function stop() {
        stopped = true;
        if (raf) { cancelAnimationFrame(raf); raf = null; }
        if (source) { try { source.disconnect(); } catch (e) {} }
        if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); }
        if (ctx && ctx.state !== 'closed') { try { ctx.close(); } catch (e) {} }
      }

      return { stop: stop };
    };

    root.WoodshedPitch = api;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : this);
