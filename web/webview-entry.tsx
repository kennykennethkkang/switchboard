import { createRoot } from 'react-dom/client'
import { Switchboard } from './components/switchboard/switchboard'
import { ResearchPanel } from './components/switchboard/research-panel'
import { startResearchStore } from './lib/research-store'
import { vscodeBridge } from './lib/vscode-bridge'
import './app/globals.css'

// Production webview: use VS Code API for messaging
declare function acquireVsCodeApi(): { postMessage(msg: unknown): void }
const vscodeApi = acquireVsCodeApi()

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element #root not found')
// The Research window: <div id="root" data-research="<sessionId>">
const research = rootElement.dataset.research
// The Research window's hub tab: <div id="root" data-page="research">, unless the hash already picked a page.
if (rootElement.dataset.page && !location.hash) location.hash = rootElement.dataset.page
// The replay can land before React mounts; the store keeps it, for the tab and the hub's inline panel alike.
startResearchStore()

// Configure bridge to use VS Code API instead of window.parent.postMessage
if (vscodeBridge) {
  vscodeBridge.configureWebviewApi((msg) => vscodeApi.postMessage(msg))
  // Signal readiness to extension host
  vscodeApi.postMessage({ type: 'ready' })
}

// Mount the React app
const root = createRoot(rootElement)
root.render(research ? <ResearchPanel sessionId={research} /> : <Switchboard />)
