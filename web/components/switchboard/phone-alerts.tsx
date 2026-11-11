'use client'
import { useEffect, useState } from 'react'
import { Switch } from './gear'

const ios = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const standalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true

/** Web app only: the switch when this browser can take Web Push, an https note on plain http, the Add to Home Screen hint on an iPhone tab, else nothing. */
export function phoneAlertsShown(): 'switch' | 'hint' | 'https' | undefined {
  if (process.env.SWITCHBOARD_STANDALONE !== '1' || typeof window === 'undefined') return undefined
  // Push needs https; the tailnet may only serve http.
  if (!window.isSecureContext) return 'https'
  if ('PushManager' in window && 'serviceWorker' in navigator) return 'switch'
  return ios() && !standalone() ? 'hint' : undefined
}

export function PhoneAlerts() {
  const [on, setOn] = useState(false)
  const [note, setNote] = useState('')
  useEffect(() => {
    void navigator.serviceWorker.getRegistration('/').then(r => r?.pushManager.getSubscription()).then(s => setOn(!!s)).catch(() => {})
  }, [])

  const turnOn = async () => {
    // Asked on the tap itself: iOS refuses a permission prompt that was not.
    if (await Notification.requestPermission() !== 'granted') throw new Error('Notifications are blocked for this app')
    const reg = await navigator.serviceWorker.register('/sw.js')
    await navigator.serviceWorker.ready
    const { key } = await (await fetch('/push/key')).json() as { key: string }
    const raw = Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: raw })
    const r = await fetch('/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub) })
    if (!r.ok) throw new Error(`The Mac said ${r.status}`)
  }
  const turnOff = async () => {
    // The Mac drops it on the next send, when the push service answers 410.
    await (await (await navigator.serviceWorker.getRegistration('/'))?.pushManager.getSubscription())?.unsubscribe()
  }

  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
      {note && <span role="status" style={{ fontSize: 12, color: 'var(--hub-mute)' }}>{note}</span>}
      <Switch label="Phone alerts" on={on} onChange={next => {
        setNote('')
        ;(next ? turnOn() : turnOff()).then(() => setOn(next), (e: Error) => setNote(e.message))
      }} />
    </span>
  )
}
