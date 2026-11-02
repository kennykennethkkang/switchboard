// Mods import types from the Claude Code runtime, which is not installed here; enough for the test typecheck.
declare module 'claude-code' {
  type Handler = (...args: any[]) => any
  export type EngineInterface = any
  export type Register = (on: (event: string, fn: Handler) => { catch(fn: Handler): void }) => void
}
