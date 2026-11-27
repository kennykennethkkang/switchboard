'use client'

/**
 * The Hub's state from the extension, and the way back to it.
 * Outside VS Code it polls the standalone app's /hub proxy (lib/hub-remote.ts);
 * with no window behind that either, the dev build answers sample data; the phone app never does,
 * it keeps the last real state and says why it is not live.
 */
import { useFlash } from './use-flash'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { commandWait, vscodeBridge, type HubCommand } from '@/lib/vscode-bridge'
import type { HubState } from '@/lib/hub-types'
import { demoApply, demoHub, demoTick, demoUpload, emptyHub } from '@/lib/hub-demo'
import { fetchHub, fetchHubWhy, postCommand, uploadFile } from '@/lib/hub-remote'
import { keepSame } from '@/lib/hub-share'
import { UPLOAD_MAX, fmtSize, type Upload } from '@/lib/attach'
import { pending } from './in-flight'

const POLL_MS = 2000
const IDLE_POLL_MS = 15000
// The button a click just pressed, for send to mark while its command is out. Only the click's own tick.
let pressed: HTMLElement | undefined

// The app build sets NEXT_PUBLIC_DEMO to "0": a phone must never mistake sample chats for its own.
const DEMO_OK = process.env.NEXT_PUBLIC_DEMO !== '0'

/** down: why the standalone app is not live right now, while it shows the last state it had (or nothing). */
const LOAD_FETCH = new Set(['hub-trend', 'hub-changes', 'hub-pipelines'])

// Shell parts mounted without hub props (the nav's account menu) read the one live hub here.
let shared: { hub: HubState; send: (c: HubCommand) => void } | null = null
const sharedSubs = new Set<() => void>()
export const useHubShared = () => useSyncExternalStore(fn => { sharedSubs.add(fn); return () => { sharedSubs.delete(fn) } }, () => shared, () => null)

export function useHub(): { hub: HubState; isLive: boolean; isDemo: boolean; isVSCode: boolean; send: (c: HubCommand) => void; upload: Upload; problem: { text: string; at: number; for?: HubCommand } | null; down?: string; /** The demo took a click that changes nothing here; set for a few seconds. */ inert: boolean } {
  const [hub, setHub] = useState<HubState | null>(null)
  const [isVSCode, setIsVSCode] = useState(false)
  const [remote, setRemote] = useState<HubState | null>(null)
  // send reads it here, so it stays one function across polls.
  const remoteRef = useRef(remote)
  remoteRef.current = remote
  const [tried, setTried] = useState(false)
  const [demo, setDemo] = useState<HubState>(() => demoHub())
  const demoRef = useRef(demo)
  demoRef.current = demo
  const [inert, setInert] = useFlash(0, 4000)
  const [problem, setProblem] = useState<{ text: string; at: number; for?: HubCommand } | null>(null)
  const [down, setDown] = useState<string>()

  useEffect(() => {
    if (!vscodeBridge) return
    const offInit = vscodeBridge.onInit(() => setIsVSCode(true))
    const offHub = vscodeBridge.onHub(s => { pending.endAll(); setHub(h => keepSame(h, s)) })
    return () => { offInit(); offHub() }
  }, [])

  useEffect(() => {
    const press = (e: MouseEvent) => {
      pressed = (e.target as Element | null)?.closest?.<HTMLElement>('button, [role="button"]') ?? undefined
      setTimeout(() => { pressed = undefined }, 0)
    }
    document.addEventListener('click', press, true)
    return () => document.removeEventListener('click', press, true)
  }, [])

  // Outside VS Code: the standalone app's proxy to a window's hub, every 2 s.
  // With no hub (the demo) it retries every 15 s, so a window that opens later still connects
  // and the console gets one failed fetch per retry instead of one every 2 s.
  useEffect(() => {
    if (isVSCode) return
    let stop = false, t: ReturnType<typeof setTimeout> | undefined, raw: HubState | null = null
    const tick = async () => {
      if (vscodeBridge?.isVSCode) return
      // A hidden tab asks nothing; it looks again within 2 s of being shown.
      if (document.hidden) { t = setTimeout(tick, POLL_MS); return }
      const { hub: got, why, noHub } = await fetchHubWhy()
      if (stop) return
      // A failed poll keeps the last real state on screen; only the dev build falls back to the demo.
      // A 304 hands back the same object as last time: nothing to compare.
      if (got) { if (got !== raw) setRemote(r => keepSame(r, got)) }
      else if (DEMO_OK) setRemote(null)
      raw = got
      setDown(got ? undefined : why)
      setTried(true)
      // Nothing serves /hub (plain demo): stop asking. A real app's proxy answers 502, not 404, when no window is open.
      if (noHub && DEMO_OK) return
      t = setTimeout(tick, got ? POLL_MS : DEMO_OK ? IDLE_POLL_MS : POLL_MS)
    }
    void tick()
    return () => { stop = true; clearTimeout(t) }
  }, [isVSCode])

  const isDemo = DEMO_OK && !isVSCode && hub === null && remote === null && tried
  // The demo's working chat keeps calling tools, so the orbit has something to show.
  useEffect(() => {
    if (!isDemo) return
    const t = setInterval(() => { if (!document.hidden) setDemo(d => demoTick(d, Date.now())) }, 900)
    return () => clearInterval(t)
  }, [isDemo])
  const send = useCallback((c: HubCommand) => {
    if (isDemo) {
      // demoApply returns the same object for a command it does not act on.
      // data fetches sent on load are not clicks; only clicks get the "only in VS Code" flash
      if (!LOAD_FETCH.has(c.type) && demoApply(demoRef.current, c) === demoRef.current) setInert(Date.now())
      const end = pending.start(pressed); setDemo(d => demoApply(d, c)); end()
    }
    else if (!isVSCode && remoteRef.current) {
      const end = pending.start(pressed)
      void postCommand(c).then(why => {
        if (why) setProblem({ text: `${c.type.replace('hub-', '')} failed: ${why}`, at: Date.now(), for: c })
        return fetchHub()
      }).then(s => s && setRemote(r => keepSame(r, s))).finally(end)
    }
    else if (vscodeBridge) {
      // VS Code may not answer; commandWait releases it.
      setTimeout(pending.start(pressed, true), commandWait(c))
      vscodeBridge.sendHub(c)
    }
  }, [isDemo, isVSCode])
  const upload = useCallback<Upload>(async (file, cwd, session, onProgress, signal) => {
    if (file.size > UPLOAD_MAX) return { problem: `over the ${fmtSize(UPLOAD_MAX)} limit` }
    if (isDemo) {
      for (const f of [0.3, 0.7, 1]) { await new Promise(ok => setTimeout(ok, 250)); onProgress(f) }
      return { path: demoUpload(file.name, cwd) }
    }
    if (!isVSCode) return remoteRef.current ? uploadFile(file, cwd, session, onProgress, signal) : { problem: 'not connected to the Mac' }
    return vscodeBridge ? vscodeBridge.upload(file, cwd, session, onProgress, signal) : { problem: 'not connected to VS Code' }
  }, [isDemo, isVSCode])
  // A window still running an older Switchboard sends fewer fields; missing ones start empty.
  const got = hub ?? (isVSCode ? null : remote)
  // One object per state, so memos downstream hold between renders.
  const live = useMemo(() => got && { ...emptyHub(), ...got }, [got])
  const empty = useMemo(() => emptyHub(), [])
  // The extension's own long ops keep the busy bar up too.
  const extBusy = !!(live?.sweep?.busy || live?.jarvis?.busy || live?.repo?.busy || live?.voice === 'transcribing')
  useEffect(() => pending.setExt(extBusy), [extBusy])
  const out = live ?? (isDemo ? demo : empty)
  useEffect(() => { shared = { hub: out, send }; sharedSubs.forEach(f => f()) }, [out, send])
  return { hub: out, isLive: live !== null && !down, isDemo, isVSCode, send, upload, problem, down: isVSCode ? undefined : down, inert: !!inert }
}
