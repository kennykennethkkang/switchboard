'use client'
import { useEffect, useMemo, useState } from 'react'
import { readStore, writeStore } from '@/lib/store'
import { deviceMailto, MAIL_KEY, validEmail } from '@/lib/device-mail'
import { useFlash } from '@/hooks/use-flash'
import qrcode from 'qrcode-generator'

/** The phone link as a QR, dark on white in both themes so any camera reads it. */
export function PhoneQr({ url, label }: { url: string; label: string }) {
  const { n, d } = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(url)
    qr.make()
    const n = qr.getModuleCount()
    let d = ''
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`
    return { n, d }
  }, [url])
  return (
    <svg viewBox={`0 0 ${n + 8} ${n + 8}`} width={180} height={180} role="img" aria-label={label} shapeRendering="crispEdges" style={{ borderRadius: 6 }}>
      <rect width={n + 8} height={n + 8} fill="#ffffff" />
      <path d={d} fill="#000000" />
    </svg>
  )
}

const originOf = (url: string) => { try { return new URL(url).origin } catch { return url } }

/** The address to type by hand (the IP one too, when the name is first), and the full link (with its secret) to copy;
 * the secret is only needed on a device's first visit. */
export function PhoneAddress({ url, ip, onCopy }: { url: string; ip?: string; onCopy: (text: string) => Promise<boolean> }) {
  const [copied, setCopied] = useFlash(false, 1500)
  return (
    <span style={{ display: 'grid', gap: 6, justifyItems: 'center' }}>
      <code style={{ font: '500 13px/1.3 var(--hub-mono)', color: 'var(--hub-ink)', userSelect: 'all', overflowWrap: 'anywhere', textAlign: 'center' }}>{originOf(url)}</code>
      {ip && <code style={{ font: '400 12px/1.3 var(--hub-mono)', color: 'var(--hub-mute)', userSelect: 'all', overflowWrap: 'anywhere', textAlign: 'center' }}>{originOf(ip)}</code>}
      <button type="button" className="hub-btn" style={{ fontSize: 12, padding: '3px 10px' }} title="The link with its secret: open it once on a new device"
        onClick={() => void onCopy(url).then(ok => setCopied(ok, ok ? undefined : null))}>{copied ? 'Copied' : 'Copy link'}</button>
    </span>
  )
}

/** Email the device link to an address the user types (kept in this browser only). Opens a draft in their own mail app. */
export function PhoneMail({ url }: { url: string }) {
  const [email, setEmail] = useState('')
  useEffect(() => { setEmail(readStore(MAIL_KEY) ?? '') }, [])
  const href = deviceMailto(email, url)
  const bad = email.trim() !== '' && !validEmail(email)
  return (
    <span style={{ display: 'grid', gap: 6, justifyItems: 'center', paddingTop: 8, borderTop: '1px solid var(--hub-hair)', width: '100%' }}>
      <label style={{ display: 'grid', gap: 4, width: '100%', font: '400 12px/1.4 var(--hub-sans)', color: 'var(--hub-mute)' }}>
        Email the link to your other device
        <input type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" value={email} aria-invalid={bad || undefined}
          onChange={e => { setEmail(e.target.value); if (validEmail(e.target.value) || !e.target.value.trim()) writeStore(MAIL_KEY, e.target.value.trim()) }}
          style={{ font: '400 13px/1.3 var(--hub-sans)', padding: '5px 8px', borderRadius: 6, border: `1px solid ${bad ? 'var(--hub-red, #ff6363)' : 'var(--hub-hair)'}`, background: 'transparent', color: 'var(--hub-ink)', width: '100%', boxSizing: 'border-box' }} />
      </label>
      {href ? <a className="hub-btn" href={href} style={{ fontSize: 12, padding: '3px 10px', textDecoration: 'none' }}>Send link</a>
        : <button type="button" className="hub-btn" disabled style={{ fontSize: 12, padding: '3px 10px' }}>Send link</button>}
      <span style={{ font: '400 12px/1.5 var(--hub-sans)', color: 'var(--hub-ash)', maxWidth: 220 }}>Opens a draft in your mail app. The email holds the link: send it only to yourself.</span>
    </span>
  )
}
