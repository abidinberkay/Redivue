import { useLiveTtl } from '../hooks/useLiveTtl'

export function LiveTtl({ ttl: initialTtl }: { ttl: number }) {
  const ttl = useLiveTtl(initialTtl)

  const fmt = (t: number) => {
    if (t === -1) return 'no expiry'
    if (t === -2 || t === 0) return 'expired'
    if (t < 60) return `${t}s`
    if (t < 3600) return `${Math.floor(t / 60)}m ${t % 60}s`
    return `${Math.floor(t / 3600)}h ${Math.floor((t % 3600) / 60)}m`
  }

  const cls = ttl === -1 ? 'ttl-no-expiry' : ttl > 3600 ? 'ttl-ok' : ttl > 60 ? 'ttl-warn' : ttl > 0 ? 'ttl-danger' : 'ttl-expired'
  return <span className={`value-ttl ${cls}`}>TTL: {fmt(ttl)}</span>
}
