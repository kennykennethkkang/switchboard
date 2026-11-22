// Seeds ~/.claude/switchboard/smart-picks.jsonl from picks.jsonl and from past transcripts' AskUserQuestion
// pick and answer pairs. Run once on an empty ledger: npx tsx scripts/smart-backfill.ts [--force] [--dry]
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as readline from 'readline'
import { PICKS_FILE } from '../src/hub/picks'
import { SMART_PICKS, logSmart, pickRow, questionBucket, taskLabel, type SmartRow } from '../src/hub/smart-select'

const SKIP_BYTES = 300 << 20
const dry = process.argv.includes('--dry')
if (!process.argv.includes('--force') && fs.existsSync(SMART_PICKS) && fs.statSync(SMART_PICKS).size > 0) { console.log('ledger not empty, pass --force to add anyway'); process.exit(0) }

const rows: SmartRow[] = []
const bare = (s: string) => s.replace(/\s*\(Recommended\)\s*$/i, '').trim()
const cwdOf = new Map<string, string>()
try { for (const r of JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'switchboard', 'archive.json'), 'utf8'))) if (r.sessionId && r.cwd) cwdOf.set(r.sessionId, r.cwd) } catch { /* no archive */ }

// picks.jsonl: one model and one effort pick per auto row; a value Kenneth set himself is the final.
let nPicks = 0
try {
  for (const l of fs.readFileSync(PICKS_FILE, 'utf8').split('\n')) {
    let r: any; try { r = JSON.parse(l) } catch { continue }
    if (!r?.session || r.kept || r.ai !== 'claude' || !r.auto) continue
    for (const kind of ['model', 'effort'] as const) {
      if (!r[kind]) continue
      const own: string | undefined = r.explicit?.[kind]
      const row = pickRow(kind, r.session, cwdOf.get(r.session) ?? r.project ?? '', taskLabel(r.reason ?? ''), r[kind], r.reason ?? '', [], r.at)
      rows.push(row); nPicks++
      if (own && row.t === 'pick') rows.push({ t: 'final', at: r.at, session: r.session, kind, key: row.key, final: own })
    }
  }
} catch { /* no picks log */ }

void (async () => {
// Transcripts: a question with a (Recommended) option, and the answer in tool_result.
const root = path.join(os.homedir(), '.claude', 'projects')
const seen: Record<string, string> = {}
let files = 0, skipped = 0, nQ = 0
for (const dir of fs.readdirSync(root)) {
  let names: string[]; try { names = fs.readdirSync(path.join(root, dir)).filter(n => n.endsWith('.jsonl')) } catch { continue }
  for (const n of names) {
    const f = path.join(root, dir, n)
    if (fs.statSync(f).size > SKIP_BYTES) { skipped++; continue }
    files++
    const uses = new Map<string, { questions: any[]; at: number; cwd?: string }>()
    const rl = readline.createInterface({ input: fs.createReadStream(f), crlfDelay: Infinity })
    for await (const l of rl) {
      if (!l.includes('AskUserQuestion') && !l.includes('"answers"')) continue
      let j: any; try { j = JSON.parse(l) } catch { continue }
      const c = j.message?.content
      if (!Array.isArray(c)) continue
      for (const b of c) {
        if (b.type === 'tool_use' && b.name === 'AskUserQuestion' && Array.isArray(b.input?.questions)) uses.set(b.id, { questions: b.input.questions, at: Date.parse(j.timestamp) || 0, cwd: j.cwd })
        if (b.type !== 'tool_result' || !uses.has(b.tool_use_id)) continue
        const u = uses.get(b.tool_use_id)!, answers = j.toolUseResult?.answers
        if (!answers || typeof answers !== 'object') continue
        const session = n.replace(/\.jsonl$/, '')
        u.questions.forEach((q, i) => {
          const labels: string[] = (q.options ?? []).map((o: any) => String(o?.label ?? ''))
          const rec = labels.findIndex(x => /\(Recommended\)\s*$/i.test(x))
          const header = String(q.header ?? '').toLowerCase(), bucket = questionBucket(header, String(q.question ?? ''))
          const answer = answers[q.question]
          if (rec < 0 || !header || header === 'finish' || typeof answer !== 'string') return
          seen[header] = bucket
          const row = pickRow('question', session, u.cwd ?? cwdOf.get(session) ?? '', bucket, bare(labels[rec]), 'marked Recommended', labels.map(bare), u.at + i)
          rows.push(row, { t: 'final', at: u.at + i, session, kind: 'question', key: row.key, final: bare(answer) }); nQ++
        })
      }
    }
  }
}
rows.sort((a, b) => a.at - b.at)
console.log(`picks.jsonl rows: ${nPicks} (model+effort), question pairs: ${nQ}, transcripts read: ${files}, skipped over 300 MB: ${skipped}, ledger rows: ${rows.length}`)
const per: Record<string, number> = {}
for (const r of rows) if (r.t === 'pick' && r.kind === 'question') per[r.task] = (per[r.task] ?? 0) + 1
console.log('question rows per bucket', JSON.stringify(per))
if (process.argv.includes('--other')) console.log(Object.entries(seen).filter(([, b]) => b === 'other').map(([h]) => h).join(' | '))
if (!dry) for (const r of rows) logSmart(r)
})()
