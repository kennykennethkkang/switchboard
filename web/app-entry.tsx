import { createRoot } from 'react-dom/client'
import { Switchboard } from './components/switchboard/switchboard'
import './app/globals.css'
import { buildWatcher } from './lib/reload'

// Standalone CLI entry: no VS Code API, connects to relay via SSE
const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element #root not found')
const root = createRoot(rootElement)
root.render(<Switchboard />)

// A rebuilt Switchboard restarts the app: pick up its files without a manual refresh.
const checkBuild = buildWatcher(() => location.reload())
void checkBuild()
setInterval(() => { if (!document.hidden) void checkBuild() }, 30_000)
document.addEventListener('visibilitychange', () => { if (!document.hidden) void checkBuild() })
