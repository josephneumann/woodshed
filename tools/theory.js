/* Shared music-theory primitives for the practice tools.
   Plain classic script (no build step / module system) — every name below is a
   global by design. Load it SYNCHRONOUSLY in <head> (NOT defer) BEFORE a tool's
   own inline <script>, e.g.  <script src="theory.js"></script>
   so these globals exist when the inline code runs. */

// chromatic pitch classes; index = semitones above C
const NOTES=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

// standard tuning · string index 0 = low E (6th string) … 5 = high e (1st string)
const OPEN_MIDI=[40,45,50,55,59,64];   // open-string MIDI numbers
const OPEN_SEMI=[4,9,2,7,11,4];        // open-string pitch classes (OPEN_MIDI % 12)
const STR_NAMES=['E','A','D','G','B','e'];

// intervals as [shortName, semitones]
const INTERVALS=[['m2',1],['M2',2],['m3',3],['M3',4],['P4',5],['TT',6],['P5',7],['m6',8],['M6',9],['m7',10],['M7',11],['P8',12]];
const INTERVAL_LONG={m2:'minor 2nd',M2:'major 2nd',m3:'minor 3rd',M3:'major 3rd',P4:'perfect 4th',TT:'tritone',P5:'perfect 5th',m6:'minor 6th',M6:'major 6th',m7:'minor 7th',M7:'major 7th',P8:'octave'};

// chord-quality formulas (semitones from the root)
const QUAL={maj:[0,4,7],min:[0,3,7],dim:[0,3,6],aug:[0,4,8],'7':[0,4,7,10],maj7:[0,4,7,11],min7:[0,3,7,10],min7b5:[0,3,6,10],dim7:[0,3,6,9]};

// scale formulas (semitones from the root) — named SCALE_DEFS so tools with an
// older inline `SCALES` const don't collide while they migrate.
const SCALE_DEFS={
  major:{name:'Major',iv:[0,2,4,5,7,9,11]},
  minor:{name:'Natural minor',iv:[0,2,3,5,7,8,10]},
  majPent:{name:'Major pentatonic',iv:[0,2,4,7,9]},
  minPent:{name:'Minor pentatonic',iv:[0,3,5,7,10]},
  blues:{name:'Blues',iv:[0,3,5,6,7,10]}
};

// helpers — string/fret → pitch class, note name, MIDI; semitones → interval name
function pcAt(str,fret){return (OPEN_SEMI[str]+fret)%12;}
function noteAt(str,fret){return NOTES[pcAt(str,fret)];}
function midiAt(str,fret){return OPEN_MIDI[str]+fret;}
function intervalName(semi){const iv=INTERVALS.find(i=>i[1]===semi);return iv?iv[0]:null;}
