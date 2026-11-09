import type { CourtColors, Skin } from '.'

// Drawn in code; font credit in public/skins/journey-west/CREDITS.md.
// Day: vermilion lacquer, jade and gamboge under a clear morning sky.
export const courtColors: CourtColors = {
  ink: '#1a1423', ink2: '#3b2a3a', red_dk: '#8a2626', red: '#cf3f33', red_lt: '#f07856', gold_dk: '#a5621a', gold: '#e8a92a', gold_lt: '#f8d96a',
  jade_dk: '#256b55', jade: '#3fa275', jade_lt: '#8fd8a6', peach_dk: '#c25c76', peach: '#f29ea8', peach_lt: '#fcd6d0', cloud: '#fffaf0', cloud_sh: '#d6d6ea',
  blue: '#3f5fa0', blue_lt: '#7aa0d8', sky: '#b4d2f0', brown_dk: '#5a3a2a', brown: '#8a5a3c', skin: '#f4c79a', plum: '#6b4a7a',
  wood_dk: '#5f281c', wood: '#93503a', wood_lt: '#b86e48', rail: '#b8321a', stone_dk: '#b6ae9f', stone: '#dcd5c6', stone_ln: '#c8c0af',
  hall: '#e8461f', beam: '#3c9888', roof: '#f2c43c', roof_dk: '#c8961e', roof_lt: '#fbe59e', azure: '#2c5e92', azure_dk: '#1f466e', azure_lt: '#5c8cc0',
}
// Night: moonlit indigo, lantern-lit halls, pale blue clouds. Label hues stay bright for the dark plates.
const night: CourtColors = {
  ...courtColors,
  ink: '#0a0916', ink2: '#2a2238', red_dk: '#7a2430', red: '#c8413c', red_lt: '#ff8a66', gold_dk: '#9a6a22', gold: '#f2b640', gold_lt: '#ffe08a',
  jade_dk: '#1c4a48', jade: '#2e6e62', jade_lt: '#86d6b0', peach_dk: '#a85a7c', peach: '#e49ab4', peach_lt: '#f6cfe0', cloud: '#b9c3e6', cloud_sh: '#8d98c6',
  blue: '#4a5f9e', blue_lt: '#93b0ec', sky: '#2a3566', skin: '#e8b98e', plum: '#7d5a95',
  wood_dk: '#3a1c1c', wood: '#6a3a30', wood_lt: '#8f553e', rail: '#a8342a', stone_dk: '#4c5070', stone: '#6c7194', stone_ln: '#5d6284',
  hall: '#ff7a2e', beam: '#2f6f72', roof: '#d6a23e', roof_dk: '#9e7426', roof_lt: '#ffd27a', azure: '#2a4c80', azure_dk: '#1c3560', azure_lt: '#5378b0',
}

export const journeyWest: Skin = {
  id: 'journey-west', name: 'Journey West', info: 'The pilgrims on the road west: each chat a traveler, each role a disciple.',
  palette: { bg: '#1e2348', ink: '#f8f4ea', accent: '#e8a92a', active: '#ffc53d', done: '#6fe39a', warn: '#ff5a4a', panel: '#641c22', trim: '#e8a92a' },
  court: { colors: courtColors, bands: ['#8cb4ea', '#9dc0ee', '#b0ccf0', '#c4d8f0', '#d9e0ee', '#ecdfe2', '#fad6cc'] },
  night: {
    palette: { bg: '#0b1030', ink: '#eef0fa', accent: '#f2b640', active: '#ffd27a', done: '#86d6b0', warn: '#ff8a66', panel: '#1a1d3e', trim: '#c9a04a' },
    court: { colors: night, bands: ['#070a22', '#0c1130', '#121a40', '#19234e', '#212c5a', '#2b3463', '#3a3c6a'] },
  },
  copy: { title: 'Celestial Court', empty: 'The court is quiet. Raise the staff to send a pilgrim west.', done: 'Every desk has shipped. The scriptures are home.' },
  belt: {
    name: "Pilgrim's pack",
    items: {
      new: { item: 'Golden-banded staff', hint: 'Send a new pilgrim west' },
      next: { item: 'Somersault cloud', hint: 'Fly to the next chat that needs you' },
      todo: { item: 'Sutra scroll', hint: 'The road ahead: open the to-do' },
      limits: { item: 'Purple-gold gourd', hint: 'How much the gourd still holds' },
      changes: { item: 'Alms bowl', hint: 'Gather the changes and commit' },
      mode: { item: 'Golden crow and jade rabbit', hint: 'The court works day and night' },
    },
  },
  font: "Silkscreen, ui-monospace, Menlo, monospace",
}
