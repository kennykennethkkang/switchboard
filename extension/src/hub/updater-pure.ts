export function compareVersions(a: string, b: string): number {
  const parts = (version: string) => {
    const parsed = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version)
    if (!parsed) throw new Error(`Invalid version: ${version}`)
    return parsed.slice(1).map(Number)
  }
  const left = parts(a), right = parts(b)
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1
  return 0
}

export function pickReleaseAssets(assets: Array<{ name: string; browser_download_url: string }>, version: string) {
  const vsix = assets.find(asset => asset.name === `switchboard-${version}.vsix`)
  const checksum = assets.find(asset => asset.name === `${vsix?.name}.sha256`)
  return vsix && checksum ? { vsix: vsix.browser_download_url, checksum: checksum.browser_download_url } : undefined
}

export function shouldPull(state: { exists: boolean; isRepo: boolean; clean: boolean; onDefaultBranch: boolean; behind: boolean }): boolean {
  return state.exists && state.isRepo && state.clean && state.onDefaultBranch && state.behind
}
