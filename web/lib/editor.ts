/** The editor the hub runs in (Cursor, Windsurf...); an older extension sends none. */
export const editorName = (state: { editor?: string } | null | undefined): string => state?.editor || 'VS Code'
