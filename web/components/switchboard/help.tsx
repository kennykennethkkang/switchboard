'use client'
import { useRef } from 'react'
import { useDialog } from '@/hooks/use-dialog'

/** A short how-it-works, from the rail's Help and the account menu. */
export function Help({ onClose, findKey }: { onClose: () => void; findKey: string }) {
  const dlg = useRef<HTMLDialogElement>(null)
  useDialog(dlg)
  return (
    <dialog ref={dlg} className="hub help" aria-labelledby="help-t" onClose={() => { if (!dlg.current?.open) onClose() }} onClick={e => { if (e.target === dlg.current) dlg.current?.close() }}>
      <h2 id="help-t">How Switchboard works</h2>
      <p className="help-lead">Give Claude a job, then come back when it needs you.</p>
      <ol>
        <li><b>Start a chat.</b> Press New chat and say what you want done.</li>
        <li><b>It works on its own.</b> Home shows what is running.</li>
        <li><b>It asks when it needs you.</b> Questions and finished work wait under Needs you.</li>
        <li><b>You approve.</b> Look over the change, then Approve. Nothing is committed until you press Commit.</li>
      </ol>
      <h3>Where things are</h3>
      <dl>
        <dt>Sign in and updates</dt><dd>The account button, or Settings.</dd>
        <dt>Find</dt><dd>{findKey} finds any chat or command.</dd>
        <dt>Coder view</dt><dd>Adds Live, Ship, Map, models and every setting.</dd>
      </dl>
      <div className="help-acts"><button type="button" className="hub-btn" autoFocus onClick={() => dlg.current?.close()}>Close</button></div>
    </dialog>
  )
}
