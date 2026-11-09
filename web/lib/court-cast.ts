// Celestial Court cast: Journey to the West (Wu Cheng'en), original pixel art from the novel's descriptions.
// Grids are 10 wide; sprite() pads a 1px ink outline to 12x16. body sits at y 3 (row 10 is the feet the walk swaps),
// hat at y 1, item at itemY. pal maps a grid letter to a skin color; defaults live in board.tsx sprite().
import type { CourtColors as C } from './skins'

export type Look = { body?: string[]; hat?: string[]; item?: string[]; itemY?: number; pal?: Partial<Record<string, keyof C>> }
export type Cast = Look & { name: string; tag: string }
/** Small badge beside a sprite or in a plate. */
export type Icon = { name: string; rows: string[]; pal: Partial<Record<string, keyof C>> }

export const CAST: Record<string, Cast> = {
  // Kasaya over a white under-robe, five-leaf crown, nine-ringed staff.
  lead: {
    name: 'Tang Sanzang', tag: 'kasaya, crown, ringed staff',
    hat: ['..g.g.g...', '..ggggg...'],
    body: ['..sssss...', '..seses...', '..sssss...', '.rrgrcc...', 'srgrrcccs.', '.rrrgccc..', '.rgrrkcc..', '.rrrgrcc..', '.rrgrrrc..', '.rrrrrrr..', '..ff..ff..'],
    item: ['.......yy.', '......y..y', '.......yy.', '........g.', '........g.', '........g.', '........g.', '........g.', '........g.', '........g.', '........g.', '........g.', '........g.'],
    itemY: 1, pal: { r: 'red', c: 'cloud', g: 'gold', y: 'gold_lt' },
  },
  // Golden fillet, phoenix-feather cap, chain mail, tiger-skin kilt, banded staff on the shoulders.
  engineer: {
    name: 'Sun Wukong', tag: 'fillet, feather cap, Ruyi Jingu Bang',
    hat: ['.v......v.', '..vgggv...'],
    body: ['..yyyyyy..', '..besseb..', '..bsppsb..', '...bbbb...', '..rrrrrr..', '..rcrrcr..', '..rrkkrr..', '..bybyby..', '..bybybyb.', '...b..b.b.', '..ff..ff..'],
    item: ['ydsddddsdy'], itemY: 8,
    pal: { r: 'gold', c: 'gold_dk', y: 'gold_lt', b: 'brown', v: 'red_lt', d: 'red_dk', p: 'peach' },
  },
  // Three-peaked cap, red third eye, jade robe, three-pointed blade; Xiaotian the hound at heel.
  qa: {
    name: 'Erlang Shen', tag: 'third eye, trident blade, Xiaotian',
    hat: ['.gg.g.g.gg', '..gggggg..'],
    body: ['...ssxss..', '...seses..', '...sssss..', '..rrrrrr..', '.srcrrcr..', '..rrrrrr..', '..rrkkrr..', '..rcrrcr..', '..rrrrrr..', '..rrrrrr..', '...ff.ff..'],
    item: ['y.y.......', 'yyy.......', '.g........', '.g........', '.g........', '.g........', '.g........', '.g........', '.g........', '.g......n.', '.g.....nen', '.g.....nnn', '.g.....n.n'],
    itemY: 1, pal: { r: 'jade', c: 'jade_dk', x: 'red', g: 'gold', y: 'cloud', n: 'cloud_sh' },
  },
  // Twin topknots, lotus robe, red armillary sash, fire-tipped spear, wind-fire wheels.
  designer: {
    name: 'Nezha', tag: 'topknots, red sash, fire spear, wheels',
    hat: ['', '..hh..hh..'],
    body: ['..hhhhhh..', '..seesse..', '..ssssss..', 'o.oooooo..', '.orrrrrro.', '..rrrrrr.o', '..cccccc..', '..cccccc..', '...c..c...', '...s..s...', '..ff..ff..'],
    item: ['.........o', '........oy', '.........g', '.........g', '.........g', '.........g', '.........g', '.........g', '.........g', '.........g', '.........g', '.........g', '.oyo.oyo.g'],
    itemY: 1, pal: { r: 'peach', c: 'jade', o: 'red', y: 'gold_lt', g: 'gold_dk' },
  },
  // White hood and robe, willow sprig in a clean vase.
  researcher: {
    name: 'Guanyin', tag: 'white robe, willow, vase',
    hat: ['...wwww...', '..wwwwww..'],
    body: ['.wwssssw..', '.wseesew..', '.wssssw...', '.wwgggww..', '.wwwwwwws.', '.wwcwwwwl.', '.wwwkkwvl.', '.wwcwwwvv.', '.wwwwcwvv.', 'wwwwwwww..', '..ff..ff..'],
    pal: { w: 'cloud', c: 'cloud_sh', g: 'jade', l: 'jade_dk', v: 'sky' },
  },
  // Dark face, red flame hair, beard, nine-skull necklace, crescent-moon spade.
  ops: {
    name: 'Sha Wujing', tag: 'dark face, skulls, crescent spade',
    hat: ['.o.o.o....', '.oooooo...'],
    body: ['.ouuuuuo..', '..ueueu...', '..uuuuu...', '..hhhhh...', '.wrwrwrw..', '.rrrrrrrs.', '.rrrkkrr..', '.rrcrrrr..', '.rrrrcrr..', '.rrrrrrr..', '..ff..ff..'],
    item: ['.......y.y', '.......yyy', '........g.', '........g.', '........g.', '........g.', '........g.', '........g.', '........g.', '........g.', '........g.', '.......ggg', '.......g.g'],
    itemY: 1, pal: { u: 'blue', o: 'red', h: 'ink2', w: 'cloud', r: 'brown', c: 'brown_dk', y: 'stone', g: 'wood_lt' },
  },
  // Pig face with flap ears and snout, black robe, round belly, nine-toothed rake.
  growth: {
    name: 'Zhu Bajie', tag: 'pig face, belly, nine-toothed rake',
    hat: ['yyyyy.....', 'y.y.y.....'],
    body: ['..pssssp..', '.ppesseppp', '..snnnns..', '..sssss...', '.rrrrrrr..', 'srrsssrrr.', 'rrrsssskr.', 'rrrssssrr.', '.rrrsssrr.', '..rrrrrr..', '..ff..ff..'],
    item: ['', '', '..g.......', '..g.......', '..g.......', '..g.......', '..g.......', '..g.......', '..g.......', '..g.......'],
    itemY: 1, pal: { p: 'peach_dk', s: 'peach', n: 'peach_dk', r: 'ink2', y: 'stone', g: 'wood' },
  },
  // Anyone else: a pilgrim in a bamboo hat with a walking stick.
  pilgrim: {
    name: 'Pilgrim', tag: 'bamboo hat, walking stick',
    hat: ['....tt....', '.tttttttt.'],
    body: ['..ssssss..', '..seesse..', '..ssssss..', '..rrrrrr..', '.srrrrrrs.', '..rrkkrr.t', '..rrrrrr.t', '..rcrrcr.t', '..rrrrrr.t', '..rrrrrr.t', '..ff..ff.t'],
    pal: { t: 'wood_lt', r: 'brown', c: 'brown_dk' },
  },
}

export const cast = (role = 'lead') => CAST[role] ? role : CAST[role.split(':').pop()!] ? role.split(':').pop()! : 'pilgrim'
/** Character for a role; unknown roles become the pilgrim. Accepts plugin-scoped names like `kit:qa`. */
export const castOf = (role?: string): Cast => CAST[cast(role)]

/** Looks for board.tsx sprite(), same keys as CAST. */
export const LOOKS: Record<string, Look> = Object.fromEntries(Object.entries(CAST).map(([k, { name, tag, ...look }]) => [k, look]))

// State badges, 5x5, drawn beside a sprite.
export const OVERLAYS: Record<'needs' | 'retry' | 'stuck' | 'idle' | 'done' | 'working', Icon> = {
  needs: { name: "Red Boy's flame", rows: ['..o..', '.oo..', '.oyo.', 'oyyyo', '.ooo.'], pal: { o: 'red', y: 'gold_lt' } },
  retry: { name: 'White Bone Demon', rows: ['.www.', 'wewew', 'wwwww', '.w.w.', '.www.'], pal: { w: 'cloud', e: 'ink' } },
  stuck: { name: 'Palm-leaf fan', rows: ['jjjjj', 'jlljj', '.jjj.', '..g..', '..g..'], pal: { j: 'jade', l: 'jade_lt', g: 'brown' } },
  idle: { name: 'Peach of immortality', rows: ['...l.', '.pll.', 'pppkp', 'ppkpp', '.ppp.'], pal: { p: 'peach', k: 'peach_dk', l: 'jade' } },
  done: { name: 'Sutra scroll', rows: ['g...g', 'gwwwg', 'gwcwg', 'gwwwg', 'g...g'], pal: { g: 'gold', w: 'cloud', c: 'cloud_sh' } },
  working: { name: 'Somersault cloud', rows: ['...y.', '.ww..', 'wwwww', 'wcwcw', '.ccc.'], pal: { w: 'cloud', c: 'cloud_sh', y: 'gold_lt' } },
}

// Pavilion and plate badges: Claude's White Dragon Horse, Codex's Laojun gourd, Kenneth's palm.
export const ICONS: Record<'claude' | 'codex' | 'kenneth', Icon> = {
  claude: { name: 'White Dragon Horse', rows: ['..wwm', '.wwwm', 'wewwm', 'ww.wm', '...wm'], pal: { w: 'cloud', e: 'ink', m: 'sky' } },
  codex: { name: 'Taishang Laojun', rows: ['..b..', '.ggg.', '..g..', '.ggg.', 'ggygg', '.ggg.'], pal: { g: 'gold_dk', y: 'gold_lt', b: 'red' } },
  kenneth: { name: "Buddha's palm", rows: ['.s.s.', 'ss.ss', 'sssss', 'ssyss', 'sssss', '.sss.'], pal: { s: 'gold', y: 'gold_lt' } },
}

/** Badge for a court state. waiting gets none: its speech bubble already shows the dots, and the cloud means work. */
export const badgeOf = (st?: string): Icon | undefined =>
  st === 'needs' || st === 'idle' || st === 'done' || st === 'working' ? OVERLAYS[st] : undefined

