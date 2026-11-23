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

// Dragon Palace of the East Sea (chapter 3, where Wukong takes the staff): Ao Guang's court. A role left out keeps its CAST character, so Wukong still comes calling.
export const SEA: Record<string, Cast> = {
  // Antlers, jade dragon face, long gold whiskers, imperial gold robe, a night-shining pearl.
  lead: {
    name: 'Ao Guang', tag: 'Dragon King: antlers, whiskers, pearl',
    hat: ['.a.a..a.a.', '..agggga..'],
    body: ['..dddddd..', '..dedded..', '.yddnnddy.', 'y..yyyy..y', '..rrrrrr..', '.rrcrrcrr.', '.rrrkkrrr.', '.rcrrrrcr.', '.rrrrrrrr.', 'rrrrrrrrrr', '..ff..ff..'],
    item: ['........ww', '........wl'], itemY: 9,
    pal: { a: 'red', d: 'jade', n: 'jade_lt', y: 'gold_lt', l: 'cloud_sh' },
  },
  // Winged official's cap, old turtle face, shell round the azure robe.
  qa: {
    name: 'Turtle Chancellor', tag: 'winged cap, shell, court robe',
    hat: ['hh.hhhh.hh', '...hhhh...'],
    body: ['...tttt...', '...tete...', '...tttt...', '....tt....', '.SSrrrrSS.', 'SxSrrrrSxS', 'SSSrkkrSSS', 'SxSrrrrSxS', '.SSrrrrSS.', '..rrrrrr..', '..ff..ff..'],
    pal: { t: 'jade_lt', S: 'jade_dk', x: 'gold_dk', r: 'blue' },
  },
  // Coral hairpins, long black hair, peach robe, pearl-white ribbons.
  designer: {
    name: 'Dragon Princess', tag: 'coral pins, ribbons',
    hat: ['..o.hh.o..', '..hhhhhh..'],
    body: ['.hhhhhhhh.', '.hsessesh.', '.hssssssh.', '.h.ssss.h.', '..rrrrrr..', '.wrrrrrrw.', 'w.rrkkrr.w', 'w.rcrrcr.w', '.wrrrrrrw.', '.rrrrrrrr.', '..ff..ff..'],
    pal: { o: 'red' },
  },
  // Blue face, red wild hair, fangs, patrol fork.
  researcher: {
    name: 'Patrol Yaksha', tag: 'blue face, fangs, patrol fork',
    hat: ['o.o.o.o.o.', 'oooooooo..'],
    body: ['.uuuuuuu..', '.ueuuueu..', '.uwuuuwu..', '..uuuuu...', '.rrrrrrr..', 'urrcrrcru.', '.rrrkkrr..', '.rrrrrrr..', '.ccrrrcc..', '..uu.uu...', '..ff..ff..'],
    item: ['.......y.y', '.......yyy', '........g.', '........g.', '........g.', '........g.', '........g.', '........g.', '........g.', '........g.', '........g.', '........g.', '........g.'],
    itemY: 1, pal: { o: 'red', u: 'blue', y: 'stone', g: 'wood_lt' },
  },
  // Eyes on stalks, red shell, both claws up.
  ops: {
    name: 'Crab General', tag: 'eye stalks, shell, raised claws',
    hat: ['.e......e.', '..r....r..'],
    body: ['..rrrrrr..', '.rrrrrrrr.', '.rrmrrmrr.', 'x.x.rr.x.x', 'xxxccccxxx', '.x.cccc.x.', '...ckkc...', '...cccc...', '..cccccc..', '.c.c..c.c.', '..ff..ff..'],
    pal: { r: 'red', c: 'red_dk', x: 'peach', m: 'gold_lt' },
  },
  // The carp that leaps the Dragon Gate: dorsal fin, gold scales, fins at the hem.
  growth: {
    name: 'Carp Spirit', tag: 'fin crest, scales, leaps the Dragon Gate',
    hat: ['....oo....', '...oooo...'],
    body: ['..yyyyyy..', '.yeyyyyey.', '.yyymmyyy.', 'o.yyyyyy.o', 'oorrrrrroo', '..rxrxrr..', '..rrkkrr..', '..rxrrxr..', '..rrrrrr..', '.oorrrroo.', '..ff..ff..'],
    pal: { y: 'gold', r: 'red', x: 'gold_lt', o: 'peach', m: 'red_dk' },
  },
  // Anyone else: a shrimp soldier with curled feelers and a spear.
  pilgrim: {
    name: 'Shrimp Soldier', tag: 'feelers, shell, spear',
    hat: ['a......a..', '.a....a...'],
    body: ['..aaaaaa..', '..aeaaea..', '..aaaaaa..', '...aaaa...', '..rrrrrr..', '.arrrrrra.', '..rrkkrr.t', '..rcrrcr.t', '..rrrrrr.t', '.aaaaaaa.t', '..ff..ff.t'],
    item: ['.........y', '........yy', '.........t'], itemY: 1,
    pal: { a: 'peach', r: 'red', c: 'red_dk', t: 'wood_lt', y: 'stone' },
  },
}

// Neon Harbor night market: a fixer, a netrunner, a bug hunter with a drone, a tagger, a broker, a dock mech, a hawker, a courier.
export const NEON: Record<string, Cast> = {
  lead: {
    name: 'Harbor Boss', tag: 'wide hat, long coat, cigar',
    hat: ['..bnnnnb..', '.bbbbbbbb.'],
    body: ['..ssssss..', '..sesses..', '...ssss...', '.rcwwwcr..', 'rrcwkwcrr.', 'rrrrrrrrr.', 'srrrrrrrrs', '.rrrrrrrr.', '.rrrrrrrr.', '.rrr..rrr.', '..ff..ff..'],
    item: ['........oo'], itemY: 9,
    pal: { b: 'brown_dk', n: 'red_lt', o: 'rail' },
  },
  engineer: {
    name: 'Netrunner', tag: 'spiked hair, visor, jack cable',
    hat: ['.n.n..n.n.', '.hhhhhhhh.'],
    body: ['..hhhhhh..', '.hvvvvvvh.', '..hssssh..', '..rrrrrr..', '.rrcrrcrr.', '.rrrkkrrr.', '.srrrrrrs.', '..rrrrrr..', '..rcrrcr..', '..rrrrrr..', '..ff..ff..'],
    item: ['........v.', '........v.', '........v.'], itemY: 9,
    pal: { n: 'red_lt', v: 'blue_lt' },
  },
  qa: {
    name: 'Bug Hunter', tag: 'drone hovering overhead, magnifier',
    hat: ['.wwwwwwww.', '....dd....'],
    body: ['..hhhhhh..', '..hsesesh.', '...ssss...', '..rrrrrr..', '.rrcrrcrr.', '.rrrkkrrr.', '.srrrrrrs.', '..rrrrrr..', '.rrrrrrrr.', '..rrrrrr..', '..ff..ff..'],
    item: ['.......gg.', '......gyyg', '......gyyg', '.......gg.', '........c.', '........c.'], itemY: 7,
    pal: { d: 'blue_lt', y: 'blue_lt' },
  },
  designer: {
    name: 'Tagger', tag: 'knit cap, hoodie, spray can',
    hat: ['..pppppp..', '.pppppppp.'],
    body: ['..ssssss..', '..sesses..', '...ssss...', '.rrrrrrr..', '.rcrrrcr..', '.srrkkrrs.', '.srrrrrrs.', '..rrrrrr..', '..rrrrrr..', '..rr..rr..', '..ff..ff..'],
    item: ['........g.', '.......gg.', '........w.', '........w.', '........w.'], itemY: 7,
  },
  researcher: {
    name: 'Info Broker', tag: 'hair bun, shades, data slate',
    hat: ['....hh....', '.hhhhhhhh.'],
    body: ['..ssssss..', '..eeeeee..', '...ssss...', '.rrrrrrr..', '.rrwrrwr..', '.rrrkkrrr.', 'srrrrrrrs.', '.rrrrrrr..', '.rrrrrrr..', '..rrrrrr..', '..ff..ff..'],
    item: ['......cccc', '......cyyc', '......cyyc', '......cccc'], itemY: 7,
    pal: { y: 'beam' },
  },
  ops: {
    name: 'Dock Mech', tag: 'hard hat, belt, wrench',
    hat: ['..gggggg..', '.gggggggg.'],
    body: ['..ssssss..', '..sesses..', '..ssssss..', '.rrrrrrr..', '.rrcrrcrr.', '.rrrkkrrr.', 'srrrrrrrrs', '.cccccccc.', '.rrrrrrrr.', '..rr..rr..', '..ff..ff..'],
    item: ['........yy', '........y.', '........y.', '........yy'], itemY: 8,
    pal: { y: 'sky' },
  },
  growth: {
    name: 'Hawker', tag: 'straw hat, apron, paper lantern',
    hat: ['...yyyy...', '.yyyyyyyy.'],
    body: ['..ssssss..', '..sesses..', '...ssss...', '.rrrrrrr..', '.rrgrrgrr.', '.rrrkkrrr.', '.rwwwwwwr.', '.rwwwwwwr.', '..rrrrrr..', '..rr..rr..', '..ff..ff..'],
    item: ['........g.', '........g.', '.......yyy', '.......yyy', '........g.'], itemY: 3,
    pal: { y: 'gold_lt' },
  },
  pilgrim: {
    name: 'Courier', tag: 'crash helmet, scarf, parcel',
    hat: ['..jjjjjj..', '.jjjjjjjj.'],
    body: ['..ssssss..', '..sesses..', '..kkkkkk..', '.rrrrrrr..', '.rrcrrcrr.', '.rrrrrrr..', 'srrrrrrrs.', '.rrrrrrr..', '..rrrrrr..', '..rr..rr..', '..ff..ff..'],
    item: ['........bb', '........bb', '........bb'], itemY: 8,
    pal: { j: 'jade', b: 'sky' },
  },
}

// Orbital Fleet crew, faces under a glass helmet: hats and item rows sit below or inside the helmet line.
export const ORBIT: Record<string, Cast> = {
  lead: {
    name: 'Captain', tag: 'peaked cap, gold braid, sabre',
    hat: ['..bbbbbb..', '.gggggggg.'],
    body: ['..ssssss..', '..sesses..', '...ssss...', '.wwrrrrww.', '.rrgrrgrr.', '.rrrkkrrr.', 'srrrrrrrrs', '.rrrrrrrr.', '.rrrrrrrr.', '..rrrrrr..', '..ff..ff..'],
    item: ['g.........', 'y.........', 'y.........', 'y.........', 'y.........'], itemY: 6,
    pal: { b: 'blue', y: 'sky' },
  },
  engineer: {
    name: 'Flight Engineer', tag: 'tool belt, welding torch',
    hat: [],
    body: ['..ssssss..', '..sesses..', '...ssss...', '..rrrrrr..', '.rrgrrgrr.', '.rrrkkrrr.', 'srrrrrrrrs', '.cccccccc.', '.rrrrrrrr.', '..rr..rr..', '..ff..ff..'],
    item: ['........y.', '.......yy.', '........h.', '........h.', '........h.'], itemY: 7,
    pal: { y: 'gold_lt' },
  },
  qa: {
    name: 'Safety Officer', tag: 'jade cap, vest, extinguisher',
    hat: ['..jjjjjj..', '.jjjjjjjj.'],
    body: ['..ssssss..', '..sesses..', '...ssss...', '..rrrrrr..', '.rwwwwwwr.', '.rrrkkrrr.', 'srrrrrrrrs', '.rrrrrrrr.', '.rrrrrrrr.', '..rrrrrr..', '..ff..ff..'],
    item: ['gg........', 'xx........', 'xx........', 'xx........', 'xx........'], itemY: 6,
    pal: { j: 'jade', x: 'red' },
  },
  designer: {
    name: 'Holo Designer', tag: 'hair bun, holo cube',
    hat: ['....pp....', '..pppppp..'],
    body: ['..ssssss..', '..sesses..', '...ssss...', '..rrrrrr..', '.rrcrrcr..', '.rrrkkrrr.', 'srrrrrrrrs', '.rrrrrrrr.', '.rrrrrrrr.', '.rrrrrrrr.', '..ff..ff..'],
    item: ['.......bbb', '.......b.b', '.......bbb'], itemY: 9,
    pal: { b: 'blue_lt' },
  },
  researcher: {
    name: 'Science Officer', tag: 'hair band, tricorder',
    hat: ['..hhhhhh..'],
    body: ['..ssssss..', '..sesses..', '...ssss...', '..rrrrrr..', '.rrwrrwrr.', '.rrrkkrrr.', 'srrrrrrrrs', '.rrrrrrrr.', '.rrrrrrrr.', '..rrrrrr..', '..ff..ff..'],
    item: ['......cccc', '......cyyc', '......cccc'], itemY: 8,
    pal: { y: 'beam' },
  },
  ops: {
    name: 'Deck Chief', tag: 'shoulder pads, signal wand',
    hat: ['..cccccc..'],
    body: ['..ssssss..', '..sesses..', '...ssss...', '.gggggggg.', '.rrrrrrrr.', '.rrrkkrrr.', 'srrrrrrrrs', '.rrrrrrrr.', '.rrrrrrrr.', '..rrrrrr..', '..ff..ff..'],
    item: ['........yy', '.........y', '.........y', '.........y', '.........y'], itemY: 7,
    pal: { y: 'gold_lt' },
  },
  growth: {
    name: 'Comms Officer', tag: 'headset, pink hair band, dish',
    hat: ['..pppppp..'],
    body: ['..ssssss..', '.gsesesg..', '...ssss...', '..rrrrrr..', '.rrcrrcrr.', '.rrrkkrrr.', 'srrrrrrrrs', '.rrrrrrrr.', '.rrrrrrrr.', '..rrrrrr..', '..ff..ff..'],
    item: ['.......bb.', '......bwwb', '.......bb.', '........g.', '........g.'], itemY: 7,
    pal: { b: 'blue_lt' },
  },
  pilgrim: {
    name: 'Cadet', tag: 'cap, flag on a pole',
    hat: ['..bbbbbb..', '.bbbbbbbb.'],
    body: ['..ssssss..', '..sesses..', '...ssss...', '..rrrrrr..', '.rrwrrwr..', '.rrrkkrr..', '.srrrrrrs.', '..rrrrrr..', '..rrrrrr..', '..rr..rr..', '..ff..ff..'],
    item: ['........yy', '........yw', '........y.', '........y.', '........y.'], itemY: 6,
    pal: { b: 'sky', y: 'gold_lt' },
  },
}

export const cast = (role = 'lead') => CAST[role] ? role : CAST[role.split(':').pop()!] ? role.split(':').pop()! : 'pilgrim'
/** Character for a role; unknown roles become the pilgrim. Accepts plugin-scoped names like `kit:qa`. set: a theme's own cast, falling back to CAST per role. */
export const castOf = (role?: string, set?: Record<string, Cast>): Cast => set?.[cast(role)] ?? CAST[cast(role)]

/** Looks for board.tsx sprite(), same keys as CAST. */
export const LOOKS: Record<string, Look> = Object.fromEntries(Object.entries(CAST).map(([k, { name, tag, ...look }]) => [k, look]))

// State badges, 5x5, drawn beside a sprite.
export const OVERLAYS: Record<'needs' | 'retry' | 'stuck' | 'idle' | 'done' | 'working', Icon> = {
  needs: { name: "Red Boy's flame", rows: ['..o..', '.oo..', '.oyo.', 'oyyyo', '.ooo.'], pal: { o: 'red_lt', y: 'gold_lt' } },
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
  st === 'needs' || st === 'stuck' || st === 'idle' || st === 'done' || st === 'working' ? OVERLAYS[st] : undefined

