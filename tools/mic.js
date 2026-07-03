/* Shared microphone layer — ONE input device setting for the whole Woodshed.
   Plain classic script (injected on every page by header.js, like coach.js).
   Provides global: WoodshedMic.

   Why: getUserMedia({audio:true}) opens the OS "default/communications" device,
   which on a typical Windows rig is the webcam mic — while the guitar sits on the
   audio interface. Every listening tool (tuner, bend lab, chord lab, metronome
   groove, transcribe, coach recorder) now opens its stream through here, honoring
   one persisted device choice, surfaced as a picker in the site header.

   API:
     WoodshedMic.getStream(extra?)  -> Promise<MediaStream> — guitar-appropriate
        defaults (echoCancellation/noiseSuppression/autoGainControl OFF) + the saved
        device; `extra` merges into the audio constraints. If the saved device is
        gone (unplugged), falls back to default, clears the setting, and still
        resolves. Also refreshes the picker labels (permission unlocks them).
     WoodshedMic.getDeviceId() / setDeviceId(id)   — persisted (localStorage 'micDeviceId')
     WoodshedMic.listInputs()  -> Promise<[{deviceId,label}]>
     WoodshedMic.showPicker()  — inject the header picker now (pages with mic
        features call this on boot; it also auto-appears on first getStream). */
(function () {
  var KEY = 'micDeviceId';
  var LEGACY_KEY = 'transcribeMicId';   // transcribe's page-local setting, migrated once
  var deviceId = '';
  try {
    deviceId = localStorage.getItem(KEY);
    if (deviceId == null) {   // one-time migration from the transcribe-local choice
      deviceId = localStorage.getItem(LEGACY_KEY) || '';
      if (deviceId) localStorage.setItem(KEY, deviceId);
    }
  } catch (e) { deviceId = ''; }
  deviceId = deviceId || '';

  function getDeviceId() { return deviceId; }
  function setDeviceId(id) {
    deviceId = id || '';
    try { deviceId ? localStorage.setItem(KEY, deviceId) : localStorage.removeItem(KEY); } catch (e) {}
    try { localStorage.setItem(LEGACY_KEY, deviceId); } catch (e) {}   // keep transcribe's local UI in step
    syncPicker();
    document.dispatchEvent(new CustomEvent('micdevice', { detail: deviceId }));
  }

  // constraint builder (pure — exported for tests)
  function buildConstraints(id, extra) {
    var audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    if (extra) for (var k in extra) audio[k] = extra[k];
    if (id) audio.deviceId = { exact: id };
    return { audio: audio };
  }

  function getStream(extra) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.reject(Object.assign(new Error('Mic needs localhost or HTTPS.'), { name: 'NotSupportedError' }));
    }
    return navigator.mediaDevices.getUserMedia(buildConstraints(deviceId, extra)).catch(function (e) {
      // remembered device unplugged/renamed → fall back to default, clear, retry once
      if (deviceId && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')) {
        setDeviceId('');
        return navigator.mediaDevices.getUserMedia(buildConstraints('', extra));
      }
      throw e;
    }).then(function (stream) {
      ensurePicker();          // permission granted → labels are now readable
      refreshOptions();
      return stream;
    });
  }

  function listInputs() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return Promise.resolve([]);
    return navigator.mediaDevices.enumerateDevices().then(function (all) {
      return all.filter(function (d) { return d.kind === 'audioinput'; })
        .map(function (d, i) { return { deviceId: d.deviceId, label: d.label || ('Microphone ' + (i + 1)) }; });
    }).catch(function () { return []; });
  }

  // ---- header picker (mic glyph + select), styled like the voice picker ----
  var sel = null;
  function ensurePicker() {
    if (sel || !document.body) return;
    var host = document.querySelector('.site-header .hdr-actions');
    sel = document.createElement('select');
    sel.id = 'micPick';
    sel.title = 'Microphone input — applies to every tool on the site';
    sel.setAttribute('aria-label', sel.title);
    if (host) { sel.className = 'hdr-mic'; host.insertBefore(sel, host.firstChild); }
    else {   // pages without the injected header (none today; belt & braces)
      sel.style.cssText = 'position:fixed;top:16px;right:210px;height:36px;border-radius:8px;border:1px solid var(--line);background:var(--panel);color:var(--ink);font-size:13px;padding:0 8px;z-index:50;cursor:pointer';
      document.body.appendChild(sel);
    }
    sel.addEventListener('change', function () { setDeviceId(sel.value); });
    // devices come and go (USB interfaces!) — keep the list honest
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
      try { navigator.mediaDevices.addEventListener('devicechange', refreshOptions); } catch (e) {}
    }
    refreshOptions();
  }
  function refreshOptions() {
    if (!sel) return;
    listInputs().then(function (ins) {
      var opts = '<option value="">Default microphone</option>';
      for (var i = 0; i < ins.length; i++) {
        opts += '<option value="' + ins[i].deviceId.replace(/"/g, '&quot;') + '">' +
          String(ins[i].label).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }) + '</option>';
      }
      sel.innerHTML = opts;
      syncPicker();
    });
  }
  function syncPicker() {
    if (!sel) return;
    var has = false;
    for (var i = 0; i < sel.options.length; i++) if (sel.options[i].value === deviceId) has = true;
    sel.value = has ? deviceId : '';
  }
  function showPicker() {
    if (document.body) ensurePicker();
    else document.addEventListener('DOMContentLoaded', ensurePicker);
  }

  if (typeof window !== 'undefined') {
    window.WoodshedMic = {
      getStream: getStream, getDeviceId: getDeviceId, setDeviceId: setDeviceId,
      listInputs: listInputs, showPicker: showPicker, buildConstraints: buildConstraints,
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { buildConstraints: buildConstraints };
})();
