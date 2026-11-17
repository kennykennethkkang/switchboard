import assert from 'node:assert/strict'
import test from 'node:test'
import { readStore, removeStore, writeStore } from './store'

test('store helpers read and write local and session storage', () => {
  const local = new Map<string, string>(), session = new Map<string, string>()
  const before = [Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')]
  const storage = (data: Map<string, string>) => ({ getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => { data.delete(key) } })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage(local) })
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage(session) })
  try {
    writeStore('local', 'saved')
    writeStore('session', 'saved', 'session')
    assert.equal(readStore('local'), 'saved')
    assert.equal(readStore('session', 'session'), 'saved')
    removeStore('local')
    assert.equal(readStore('local'), null)
  } finally {
    for (const [key, descriptor] of [['localStorage', before[0]], ['sessionStorage', before[1]]] as const)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as Record<string, unknown>)[key]
  }
})

test('store helpers ignore unavailable storage', () => {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('unavailable') } })
  try {
    assert.equal(readStore('x'), null)
    assert.doesNotThrow(() => writeStore('x', 'y'))
    assert.doesNotThrow(() => removeStore('x'))
  } finally {
    if (before) Object.defineProperty(globalThis, 'localStorage', before); else delete (globalThis as Record<string, unknown>).localStorage
  }
})
