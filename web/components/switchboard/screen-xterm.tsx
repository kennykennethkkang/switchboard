'use client'
// The Screen tab's terminal: the ANSI screen drawn by xterm.js, display only. Loaded on demand, so xterm stays out
// of the page until someone opens a screen. fit (phones) scales the width into the pane; else it draws at 12px.
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { fitScale, type Screen } from '@/lib/screen'

export default function ScreenXterm({ screen, fit }: { screen: Screen; fit: boolean }) {
  const holder = useRef<HTMLDivElement>(null), pane = useRef<HTMLDivElement>(null), term = useRef<Terminal | null>(null)
  const [size, setSize] = useState<{ w: number; h: number; k: number }>()
  useEffect(() => {
    const el = holder.current
    if (!el) return
    const css = getComputedStyle(el)
    const t = new Terminal({
      cols: screen.cols, rows: screen.rows, scrollback: 0, disableStdin: true, cursorBlink: false, cursorInactiveStyle: 'none', screenReaderMode: false,
      fontSize: 12, lineHeight: 1.15, fontFamily: css.fontFamily, minimumContrastRatio: 4.5,
      theme: { background: css.backgroundColor, foreground: css.color },
    })
    t.open(el)
    // xterm's input box is a tab stop even with stdin off; the pane is the one stop here
    const input = el.querySelector('textarea')
    input?.setAttribute('tabindex', '-1')
    input?.setAttribute('aria-hidden', 'true')
    term.current = t
    return () => { t.dispose(); term.current = null }
    // One terminal per mount; the screen itself goes in below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    const t = term.current
    if (!t) return
    if (t.cols !== screen.cols || t.rows !== screen.rows) t.resize(screen.cols, screen.rows)
    // Rows overwrite in place and clear to their end, so a frame never flashes empty.
    t.write(`\x1b[?25l\x1b[H${(screen.ansi ?? screen.text).split('\n').map(l => `${l}\x1b[K`).join('\r\n')}\x1b[J`)
  }, [screen.at, screen.ansi, screen.text, screen.cols, screen.rows])
  // Fit: scale what xterm drew into the pane's width; past the 11px floor the pane scrolls sideways.
  useLayoutEffect(() => {
    if (!fit) return setSize(undefined)
    const measure = () => {
      const screenEl = holder.current?.querySelector<HTMLElement>('.xterm-screen'), p = pane.current
      if (!screenEl?.offsetWidth || !p) return
      const css = getComputedStyle(p), room = p.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight)
      const next = { w: screenEl.offsetWidth, h: screenEl.offsetHeight, k: fitScale(room, screenEl.offsetWidth) }
      setSize(o => o && o.w === next.w && o.h === next.h && o.k === next.k ? o : next)
    }
    measure()
    const ro = new ResizeObserver(measure)
    for (const el of [pane.current, holder.current]) if (el) ro.observe(el)
    return () => ro.disconnect()
  }, [fit, screen.cols, screen.rows])
  return (
    <div ref={pane} className="cv-xt" role="region" tabIndex={0} aria-label={`Terminal screen, ${screen.cols} by ${screen.rows}. Copy it to read it as text.`}>
      <div className="cv-xt-size" style={size ? { width: size.w * size.k, height: size.h * size.k } : undefined}>
        <div className="cv-xt-box" style={size ? { transform: `scale(${size.k})` } : undefined}>
          <div ref={holder} className="cv-xt-term" />
        </div>
      </div>
    </div>
  )
}
