import type { CourtColors, Skin } from '.'

// Dragon Palace: the East Sea under Ao Guang, the deep water Wukong dives to for his staff. Its own cast (court-cast SEA) and art kit.
// Shallows: jade water, vermilion lacquer, turquoise glazed roofs, gold and pearl. Pink-magenta stays the needs-you color.
const shallows: CourtColors = {
  ink: '#071a1e', ink2: '#1e3a40', red_dk: '#8a2a1e', red: '#ff6a45', red_lt: '#ff5fd2', gold_dk: '#a8781a', gold: '#ffc23d', gold_lt: '#ffe48a',
  jade_dk: '#0f5e52', jade: '#1fae8a', jade_lt: '#7ff0c8', peach_dk: '#c0506a', peach: '#ff9a8a', peach_lt: '#ffd6cc', cloud: '#f2fbf8', cloud_sh: '#a8d4cc',
  blue: '#2a6aa0', blue_lt: '#6fd4ff', sky: '#5fc0d0', brown_dk: '#3a2a22', brown: '#6a4a38', skin: '#f0c9a0', plum: '#8a4aa0',
  wood_dk: '#5a1e1a', wood: '#a8382a', wood_lt: '#d8624a', rail: '#ffc23d', stone_dk: '#1f4c50', stone: '#3a7a78', stone_ln: '#2e6664',
  hall: '#c8452e', beam: '#ffc23d', roof: '#4fd6c8', roof_dk: '#1f8a88', roof_lt: '#c8fff0', azure: '#1c5e6e', azure_dk: '#123f4c', azure_lt: '#4f9aa8',
}
// The trench: the lacquer and glaze sink into the dark, the pearls and gold carry the light.
const trench: CourtColors = {
  ...shallows,
  ink: '#02090c', ink2: '#142a30', sky: '#2f7f90', cloud: '#e6fbf6', cloud_sh: '#86b8b0',
  wood_dk: '#3a1214', wood: '#74261e', wood_lt: '#a8442e', stone_dk: '#0e2a2e', stone: '#1f4a4a', stone_ln: '#183c3e',
  jade_dk: '#0a3f38', jade: '#14806a', hall: '#8a2e22', roof: '#2fa8a0', roof_dk: '#145e5e', roof_lt: '#8ae8dc', azure: '#0f3a44', azure_dk: '#0a2630', azure_lt: '#2f6a78',
}

export const abyss: Skin = {
  id: 'abyss', art: 'abyss', name: 'Dragon Palace', info: "The Dragon King's crystal palace under the East Sea: each chat a hall of the court, each role one of Ao Guang's subjects.",
  family: { id: 'journey-west', name: 'Journey to the West', preset: 'Dragon Palace' },
  palette: { bg: '#0f4a58', ink: '#f2fbf8', accent: '#ffc23d', active: '#ffd84a', done: '#7ff0c8', warn: '#ff5fd2', panel: '#3a1214', trim: '#ffc23d' },
  court: { colors: shallows, bands: ['#5fc9c0', '#48b5b0', '#36a0a2', '#288a92', '#1d7480', '#155e6c', '#0f4a58'] },
  night: {
    palette: { bg: '#020b12', ink: '#e6fbf6', accent: '#ffd84a', active: '#ffe48a', done: '#7ff0c8', warn: '#ff5fd2', panel: '#0a1c22', trim: '#c8a04a' },
    court: { colors: trench, bands: ['#0a2a36', '#082431', '#061e2a', '#051924', '#04141e', '#031018', '#020b12'] },
  },
  copy: { title: 'Dragon Palace of the East Sea', empty: 'The palace is still. Blow the conch to call a new guest down.', done: 'Every hall has paid its tribute. The sea is calm.' },
  belt: {
    name: "Dragon King's treasury",
    items: {
      new: { item: 'Conch horn', hint: 'Call a new guest down to the palace' },
      next: { item: 'Water-parting spell', hint: 'Dive to the next chat that needs you' },
      todo: { item: 'Tribute ledger', hint: 'The work ahead: open the to-do' },
      limits: { item: 'Night-shining pearl', hint: 'How much light the pearl has left' },
      changes: { item: 'Treasure chest', hint: 'Gather the changes and commit' },
      mode: { item: 'Shallows and trench', hint: 'The palace keeps both waters' },
    },
    // 12x12 in board-tools INK letters: a conch, the sea parting on a gold path, a pearl in its clam.
    sprites: {
      new: ['............', '.........ww.', '.......wwqw.', '.....wwqqqw.', '...wwqqPqqw.', '..wqqqPqqqw.', '.wqqPqqqqw..', 'wqqqqqqqw...', 'wPPqqqqw....', '.wwPqqw.....', '...wwww.....', '............'],
      next: ['uuu......uuu', 'Uuu......uuU', 'UUu..yy..uUU', 'UUu..yy..uUU', 'UUuu.gg.uuUU', 'UUUu.gg.uUUU', 'UUUu.gg.uUUU', 'UUUu.gg.uUUU', 'UUUu.gg.uUUU', 'UUUUugguUUUU', 'ssssssssssss', '............'],
      limits: ['............', '....wwww....', '...wywwws...', '..wywwwwss..', '..wwwwwwss..', '...wwwsss...', '....ssss....', '.P........P.', 'PPppppppppPP', '.PppPppPppP.', '..PPPPPPPP..', '............'],
    },
  },
  // Deep jade plate, coral edge, pearl text; rounded like a pearl's setting.
  chrome: { plate: '#0b2f36', edge: '#ff8a6a', text: '#f4fbf8', mute: '#9fe8d6', font: 'Silkscreen, ui-monospace, Menlo, monospace', radius: 5 },
  font: 'Silkscreen, ui-monospace, Menlo, monospace',
}
