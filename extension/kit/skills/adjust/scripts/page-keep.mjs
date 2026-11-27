#!/usr/bin/env node
// Keep list for admin page reads: prints only the exact labels asked for, each with its value from
// the same line (Label: value, Label<tab>value) or the next one. Page text comes on stdin, plain or
// as the JSON string or array agent-browser eval prints.
// <page text> | node page-keep.mjs RSRP SINR 'Software Version'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

// What leaked from the gateway pages and other names for it: never asked for as a label, never printed as a value.
const SECRET = /password|passphrase|key|psk|\bpin\b|puk|token|secret|serial|\bs\/?n\b|imei|imsi|iccid|eid|ssid|network name|wi-?fi name|(device|hardware) id|access code|phone|mobile number|msisdn|\bdefault\s*:|^default$/i
// A next line that is a row of its own (Label: value, Label:value, Label<tab>value), so this label's value is empty.
// A word with a non-hex letter before a colon is a label; times, MACs and IPv6 stay values.
const ROW = /^[^:\t]+?\s*(:\s|:$|\t)|[g-z][a-z]*:/i
// ICCID, EID, IMEI, also spaced; phone numbers with a leading +.
const LONG = /\+\d(?:[ -]?\d){7,}|\d(?:[ -]?\d){13,}/g

export const keep = (text, labels) => {
  try {
    const v = JSON.parse(text)
    text = Array.isArray(v) ? v.join('\n') : typeof v === 'string' ? v : text
  } catch {}
  const want = new Set(labels.map(s => s.trim()).filter(Boolean))
  const rows = text.split(/\r?\n/).map(s => s.trim())
  return rows.flatMap((row, i) => {
    if (!row) return []
    const [, head = row, rest = ''] = row.match(/^([^:\t]+?)\s*[:\t]\s*(.*)$/) ?? []
    if (!want.has(head)) return []
    const next = rows[i + 1] ?? ''
    const value = rest || (ROW.test(next) ? '' : next)
    return [`${head}: ${SECRET.test(value) ? '<withheld>' : value.replace(LONG, '<long number>')}`]
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const labels = process.argv.slice(2)
  const bad = labels.filter(s => SECRET.test(s.trim()))
  if (!labels.length || labels.some(s => !s.trim()) || bad.length) {
    console.error(bad.length ? `refused, these name a secret: ${bad.join(', ')}. Ask the user instead of reading it.` : "usage: <page text> | node page-keep.mjs 'Label' ['Label' ...], no empty labels")
    process.exit(2)
  }
  const out = keep(fs.readFileSync(0, 'utf8'), labels)
  if (!out.length) {
    console.error('none of these labels found. Check the exact label text; never print the page to find it.')
    process.exit(1)
  }
  const missing = labels.filter(l => !out.some(s => s.startsWith(l.trim() + ': ')))
  if (missing.length) console.error(`not found: ${missing.join(', ')}`)
  console.log(out.join('\n'))
}
