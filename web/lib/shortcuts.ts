import type { Page } from './route'

export type ShortcutAction = { kind: 'help' | 'new' } | { kind: 'page'; page: Page }

const PAGES: Record<string, Page> = {
  n: 'now', c: 'chats', r: 'research', w: 'workbench', p: 'plan',
  l: 'live', s: 'ship', m: 'map-board', u: 'usage',
}

export function shortcutAction(keys: string): ShortcutAction | null {
  if (keys === '?') return { kind: 'help' }
  if (keys === 'n') return { kind: 'new' }
  if (keys.length === 2 && keys[0] === 'g' && PAGES[keys[1]]) return { kind: 'page', page: PAGES[keys[1]] }
  return null
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).matches !== 'function') return false
  const el = target as Element
  return el.matches('input, textarea, select, [contenteditable="true"], [role="textbox"]')
    || !!el.closest?.('dialog, [role="dialog"]')
}
