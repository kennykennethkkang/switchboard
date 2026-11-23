import type { CourtColors, Skin } from '.'

// Orbital Fleet: the court as a fleet in orbit. Same layout and cast; the board draws planetoids, station modules and warp lanes for it.
// Starside: a bright nebula near a star. Metal decks, suited crews, status colors kept from abyss so they read the same.
const starside: CourtColors = {
  ink: '#070a1a', ink2: '#202a4a', red_dk: '#8a2a12', red: '#ff7a1f', red_lt: '#ff5fd2', gold_dk: '#b07a1a', gold: '#ffc23d', gold_lt: '#ffe9a0',
  jade_dk: '#0f5e5a', jade: '#22b49c', jade_lt: '#7af7d6', peach_dk: '#a8407a', peach: '#ff9ad6', peach_lt: '#ffd6ef', cloud: '#eef4ff', cloud_sh: '#a9b8d8',
  blue: '#2f5fc0', blue_lt: '#7cc8ff', sky: '#8fb4ff', brown_dk: '#262c44', brown: '#4e5876', skin: '#f0c9a8', plum: '#9a7ae0',
  wood_dk: '#141a30', wood: '#2a3354', wood_lt: '#4b5a85', rail: '#7cf0ff', stone_dk: '#232a4a', stone: '#38426a', stone_ln: '#2c355a',
  hall: '#aeb8d2', beam: '#7af7d6', roof: '#dfe6f8', roof_dk: '#6c7898', roof_lt: '#ffffff', azure: '#5a6fae', azure_dk: '#2c3768', azure_lt: '#9db0ea',
}
// Darkside: deep space, decks go dim and every light carries further.
const darkside: CourtColors = {
  ...starside,
  ink: '#03040c', ink2: '#1a2240', cloud: '#dfe8ff', cloud_sh: '#9aa9cc', gold_lt: '#ffe48a',
  wood_dk: '#0a0e1e', wood: '#1a2140', wood_lt: '#34406a', stone_dk: '#151a34', stone: '#232b4d', stone_ln: '#1c2343',
  hall: '#8590ae', roof: '#b9c3de', roof_dk: '#4c5676', roof_lt: '#e6ecfa', azure: '#3e4f88', azure_dk: '#1e2650', azure_lt: '#7286c4',
}

export const orbit: Skin = {
  id: 'orbit', art: 'orbit', name: 'Orbital Fleet', info: 'A fleet in orbit: each chat a station, each role a suited crew member.',
  palette: { bg: '#1c2f66', ink: '#eef4ff', accent: '#ffc23d', active: '#ffd84a', done: '#7af7d6', warn: '#ff5fd2', panel: '#0b0f22', trim: '#8fd8ff' },
  court: { colors: starside, bands: ['#241a58', '#28216a', '#2a2c7a', '#283c86', '#264d8c', '#255d8e', '#2a6a8c'] },
  night: {
    palette: { bg: '#04050e', ink: '#eef4ff', accent: '#ffd84a', active: '#ffe48a', done: '#7af7d6', warn: '#ff5fd2', panel: '#070a18', trim: '#7cc8ff' },
    court: { colors: darkside, bands: ['#0b0a22', '#0a0a1f', '#09091b', '#080818', '#070714', '#060611', '#04050e'] },
  },
  copy: { title: 'Orbital Fleet', empty: 'No ships in orbit. Launch one to start a mission.', done: 'Every mission has docked home.' },
  belt: {
    name: 'Flight deck',
    items: {
      new: { item: 'Launch a ship', hint: 'Send a new crew into orbit' },
      next: { item: 'Long-range scan', hint: 'Find the next chat that needs you' },
      todo: { item: 'Flight plan', hint: 'The missions ahead: open the to-do' },
      limits: { item: 'Fuel cell', hint: 'How much fuel is left' },
      changes: { item: 'Cargo pod', hint: 'Dock the changes and commit' },
      mode: { item: 'Starside and darkside', hint: 'The fleet flies day and night' },
    },
    // A rocket, a dish, a star chart, a fuel cell and a cargo pod.
    sprites: {
      new: ['.....ww.....', '....wuuw....', '....wuuw....', '....wwww....', '....wsww....', '...rwwwwr...', '..rrwsswrr..', '..rRwwwwRr..', '....kkkk....', '....yggy....', '.....gy.....', '.....y......'],
      next: ['.........y..', '.ww.....yy..', '.wsw...y....', '..wsw.k.....', '..wssk......', '...wssw.....', '....wssw....', '.....wwww...', '......kk....', '.....kkkk...', '....ssssss..', '............'],
      todo: ['.uuuuuuuuuu.', 'uUUUUUUUUUUu', 'uUkkkkkkkkUu', 'uUkykkkkkkUu', 'uUkklkkkukUu', 'uUkkklkkkkUu', 'uUkkkklkkkUu', 'uUkukkklykUu', 'uUkkkkkkkkUu', 'uUUUUUUUUUUu', '.uuuuuuuuuu.', '....UUUU....'],
      limits: ['....kkkk....', '...kwwwwk...', '..UUUUUUUU..', '..UlllllsU..', '..UjjjjjjU..', '..UjjjjjjU..', '..UjjjjjjU..', '..UJJJJJJU..', '..UJJJJJJU..', '..UkkkkkkU..', '..UUUUUUUU..', '...k....k...'],
      changes: ['............', '.....yy.....', '....kkkk....', '..wwwwwwww..', '.wssssssssw.', '.wsgGsgGssw.', '.wsGgsGgssw.', '.wssssssssw.', '.wwwwwwwwww.', '..ss....ss..', '..k......k..', '............'],
    },
  },
  // HUD glass: navy plate, cyan scan edge.
  chrome: { plate: '#08142a', edge: '#7cf0ff', text: '#e6faff', mute: '#8fd8ff', font: 'Silkscreen, ui-monospace, Menlo, monospace', radius: 3 },
  font: 'Silkscreen, ui-monospace, Menlo, monospace',
}
