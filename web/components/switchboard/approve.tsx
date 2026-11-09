'use client'
import type { DoneCheck } from '@/lib/hub-types'
import type { HubCommand } from '@/lib/vscode-bridge'
import { checkLine, sendBackText } from '@/lib/approve'

/** Warning triangle, for a check or request that did not pass. */
export const Warn = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" style={{ flex: 'none' }}>
    <path d="M8 2 15 14H1Z" /><path d="M8 6.5v3.5M8 12v.01" strokeLinecap="round" />
  </svg>
)

/** Ready to approve: the done-check verdict, Approve and Send back. */
export function ApproveBar({ sessionId, check, send, small }: { sessionId: string; check?: DoneCheck; send: (c: HubCommand) => void; small?: boolean }) {
  const line = checkLine(check)
  const sm = small ? ' sm' : ''
  return (
    <div className="hub-approve" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 13 }}>
      <span style={{ color: 'var(--hub-yellow)' }}>Ready to approve</span>
      {line && <span title={line} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: check?.verified ? 'var(--hub-green)' : 'var(--hub-red)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{!check?.verified && <Warn />}{line}</span>}
      <span style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
        <button type="button" className={`hub-btn primary${sm}`} onClick={() => send({ type: 'hub-approve', sessionId })}>Approve</button>
        <button type="button" className={`hub-btn${sm}`} onClick={() => send({ type: 'hub-send', sessionId, text: sendBackText(check) })}>Send back</button>
      </span>
    </div>
  )
}
