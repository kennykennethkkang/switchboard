/** The running editor's short name for user-facing text; activate sets it from vscode.env.appName. */
export const shortEditor = (appName: string | undefined): string => (appName ?? '').replace(/^Visual Studio Code/, 'VS Code').trim() || 'VS Code'

export const editor = { name: 'VS Code' }
