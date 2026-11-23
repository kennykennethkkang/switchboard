# Board skins

A skin is colors and copy. Its `art` names a kit in `web/components/switchboard/art/` that draws the board's pieces: backdrop, bridges, islands, halls, the council mast, sprites and ambient art.

1. Copy `journey-west.ts` to `<id>.ts`: palette, court colors, sky bands, copy, font, belt and `art`.
2. Optional: a `night` look (palette and court) turns on the sun and moon toggle on the tool belt.
3. Add it to `SKINS` in `index.ts`. The belt's theme item cycles that list, and `?skin=<id>` opens one for a review link. Skins that share one story and cast (`family`: Journey West and Dragon Palace) sit in one group in the theme menu; a skin with its own world leaves `family` out.
4. Its look, if it needs one: copy `art/court.ts` to `art/<kit>.ts`, keep the hooks you change (`Partial<ArtKit>`), and add it to `KITS` in `art/index.ts`. A hook left out falls back to court. A hook draws a whole piece, so a kit can redraw an island, bridge or hall, not only decorate it. `art/types.ts` lists every hook with its arguments. For smooth, high-res art, set `smooth: true` and a `res` (art px per world unit, default 2) on the kit: the art layer is smoothed and zoom is continuous. Its `figure`, `badge`, `bubble`, `zzz` and `sparkle` hooks are optional; court leaves them out.
5. Its own characters, if the theme is its own world: give the kit a `cast` (role to character, like `SEA` in `web/lib/court-cast.ts` for the Dragon Palace). A role left out keeps its Journey West character. Belt icons go in the skin's `belt.sprites`.
6. Check: `node --import tsx --test web/lib/skins/*.test.ts` from the repo root. Every skin's `art` must be a key of `KITS`.
