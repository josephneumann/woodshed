// analyze.js — decode a recorded blob, run Spotify Basic Pitch, and hand back a
// compact machine-detected diagnostic the Instructor can actually read.
//
// ES module (Vite rewrites the bare imports). Self-contained on purpose: this is
// the coach-drawer path (mic → analyze → debrief). It mirrors how tools/transcribe.html
// drives Basic Pitch, but does NOT reuse it — transcribe stays the full-fat tool.
//
//   import { analyzeBlob } from './analyze.js'
//   const { durationSec, noteCount, notes, report } = await analyzeBlob(blob)
//
// notes: [{midi, start, dur, amp}]  (compact — same shape the take archive stores)
// report: a text diagnostic like transcribe's Instructor report (duration, count,
//         note list with names+times, inter-onset CV when computable).

import * as tf from '@tensorflow/tfjs'
import { BasicPitch, outputToNotesPoly, addPitchBendsToNoteEvents, noteFramesToTime } from '@spotify/basic-pitch'

const SR = 22050
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const noteName = (m) => NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1)
// standard-tuning playable range (open low E … high e + 15 frets); drop harmonics/mis-detections outside it
const OPEN_MIDI = [40, 45, 50, 55, 59, 64], MAX_FRET = 15
const playable = (midi) => midi >= OPEN_MIDI[0] && midi <= OPEN_MIDI[5] + MAX_FRET

// Basic Pitch thresholds — the tool's defaults (onset, frame, min note length in frames)
const ONSET = 0.5, FRAME = 0.3, MINLEN = 11
const EVT_GAP = 0.14   // onsets within this many seconds count as one strum/event

// lazy AudioContext (decode + offline resample both need one)
let actx = null
function audioCtx() {
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)()
  if (actx.state === 'suspended') actx.resume()
  return actx
}

async function resampleTo22050(audioBuffer) {
  const len = Math.max(1, Math.ceil(audioBuffer.duration * SR))
  const off = new OfflineAudioContext(1, len, SR)
  const src = off.createBufferSource()
  src.buffer = audioBuffer
  src.connect(off.destination)
  src.start()
  const r = await off.startRendering()
  return r.getChannelData(0)
}

// lazy model (served at /basic-pitch-model/model.json by the dev server)
let bp = null
async function ensureModel() {
  if (bp) return bp
  await tf.ready()
  const modelUrl = new URL('/basic-pitch-model/model.json', location.origin).href
  bp = new BasicPitch(modelUrl)
  await bp.model
  return bp
}

// group notes by onset proximity so a strum = one event (the report's onset count/CV basis)
function toEvents(notes) {
  const ns = [...notes].sort((a, b) => a.startTimeSeconds - b.startTimeSeconds)
  const out = []
  let cur = null
  for (const n of ns) {
    if (!cur || n.startTimeSeconds - cur.t > EVT_GAP) { cur = { t: n.startTimeSeconds, notes: [] }; out.push(cur) }
    cur.notes.push(n)
  }
  return out
}

// Build the text diagnostic — same spirit as transcribe's buildReport(), trimmed to
// what the coach can reason from (it can't hear audio; this IS the take, in words).
function buildReport(notes, durationSec) {
  if (!notes.length) return 'RECORDING ANALYSIS — no notes detected. The take was too quiet, too short, or off the guitar\'s range. Try recording closer to the mic.'
  const pcs = [...new Set(notes.map((n) => ((n.pitchMidi % 12) + 12) % 12))].sort((a, b) => a - b).map((p) => NAMES[p])
  const evs = toEvents(notes)
  const onsets = evs.map((e) => +e.t.toFixed(3))
  const iois = onsets.slice(1).map((t, i) => +(t - onsets[i]).toFixed(3))
  let timing = '(too few onsets to assess timing)'
  if (iois.length >= 2) {
    const sorted = [...iois].sort((a, b) => a - b), med = sorted[Math.floor(sorted.length / 2)]
    const mean = iois.reduce((a, b) => a + b, 0) / iois.length
    const sd = Math.sqrt(iois.reduce((a, b) => a + (b - mean) * (b - mean), 0) / iois.length)
    const cv = mean ? sd / mean : 0, bpm = med ? Math.round(60 / med) : 0
    timing = `median IOI ${med.toFixed(3)}s → ~${bpm} BPM if each onset is one beat (rough) · steadiness CV ${cv.toFixed(2)} (lower = tighter)`
  }
  const list = [...notes].sort((a, b) => a.startTimeSeconds - b.startTimeSeconds).slice(0, 80)
    .map((n) => `${noteName(n.pitchMidi).padEnd(4)} @ ${n.startTimeSeconds.toFixed(2)}s  len ${n.durationSeconds.toFixed(2)}s  conf ${Math.round((n.amplitude || 0) * 100)}%`).join('\n')
  return [
    'RECORDING ANALYSIS — machine-detected (Basic Pitch). Pitches & timing are estimated; you cannot hear the audio, so reason from these plus what the student says.',
    `Duration ${durationSec.toFixed(1)}s · ${notes.length} notes · ${evs.length} onset events`,
    `Pitch classes present: ${pcs.join(' ')}`,
    `ONSET TIMES (s): ${onsets.join(', ')}`,
    `TIMING: ${timing}`,
    '',
    `NOTES${notes.length > 80 ? ' (first 80)' : ''}:`,
    list,
  ].join('\n')
}

export async function analyzeBlob(blob) {
  const model = await ensureModel()
  const arrayBuffer = await blob.arrayBuffer()
  const audioBuffer = await audioCtx().decodeAudioData(arrayBuffer)
  const durationSec = audioBuffer.duration
  const float32 = await resampleTo22050(audioBuffer)

  // evaluateModel calls back once PER BATCH — accumulate, don't overwrite, or only
  // the last chunk survives (notes would all land at t=0)
  const F = [], O = [], C = []
  await model.evaluateModel(float32, (frames, onsets, contours) => {
    for (const r of frames) F.push(r)
    for (const r of onsets) O.push(r)
    for (const r of contours) C.push(r)
  }, () => {})

  let notes = outputToNotesPoly(F, O, ONSET, FRAME, MINLEN)
  notes = addPitchBendsToNoteEvents(C, notes)
  const timed = noteFramesToTime(notes)
    .filter((n) => playable(n.pitchMidi))
    .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds)

  const compact = timed.map((n) => ({
    midi: n.pitchMidi,
    start: +(n.startTimeSeconds || 0).toFixed(3),
    dur: +(n.durationSeconds || 0).toFixed(3),
    amp: +(n.amplitude || 0).toFixed(3),
  }))

  return {
    durationSec: +durationSec.toFixed(2),
    noteCount: timed.length,
    notes: compact,
    report: buildReport(timed, durationSec),
  }
}
