import { useState, useEffect, useRef } from 'react'

export function formatTtl(ttl: number): string {
  if (ttl === -1) return 'no expiry'
  if (ttl === -2) return 'expired'
  if (ttl < 60) return `${ttl}s`
  if (ttl < 3600) return `${Math.floor(ttl / 60)}m ${ttl % 60}s`
  return `${Math.floor(ttl / 3600)}h ${Math.floor((ttl % 3600) / 60)}m`
}

export function useLiveTtl(initialTtl: number): number {
  const [ttl, setTtl] = useState(initialTtl)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    setTtl(initialTtl)
    if (timerRef.current) clearInterval(timerRef.current)
    if (initialTtl > 0) {
      timerRef.current = setInterval(() => {
        setTtl(prev => {
          if (prev <= 1) { clearInterval(timerRef.current!); return 0 }
          return prev - 1
        })
      }, 1000)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [initialTtl])

  return ttl
}
