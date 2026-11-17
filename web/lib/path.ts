export const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path
