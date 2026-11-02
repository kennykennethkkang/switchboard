/**
 * Files attached in Switchboard, saved for a chat to Read: uploads/<project>/<YYYY-MM-DD>/<name>,
 * one INDEX.md line per file. Both ways in use saveUpload: the panel's upload-* slices and POST /hub/upload.
 * No vscode here.
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { projectName } from './projects'

export const UPLOADS = path.join(os.homedir(), '.claude', 'switchboard', 'uploads')
export const UPLOAD_MAX = 100 * 1024 * 1024

const README = `# Switchboard uploads

Files attached in Switchboard's message box, kept so an AI chat can read them.

- Layout: <project>/<YYYY-MM-DD>/<file name>. <project> is the repo name of the chat's folder.
- Each project folder has INDEX.md: one line per upload with the time, the path relative to that folder, the size and the chat.
- A name already taken that day gets " (2)", " (3)" and so on; nothing is overwritten.
- Removing a file from a message leaves it here. Delete old folders by hand when you like.
`

export const fmtSize = (n: number) => n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`

/** The base name only, without control or reserved characters, at most 200 long with its extension kept. */
export function cleanName(name: string): string {
  let n = (name.split(/[/\\]/).pop() ?? '').replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').trim()
  if (/^\.*$/.test(n)) return 'file'
  if (n.length > 200) {
    const ext = path.extname(n).slice(0, 20)
    n = n.slice(0, 200 - ext.length) + ext
  }
  return n
}

/** "Fix login (abc12345)" for INDEX.md; a new chat has no session yet. */
export function chatLabel(chats: Array<{ sessionId: string; name?: string }>, sessionId: string | undefined): string {
  if (!sessionId) return 'new chat'
  const c = chats.find(x => x.sessionId === sessionId)
  return c?.name ? `${c.name} (${sessionId.slice(0, 8)})` : sessionId.slice(0, 8)
}

/** status: what /hub/upload answers for it. */
export class UploadRefused extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

const pad = (n: number) => String(n).padStart(2, '0')
// Chat names and session ids come from outside; one INDEX.md line each, no forged entries.
const oneLine = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\|/g, '/').trim()

export type UploadTo = { cwd: string; name: string; chat?: string; root?: string; now?: Date; max?: number }

/** Streams data to a new file and answers its absolute path. A broken stream or one over the cap leaves nothing behind. */
export async function saveUpload(o: UploadTo, data: AsyncIterable<Uint8Array> | Iterable<Uint8Array>): Promise<string> {
  const root = o.root ?? UPLOADS, now = o.now ?? new Date(), max = o.max ?? UPLOAD_MAX
  const project = cleanName(projectName(o.cwd)).replace(/^file$/, 'misc')
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const dir = path.join(root, project, day)
  // Owner-only: uploads can be screenshots of keys or private docs. mkdir's mode only covers new folders.
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 })
  for (const d of [root, path.join(root, project), dir]) await fs.promises.chmod(d, 0o700).catch(() => {})
  await fs.promises.writeFile(path.join(root, 'README.md'), README, { flag: 'wx', mode: 0o600 }).catch(() => {})
  const name = cleanName(o.name), ext = path.extname(name), stem = name.slice(0, name.length - ext.length)
  // wx: a name another upload took a moment ago is never written over.
  let file = '', fh: fs.promises.FileHandle | undefined
  for (let i = 1; !fh; i++) {
    file = path.join(dir, i === 1 ? name : `${stem} (${i})${ext}`)
    fh = await fs.promises.open(file, 'wx', 0o600).catch(err => { if ((err as NodeJS.ErrnoException).code === 'EEXIST' && i < 1000) return undefined; throw err })
  }
  let size = 0
  try {
    for await (const chunk of data) {
      size += chunk.byteLength
      if (size > max) throw new UploadRefused(`${name} is over the ${fmtSize(max)} limit for one file`, 413)
      await fh.write(chunk)
    }
    await fh.close()
  } catch (err) {
    await fh.close().catch(() => {})
    await fs.promises.rm(file, { force: true })
    throw err
  }
  const index = path.join(root, project, 'INDEX.md')
  const head = fs.existsSync(index) ? '' : `# Uploads: ${project}\n\nTime | file (relative to this folder) | size | chat\n\n`
  await fs.promises.appendFile(index, `${head}- ${day} ${pad(now.getHours())}:${pad(now.getMinutes())} | ${day}/${path.basename(file)} | ${fmtSize(size)} | ${oneLine(o.chat ?? 'new chat')}\n`, { mode: 0o600 })
  return file
}

type Slice = { bytes: Uint8Array; written: () => void }

/** The panel's upload-start / upload-chunk / upload-end: one saveUpload per id, fed slice by slice. chunk() resolves once that slice is on disk. */
export class SliceUploads {
  private open = new Map<string, { put: (x: Slice | Error | null) => void; done: Promise<string> }>()

  start(id: string, o: UploadTo): Promise<string> {
    const q: Array<Slice | Error | null> = []
    let wake = () => {}
    // An abort jumps the queue; null ends the file.
    const put = (x: Slice | Error | null) => { if (x instanceof Error) q.unshift(x); else q.push(x); wake() }
    async function* slices() {
      for (;;) {
        while (!q.length) await new Promise<void>(r => (wake = r))
        const x = q.shift()!
        if (x === null) return
        if (x instanceof Error) throw x
        yield x.bytes
        x.written()
      }
    }
    const done = saveUpload(o, slices()).finally(() => this.open.delete(id))
    this.open.set(id, { put, done })
    return done
  }

  chunk(id: string, bytes: Uint8Array): Promise<void> {
    const u = this.open.get(id)
    if (!u) return Promise.reject(new Error('no such upload'))
    return new Promise((written, fail) => {
      u.put({ bytes, written })
      u.done.then(() => fail(new Error('upload closed')), fail)
    })
  }

  end(id: string) { this.open.get(id)?.put(null) }

  /** saveUpload then removes the partial file. */
  abort(id: string) { this.open.get(id)?.put(new Error('upload cancelled')) }

  abortAll() { for (const id of [...this.open.keys()]) this.abort(id) }
}
