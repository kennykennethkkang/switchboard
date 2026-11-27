'use client'
import { useEffect, useRef, useState } from 'react'
import { shortcutAction, isTypingTarget } from '@/lib/shortcuts'
import type { Page } from '@/lib/route'
import { useDialog } from './use-dialog'

function ShortcutHelp({ close }: { close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useDialog(dialog, d => d.querySelector<HTMLElement>('button')?.focus())
  return <dialog ref={dialog} aria-labelledby="sb-shortcut-title" onCancel={e => { e.preventDefault(); close() }}
    onMouseDown={e => { if (e.target === e.currentTarget) close() }}
    style={{ width: 'min(460px, calc(100vw - 32px))', padding: 20, border: '1px solid var(--hub-hair)', borderRadius: 12, background: 'var(--hub-surface)', color: 'var(--hub-body)' }}>
    <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
      <h2 id="sb-shortcut-title" style={{ margin: 0, font: '600 16px/1.3 var(--hub-sans)', color: 'var(--hub-ink)' }}>Keyboard shortcuts</h2>
      <button type="button" className="hub-btn" onClick={close}>Close</button>
    </header>
    <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 16px', margin: '18px 0 0', alignItems: 'center' }}>
      {[
        ['?', 'Show this sheet'], ['n', 'New chat'], ['g then n', 'Now'], ['g then c', 'Chats'], ['g then r', 'Research'],
        ['g then w', 'Workbench'], ['g then p', 'Plan'], ['g then l', 'Live'], ['g then s', 'Ship'], ['g then m', 'Map'], ['g then u', 'Usage'],
      ].map(([key, label]) => <div key={key} style={{ display: 'contents' }}>
        <dt><kbd style={{ padding: '2px 6px', border: '1px solid var(--hub-hair)', borderRadius: 5, font: '12px var(--hub-mono)', color: 'var(--hub-ink)' }}>{key}</kbd></dt>
        <dd style={{ margin: 0 }}>{label}</dd>
      </div>)}
    </dl>
  </dialog>
}

export function useShortcuts({ go, onNew, enabled }: { go: (page: Page) => void; onNew: () => void; enabled: boolean }) {
  const [help, setHelp] = useState(false)
  const prefix = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // go and onNew change every render; refs keep the listener (and a pending g) alive across renders.
  const goRef = useRef(go), newRef = useRef(onNew)
  goRef.current = go
  newRef.current = onNew

  useEffect(() => {
    if (!enabled) return
    const down = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.altKey || e.ctrlKey || e.metaKey || e.repeat) return
      const key = e.key.toLowerCase()
      if (prefix.current) {
        clearTimeout(timer.current)
        prefix.current = false
        if (key === 'g') { prefix.current = true; timer.current = setTimeout(() => { prefix.current = false }, 900); return }
        const action = shortcutAction(`g${key}`)
        if (action) { e.preventDefault(); action.kind === 'page' && goRef.current(action.page) }
        return
      }
      if (key === 'g') {
        prefix.current = true
        timer.current = setTimeout(() => { prefix.current = false }, 900)
        return
      }
      const action = shortcutAction(e.key)
      if (!action) return
      e.preventDefault()
      if (action.kind === 'help') setHelp(true)
      if (action.kind === 'new') newRef.current()
    }
    document.addEventListener('keydown', down, true)
    return () => { document.removeEventListener('keydown', down, true); clearTimeout(timer.current); prefix.current = false }
  }, [enabled])

  return <>
    <style>{'.sb-skip-link{position:fixed;z-index:10000;top:8px;left:8px;transform:translateY(-160%);padding:8px 12px;border-radius:6px;background:var(--hub-ink);color:var(--hub-canvas);font:500 13px var(--hub-sans)}.sb-skip-link:focus{transform:translateY(0);outline:2px solid var(--hub-blue);outline-offset:2px}'}</style>
    <a className="sb-skip-link" href="#hub-main" onClick={e => { e.preventDefault(); document.getElementById('hub-main')?.focus() }}>Skip to main content</a>
    {help && <ShortcutHelp close={() => setHelp(false)} />}
  </>
}
