/*
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | The monster teachers: which of the app's own monsters teaches which subject, its color, its accessory and its voice
 *
 * Names come from REWARD_CATALOG in routes/education-rewards-routes.js, so a teacher in a
 * lesson is a monster a student can also collect. The hues are tuned against this art so each
 * teacher looks like their name. Changing a voice here and running narrate.py with --retake
 * is all it takes to recast a teacher.
 */
LessonStudio.teachers = {
  pinky: {
    name: 'Pinky', subject: 'math', hue: 9, sat: 1.14, light: 1.2,
    voice: 'Achird', model: 'gemini-3.1-flash-tts-preview',
    notes: 'Warm, playful and curious, with a real smile in the voice. Loves catching a sneaky trick and letting the student in on it.',
    accessory: `<g fill="rgba(255,255,255,.07)" stroke="#2c1838" stroke-width="15">
      <circle cx="482" cy="600" r="158"/><circle cx="818" cy="600" r="158"/></g>
      <path d="M640,590 Q650,574 660,590" fill="none" stroke="#2c1838" stroke-width="15" stroke-linecap="round"/>`,
  },
  bluebold: {
    name: 'Bluebold', subject: 'grammar and writing', hue: 262, sat: 1.2, light: 1.25,
    voice: 'Leda', model: 'gemini-3.8-flash-lite-tts',
    notes: 'Bright, quick and a little theatrical. Treats grammar as a detective game and delights in catching a sentence red-handed.',
    accessory: `<g transform="translate(650,1040)">
      <path d="M0,0 L-118,-62 Q-136,0 -118,62 Z M0,0 L118,-62 Q136,0 118,62 Z" fill="#ff5a5f" stroke="#a81f2c" stroke-width="10" stroke-linejoin="round"/>
      <rect x="-30" y="-34" width="60" height="68" rx="20" fill="#ff7a7e" stroke="#a81f2c" stroke-width="10"/></g>`,
  },
  tealy: {
    name: 'Tealy', subject: 'reading', hue: 226, sat: 1.18, light: 1.22,
    voice: 'Laomedeia', model: 'gemini-2.5-flash-preview-tts',
    notes: 'Thoughtful and friendly, curious about what writers really mean. Calm energy with little sparks of delight when a clue turns up.',
    accessory: `<g transform="translate(960,402)">
      <g fill="#ffe27a" stroke="#d99a1e" stroke-width="7">
      <ellipse cx="0" cy="-48" rx="32" ry="42"/><ellipse cx="46" cy="-15" rx="42" ry="32"/><ellipse cx="28" cy="40" rx="32" ry="42" transform="rotate(-36 28 40)"/>
      <ellipse cx="-28" cy="40" rx="32" ry="42" transform="rotate(36 -28 40)"/><ellipse cx="-46" cy="-15" rx="42" ry="32"/></g>
      <circle r="26" fill="#ff8a5c" stroke="#c9562a" stroke-width="7"/></g>`,
  },
  sprout: {
    name: 'Sprout', subject: 'science', hue: 150, sat: 1.1, light: 1.25,
    voice: 'Fenrir', model: 'gemini-2.5-flash-preview-tts',
    notes: 'Excitable and curious, a young scientist who cannot wait to see what the experiment does. Fast thinker, big grin.',
    accessory: `<g transform="translate(650,330)">
      <path d="M-300,30 Q0,-60 300,30" fill="none" stroke="#3f4a57" stroke-width="30"/>
      <g fill="rgba(170,235,255,.5)" stroke="#3f4a57" stroke-width="18"><rect x="-200" y="-56" width="170" height="108" rx="46"/><rect x="30" y="-56" width="170" height="108" rx="46"/></g>
      <rect x="-30" y="-16" width="60" height="24" rx="10" fill="#3f4a57"/></g>`,
  },
};
