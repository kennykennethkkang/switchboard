type DurationStyle = 'ago' | 'short' | 'stuck' | 'eta' | 'elapsed' | 'countdown' | 'cache' | 'indefinite'

export function formatDuration(ms: number, style: DurationStyle): string {
  const min = style === 'elapsed' ? Math.floor(ms / 60_000)
    : style === 'countdown' ? Math.ceil(ms / 60_000)
      : style === 'indefinite' ? Math.max(0, Math.floor(ms / 60_000))
        : style === 'short' ? Math.floor(ms / 60_000)
          : Math.round(ms / 60_000)

  if (style === 'ago') return min < 1 ? 'now' : min < 60 ? `${min} min` : min < 36 * 60 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} d`
  if (style === 'short') return min < 1 ? 'now' : min < 60 ? `${min}m` : min < 48 * 60 ? `${Math.floor(min / 60)}h` : `${Math.floor(min / 1440)}d`
  if (style === 'stuck') return min < 60 ? `${Math.max(1, min)} min` : `${Math.round(min / 60)} h`
  if (style === 'eta') {
    if (min < 1) return 'under a minute'
    if (min < 60) return `about ${min} min`
    const five = Math.round(min / 5) * 5, h = Math.floor(five / 60), rest = five % 60
    return `about ${h} h${rest ? ` ${rest} min` : ''}`
  }
  if (style === 'elapsed') return min < 1 ? 'just now' : min < 60 ? `${min}m` : `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}m` : ''}`
  if (style === 'countdown') {
    if (ms < 60_000) return 'under 1m'
    const h = Math.floor(min / 60)
    return h ? `${h}h${min % 60 ? ` ${min % 60}m` : ''}` : `${min}m`
  }
  if (style === 'cache') return `${Math.max(1, min)} min`
  return min < 1 ? 'just now' : min < 60 ? `${min} min ago` : `${Math.floor(min / 60)} h ago`
}
