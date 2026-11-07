/**
 * What Kenneth sees when a chat finishes or asks something: a VS Code notification,
 * a macOS one with a sound (a toast on Windows), and on Done the commit message in Source Control. Best effort:
 * a failure here never touches the chat. The phone push comes from the chat itself (rules.md).
 */
import * as vscode from 'vscode'
import { execFile } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { hub } from './hub-service'
import { focusChat } from './actions'
import { desktopNotice, doneText, fillRepos, notifyStep, todayText, type Box } from './progress'
import type { ChatProgress, ChatState, StuckItem } from './types'

const titleOf = (p: ChatProgress) => hub.get().chats.find(c => c.sessionId === p.sessionId)?.name ?? p.cwd.split(/[\\/]/).pop() ?? 'A chat'

function mac(title: string, text: string): void {
  const n = desktopNotice(title, text)
  if (n) execFile(n.cmd, n.args, { env: { ...process.env, ...n.env }, windowsHide: true, timeout: 15_000 }, () => {})
}

// Repo root to what Switchboard last put in its box and which chat wrote what; anything else there is Kenneth's.
const boxes = new Map<string, Box>()
// Session, repo and message this window already filled, so a repeat hook on a Done chat fills nothing twice.
const filled = new Set<string>()
// Session to what it was last notified about, so a repeat Done or question shows once.
const notified = new Map<string, string>()

/** A Done chat's commit messages into the Source Control boxes of this window's open repos: the plain one to the repo holding
 * its folder, each "Commit message (<folder>)" one to that repo. Every window runs it for every chat, mirrored ones too,
 * so a repo open in another window still gets its message. Merged into Switchboard's uncommitted text, never over Kenneth's. */
export function fillBoxes(p: ChatProgress | undefined): void {
  if (p?.state !== 'done') return
  try {
    const repos = vscode.extensions.getExtension<{ getAPI(v: 1): { repositories: { rootUri: vscode.Uri; inputBox: { value: string } }[] } }>('vscode.git')?.exports?.getAPI(1)?.repositories ?? []
    fillRepos(repos, p, boxes, filled)
  } catch { /* no git extension: Copy on the card still works */ }
}

export function notify(change: { from?: ChatState; to: ChatProgress }): void {
  const p = change.to
  const n = notifyStep(notified.get(p.sessionId), p)
  if (n.key === undefined) notified.delete(p.sessionId)
  else notified.set(p.sessionId, n.key)
  if (!n.show) return
  const title = titleOf(p)
  if (p.state === 'done') {
    fillBoxes(p)
    const what = doneText(p)
    mac(title, what)
    void vscode.window.showInformationMessage(`Switchboard: ${title}: ${what.replace(/[.!?]$/, '')}.`, 'Show').then(c => c && focusChat(p.sessionId))
  } else if (p.state === 'needs-you') {
    mac(title, p.question ?? 'Needs you')
    void vscode.window.showWarningMessage(`Switchboard: ${title}${p.limited ? ':' : ' asks:'} ${p.question ?? 'needs you'}`, p.limited ? 'Show' : 'Answer').then(c => c && focusChat(p.sessionId))
  }
}

/** One notice per stuck item; the hub hands each over once (unseenStuck). */
export function notifyStuck(i: StuckItem, now = Date.now()): void {
  const title = hub.get().chats.find(c => c.sessionId === i.sessionId)?.name ?? 'A chat'
  const min = Math.max(1, Math.round((now - i.since) / 60_000))
  const use = [i.cpu !== undefined && `CPU ${Math.round(i.cpu)}%`, i.rss !== undefined && `${(i.rss / 1024 ** 3).toFixed(1)} GB`].filter(Boolean).join(', ')
  const text = `Stuck: ${i.what} for ${min} min${use ? ` (${use})` : ''}`
  mac(title, text)
  void vscode.window.showWarningMessage(`Switchboard: ${title}: ${text}.`, 'Show').then(c => c && focusChat(i.sessionId))
}

/** An AWS session about to end, with one tap to sign in again in its Chrome profile. */
export function notifyAwsExpiry(profile: string, leftMs: number, signIn: () => void): void {
  const label = hub.get().aws.find(a => a.name === profile)?.label
  const text = `AWS sign-in for ${label ? `${label} (${profile})` : profile} ends in about ${Math.max(1, Math.round(leftMs / 60_000))} min`
  mac('AWS', text)
  void vscode.window.showWarningMessage(`Switchboard: ${text}.`, 'Sign in again').then(c => c && signIn())
}

// Fixed at 6 pm. One file stamps the day, so only the first window to look sends it.
const SUMMARY_HOUR = 18
const SENT = path.join(os.homedir(), '.claude', 'switchboard', 'today-sent')
/** Once a day after SUMMARY_HOUR: one notification for every chat that finished, is almost done, or needs Kenneth. */
export function dailySummary(now = Date.now()): void {
  const d = new Date(now)
  if (d.getHours() < SUMMARY_HOUR) return
  const day = d.toDateString()
  try { if (fs.readFileSync(SENT, 'utf8') === day) return } catch { /* never sent */ }
  try { fs.writeFileSync(SENT, day) } catch { return }
  const text = todayText(hub.get().progress, titleOf, now)
  if (!text) return
  mac('Switchboard today', text)
  void vscode.window.showInformationMessage(`Switchboard today: ${text}.`)
}
