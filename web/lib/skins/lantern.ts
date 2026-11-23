import type { CourtColors, Skin } from '.'

// Lantern Sea: night islands floating on a moonlit sea, every desk with a lamp. Smooth illustrated art; the dusk look is the day mode.
// Status colors: working gold, waiting amber (cloud_sh), stuck red, needs pink, done mint.
const night: CourtColors = {
  ink: '#040816', ink2: '#16203f', red_dk: '#7a1f2a', red: '#ff4d5e', red_lt: '#ff7ad1', gold_dk: '#a8741c', gold: '#ffd34e', gold_lt: '#fff0a8',
  jade_dk: '#0e5a54', jade: '#26b59b', jade_lt: '#6ff0c2', peach_dk: '#9a4a6a', peach: '#ff9fb4', peach_lt: '#ffd3dc', cloud: '#e8f0ff', cloud_sh: '#f2a24a',
  blue: '#3b6fd4', blue_lt: '#8ec8ff', sky: '#9fb8ff', brown_dk: '#1c1830', brown: '#3b2f4e', skin: '#f4d2b4', plum: '#9a7ae0',
  wood_dk: '#0b1230', wood: '#1a2650', wood_lt: '#34478a', rail: '#9fe8ff', stone_dk: '#16214a', stone: '#26356e', stone_ln: '#1d2a5c',
  hall: '#3a4a86', beam: '#9fe8ff', roof: '#5a6fc0', roof_dk: '#2a3a80', roof_lt: '#a0b4f0', azure: '#4a64b8', azure_dk: '#222f70', azure_lt: '#8ea8f0',
}
const dusk: CourtColors = {
  ...night,
  ink: '#2a1a3e', ink2: '#4a3560', cloud: '#fff4ec', sky: '#ffc2a0', blue: '#6a80d8', blue_lt: '#b4d0ff', skin: '#f8dcc0',
  wood_dk: '#3a2a5e', wood: '#5a4a86', wood_lt: '#8a78b4', stone_dk: '#4a3a78', stone: '#6a5a9a', stone_ln: '#5a4a88',
  hall: '#8a78b4', roof: '#a08ad0', roof_dk: '#5a4488', roof_lt: '#e0d0ff', azure: '#7a78d0', azure_dk: '#44408a', azure_lt: '#b4b0f4', rail: '#ffe0b8',
}

// Belt icons: smooth paper-lantern art on the dark belt plate. Flat fills, no gradient ids, so many can share a page.
const PAPER = '#ffb36b', RIB = '#c8643a', CAP = '#5a3a6e', FLAME = '#ffe27a', GLOW = '#ffd34e', HULL = '#a07ad8', WAVE = '#8ec8ff', MOON = '#fff0c8'
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`
const HUMANIST = "Optima, Candara, 'Gill Sans', 'Hanken Grotesk', system-ui, sans-serif"

export const lantern: Skin = {
  id: 'lantern', art: 'lantern', name: 'Lantern Sea', info: 'Night islands on a moonlit sea: each chat a lit desk, each role a lantern keeper.',
  palette: { bg: '#4a3a78', ink: '#fff4ec', accent: '#ffd34e', active: '#ffe27a', done: '#6ff0c2', warn: '#ff7ad1', panel: '#1c1534', trim: '#ffc2a0' },
  court: { colors: dusk, bands: ['#3b2f6e', '#5a3f84', '#8a5a9a', '#c0728f', '#f09a8a', '#ffb89a', '#ffd0a0'] },
  night: {
    palette: { bg: '#050a1f', ink: '#e8f0ff', accent: '#ffd34e', active: '#ffe27a', done: '#6ff0c2', warn: '#ff7ad1', panel: '#070d22', trim: '#8ec8ff' },
    court: { colors: night, bands: ['#050a1f', '#08122c', '#0a1638', '#0d1c44', '#112650', '#173056', '#1c3a60'] },
  },
  copy: { title: 'Lantern Sea', empty: 'No lamps lit. Start a chat to light one.', done: 'Every lamp is out. All work is done.' },
  belt: {
    name: 'Lantern pier',
    items: {
      new: { item: 'Paper lantern', hint: 'Light a new lamp on the sea' },
      next: { item: 'Night ferry', hint: 'Ride to the next lamp that needs you' },
      todo: { item: 'Lantern string', hint: 'Lamps still to light: open the to-do' },
      limits: { item: 'Oil jar', hint: 'How much lamp oil is left' },
      changes: { item: 'Floating lamp', hint: 'Set the changes on the tide and commit' },
      mode: { item: 'Moon and tide', hint: 'Dusk glow or deep night' },
    },
    icons: {
      new: svg(`<ellipse cx="12" cy="13" rx="9" ry="9" fill="${GLOW}" opacity=".22"/><rect x="10" y="2" width="4" height="3" rx="1" fill="${CAP}"/><path d="M12 5c-4.4 0-6.5 3.4-6.5 7.5S7.6 20 12 20s6.5-3.4 6.5-7.5S16.4 5 12 5z" fill="${PAPER}"/><path d="M12 5c-1.6 2-2.3 4.6-2.3 7.5S10.4 18 12 20M12 5c1.6 2 2.3 4.6 2.3 7.5S13.6 18 12 20" stroke="${RIB}" stroke-width="1" fill="none"/><ellipse cx="12" cy="14" rx="2.2" ry="3" fill="${FLAME}"/><rect x="10" y="20" width="4" height="2" rx="1" fill="${CAP}"/>`),
      next: svg(`<path d="M15 3v9" stroke="${CAP}" stroke-width="1.4" stroke-linecap="round"/><circle cx="15" cy="5" r="4" fill="${GLOW}" opacity=".25"/><rect x="13.2" y="3.4" width="3.6" height="4.4" rx="1.6" fill="${PAPER}"/><circle cx="15" cy="5.8" r="1" fill="${FLAME}"/><path d="M2.5 13h19l-2.8 4.6c-.4.6-1 .9-1.7.9H7c-.7 0-1.3-.3-1.7-.9z" fill="${HULL}"/><rect x="7" y="10" width="6" height="3" rx="1" fill="${PAPER}"/><path d="M2 21.5c2 0 2-1.3 4-1.3s2 1.3 4 1.3 2-1.3 4-1.3 2 1.3 4 1.3 2-1.3 4-1.3" stroke="${WAVE}" stroke-width="1.4" fill="none" stroke-linecap="round"/>`),
      todo: svg(`<path d="M2 5c6 5 14 5 20 0" stroke="${CAP}" stroke-width="1.2" fill="none"/><g fill="${PAPER}"><rect x="3.6" y="8" width="4.4" height="6" rx="2.2"/><rect x="9.8" y="10" width="4.4" height="6.5" rx="2.2"/><rect x="16" y="8" width="4.4" height="6" rx="2.2"/></g><g fill="${FLAME}"><circle cx="5.8" cy="11.5" r="1"/><circle cx="12" cy="13.6" r="1"/><circle cx="18.2" cy="11.5" r="1"/></g><g stroke="${CAP}" stroke-width="1.2" stroke-linecap="round"><path d="M5.8 6.6v1.4M12 8.2v1.8M18.2 6.6v1.4M5.8 14v2M12 16.5v2.2M18.2 14v2"/></g>`),
      limits: svg(`<path d="M9 2.5h6v2.5H9z" fill="${CAP}"/><path d="M8.5 5h7c0 2 3 3 3 7.5v5c0 2.2-1.8 4-4 4h-5c-2.2 0-4-1.8-4-4v-5c0-4.5 3-5.5 3-7.5z" fill="${HULL}"/><path d="M5.5 13.5h13v4c0 2.2-1.8 4-4 4h-5c-2.2 0-4-1.8-4-4z" fill="${FLAME}"/><path d="M5.5 13.5h13" stroke="${GLOW}" stroke-width="1"/><path d="M8 8.5c.6-.9 1.2-1.4 1.8-1.8" stroke="${PAPER}" stroke-width="1.2" fill="none" stroke-linecap="round" opacity=".7"/>`),
      changes: svg(`<circle cx="12" cy="10" r="7" fill="${GLOW}" opacity=".22"/><path d="M7.5 7.5h9l-.8 8h-7.4z" fill="${PAPER}"/><path d="M7 7.5h10M12 7.5v8" stroke="${RIB}" stroke-width="1"/><path d="M9.5 4.5h5l2 3h-9z" fill="${CAP}"/><ellipse cx="12" cy="12.6" rx="1.6" ry="2" fill="${FLAME}"/><path d="M4.5 15.5h15l-1.5 2.5H6z" fill="${HULL}"/><path d="M2 21c2 0 2-1.3 4-1.3s2 1.3 4 1.3 2-1.3 4-1.3 2 1.3 4 1.3 2-1.3 4-1.3" stroke="${WAVE}" stroke-width="1.4" fill="none" stroke-linecap="round"/>`),
      mode: svg(`<circle cx="13" cy="9" r="8" fill="${GLOW}" opacity=".18"/><path d="M15.5 2.8a7 7 0 1 0 4.7 11.4A5.6 5.6 0 0 1 15.5 2.8z" fill="${MOON}"/><path d="M2 17c2.2 0 2.2-1.5 4.4-1.5s2.2 1.5 4.4 1.5 2.2-1.5 4.4-1.5 2.2 1.5 4.4 1.5 2.2-1.5 4.4-1.5M2 21c2.2 0 2.2-1.5 4.4-1.5s2.2 1.5 4.4 1.5 2.2-1.5 4.4-1.5 2.2 1.5 4.4 1.5 2.2-1.5 4.4-1.5" stroke="${WAVE}" stroke-width="1.4" fill="none" stroke-linecap="round"/>`),
      skin: svg(`<path d="M12 21 3 9.5a11.5 11.5 0 0 1 18 0z" fill="${PAPER}"/><path d="M12 21 7 6.2M12 21l5-14.8M12 21V5" stroke="${RIB}" stroke-width="1"/><path d="M3 9.5a11.5 11.5 0 0 1 18 0" stroke="${HULL}" stroke-width="1.6" fill="none"/><circle cx="12" cy="20" r="1.6" fill="${CAP}"/><circle cx="8.5" cy="11" r="1.3" fill="${FLAME}"/><circle cx="15.5" cy="11" r="1.3" fill="${WAVE}"/>`),
    },
  },
  chrome: { plate: '#33202e', edge: '#f2a24a', text: '#fff1dc', mute: '#f6c08a', font: HUMANIST, radius: 10 },
  font: HUMANIST,
}
