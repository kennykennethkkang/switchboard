/**
 * Strips invisible "watermark" characters from text Kenneth commits. Idea from guillaumemeyer/watermarks-remover (MIT).
 * Keeps what real text needs: ZWJ/ZWNJ, LRM/RLM, emoji variation selectors, subdivision flag tags, a file's leading BOM.
 * Escapes only: a literal invisible char here would be stripped by the cleaner itself on commit.
 */

// A whole subdivision flag, then an emoji with its selector (both kept), then the strip set.
const RE = /\u{1F3F4}[\u{E0020}-\u{E007E}]+\u{E007F}|\p{Emoji}[\uFE00-\uFE0F]|[\u200B\u2060-\u2064\u00AD\u202A-\u202E\u2066-\u2069\u180E\uFE00-\uFE0F\uFEFF\u{E0001}-\u{E007F}]/gu

/** keepBom: a BOM at offset 0 stays (file starts); off for commit messages and mid-file lines. */
export function cleanInvisible(text: string, keepBom = true): { text: string; count: number } {
  let count = 0
  const out = text.replace(RE, (m: string, at: number) => {
    if ([...m].length > 1 || (keepBom && m === '\uFEFF' && at === 0)) return m
    count++
    return ''
  })
  return { text: out, count }
}
