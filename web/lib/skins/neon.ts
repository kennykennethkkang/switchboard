import type { CourtColors, Skin } from '.'

// Neon Harbor: a night-market harbor of rooftops. Dusk by day, deep violet at night; status hues stay amber, red, magenta and mint.
const dusk: CourtColors = {
  ink: '#0a0614', ink2: '#2a2142', red_dk: '#4c0f3c', red: '#ff4d5e', red_lt: '#ff4fd8', gold_dk: '#b8650f', gold: '#ffb020', gold_lt: '#ffe27a',
  jade_dk: '#0b5a5a', jade: '#19b3a6', jade_lt: '#5dffd6', peach_dk: '#a03a8a', peach: '#ff7ac8', peach_lt: '#ffc8ec', cloud: '#f2ecff', cloud_sh: '#a99ccf',
  blue: '#2a5fd8', blue_lt: '#4fe3ff', sky: '#7aa8ff', brown_dk: '#2a2238', brown: '#6a5c8c', skin: '#f2c6a6', plum: '#9a6bff',
  wood_dk: '#160f2a', wood: '#261c44', wood_lt: '#3d3068', rail: '#ff9a3d', stone_dk: '#1a1430', stone: '#2a2248', stone_ln: '#382d5e',
  hall: '#2a2050', beam: '#5df2ff', roof: '#43357a', roof_dk: '#1e1840', roof_lt: '#8f7dff', azure: '#2c2160', azure_dk: '#1a1340', azure_lt: '#5a48b0',
}
// Midnight: the stone goes darker so the trim and windows carry the scene.
const midnight: CourtColors = {
  ...dusk,
  ink: '#05030c', ink2: '#221a38', cloud: '#e8e2ff', cloud_sh: '#8f84b8',
  wood_dk: '#0d0820', wood: '#1a1334', wood_lt: '#2e2558', stone_dk: '#110c22', stone: '#1e1838', stone_ln: '#2a2250',
  hall: '#1c1640', roof: '#33296a', roof_dk: '#141030', azure: '#1f1850', azure_dk: '#120d30', azure_lt: '#4a3aa0',
}

export const neon: Skin = {
  id: 'neon', art: 'neon', name: 'Neon Harbor', info: 'A night-market harbor of rooftops: each chat a lit platform, each role a runner on the grid.',
  palette: { bg: '#160a2a', ink: '#f2ecff', accent: '#ffb020', active: '#ffe27a', done: '#5dffd6', warn: '#ff4fd8', panel: '#0e0b1a', trim: '#8f7dff' },
  court: { colors: dusk, bands: ['#1a0f3d', '#26124e', '#361760', '#4c1e6c', '#4a1b64', '#30104a', '#1c0a32'] },
  night: {
    palette: { bg: '#07030f', ink: '#f2ecff', accent: '#ffb020', active: '#ffe27a', done: '#5dffd6', warn: '#ff4fd8', panel: '#09070f', trim: '#8f7dff' },
    court: { colors: midnight, bands: ['#05030f', '#09051c', '#0f082a', '#170b38', '#160a34', '#0f0626', '#08040f'] },
  },
  copy: { title: 'Neon Harbor', empty: 'The harbor is dark. Hail a cab to light up a rooftop.', done: 'Every rooftop has shipped its cargo.' },
  belt: {
    name: 'Street kit',
    items: {
      new: { item: 'Hail a cab', hint: 'Send a new runner up to a rooftop' },
      next: { item: 'Signal mast', hint: 'Find the next chat that needs you' },
      todo: { item: 'Job board', hint: 'The runs ahead: open the to-do' },
      limits: { item: 'Power cell', hint: 'How much charge is left' },
      changes: { item: 'Cargo drop', hint: 'Ship the changes and commit' },
      mode: { item: 'Dusk and midnight', hint: 'The harbor never sleeps' },
    },
    sprites: {
      new: ['............', '............', '...bbbbb....', '..buuUuub...', '.ggggggggg..', 'yggggggggggr', '.GGGGGGGGGG.', '..BB....BB..', '............', '.p.p..p..p..', '............', '............'],
      next: ['..uuuuuuuu..', '.u........u.', 'u..uuuuuu..u', '..u......u..', '....uuuu....', '...u....u...', '.....pp.....', '.....pp.....', '.....bb.....', '....bbbb....', '...bbbbbb...', '..bbbbbbbb..'],
      todo: ['............', 'uuuuuuuuuuuu', 'u..........u', 'u.pp.yyyyy.u', 'u..........u', 'u.pp.yyy...u', 'u..........u', 'u.ll.yyyy..u', 'u..........u', 'uuuuuuuuuuuu', '.....bb.....', '...bbbbbb...'],
      limits: ['....bbbb....', '..bbbbbbbb..', '..b......b..', '..b.llll.b..', '..b.llll.b..', '..b.llll.b..', '..b.jjjj.b..', '..b.jjjj.b..', '..b.JJJJ.b..', '..b.JJJJ.b..', '..b......b..', '..bbbbbbbb..'],
      changes: ['.uu......uu.', 'uuuu....uuuu', '..b......b..', '..bbbbbbbb..', '.....bb.....', '..gggggggg..', '..gG....Gg..', '..g.G..G.g..', '..g..GG..g..', '..g.G..G.g..', '..gG....Gg..', '..gggggggg..'],
      mode: ['............', '....yyyy....', '..yyyyyyyy..', '.yyyyyyyyyy.', '.gggggggggg.', 'gggggggggggg', '............', 'pppppppppppp', '.pppppppppp.', '............', '..PPPPPPPP..', '............'],
    },
  },
  // Black glass, a cyan tube for an edge, pink sub-lines.
  chrome: { plate: '#0b0816', edge: '#4fe3ff', text: '#f2ecff', mute: '#ff9ae6', font: 'Silkscreen, ui-monospace, Menlo, monospace', radius: 0 },
  font: 'Silkscreen, ui-monospace, Menlo, monospace',
}
