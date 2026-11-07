// The walks Gemini can match to. Only people whose walk has been described in movement terms in the
// fashion press are listed, paraphrased here. These are press impressions, not measurements, which is
// why the app names a closest match and never shows a similarity percentage. Sources, read 7 November 2026:
//   Yahoo Style UK, "An Analysis Of The 10 Most Memorable Supermodel Runway Walks", 29 January 2024
//     https://uk.style.yahoo.com/analysis-10-most-memorable-supermodel-133400941.html
//   Jezebel, "Just Hire Mannequins: On the Slow Death of the Runway Walk", 7 September 2017
//     https://jezebel.com/just-hire-mannequins-on-the-slow-death-of-the-runway-w-1797921627
//   Kate Moss's calm, stroll-like walk: fashion-press summaries found by search on 7 November 2026.
// The underscore keeps Vercel from turning this file into a function of its own.
export const PROFILES = [
  { id: 'campbell', name: 'Naomi Campbell', tag: 'The Main Event', walk: 'An attitude-heavy strut that says all eyes on me, with a fixed, unbroken stare.' },
  { id: 'kloss', name: 'Karlie Kloss', tag: 'The Panther', walk: 'Stalks the line like a panther: the hips lead, the arms move with intent, the gaze stays locked.' },
  { id: 'bundchen', name: 'Gisele Bündchen', tag: 'The Criss-Cross', walk: 'Snakes down the line in a criss-cross march with a strong stomp, and lets the arms swing loose on the turn.' },
  { id: 'rocha', name: 'Coco Rocha', tag: 'The Theatre', walk: 'Theatrical and angular, with a small head movement on each step and a stop and pose at the end.' },
  { id: 'dunn', name: 'Jourdan Dunn', tag: 'The Serene Sashay', walk: 'Legs close together and very little movement at the waist: a calm, subtle sashay.' },
  { id: 'bieber', name: 'Hailey Bieber', tag: 'The Long Stride', walk: 'Large, fast strides with a wide stance and gait.' },
  { id: 'tougaard', name: 'Mona Tougaard', tag: 'The Cool Glide', walk: 'An effortless, cool glide with subtle, elegant movement.' },
  { id: 'roslyakova', name: 'Vlada Roslyakova', tag: 'The Speed Walk', walk: 'A quick, twitchy speed-walk with energy in every step.' },
  { id: 'moss', name: 'Kate Moss', tag: 'The Stroll', walk: 'A calm, relaxed, stroll-like walk with a raw, unforced ease.' },
];
