import { useState, useEffect, useRef } from 'react'
import { connBody as buildConnBody, registerSession } from '../../types'
import type { Connection } from '../../types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

interface KeyspaceEntry {
  key: string
  event: string
  db: number
  ts: number
}

type ConfigStatus = 'checking' | 'ok' | 'disabled' | 'error'

const WRITE_EVENTS  = new Set(['set','hset','lpush','rpush','lset','sadd','zadd','getset','mset','msetnx','setrange','incr','incrby','incrbyfloat','decr','decrby','append','hmset'])
const DELETE_EVENTS = new Set(['del','hdel','lrem','srem','zrem','unlink','rpop','lpop'])
const TTL_EVENTS    = new Set(['expired','expire','expireat','pexpire','pexpireat','persist'])
const RENAME_EVENTS = new Set(['rename','rename_from','rename_to','copy','copy_to','copy_from','move'])

// Categorical badge colors — one hue per event class.
function eventStyle(event: string): React.CSSProperties {
  let c = '#8b949e'
  if (WRITE_EVENTS.has(event))       c = '#22C55E'
  else if (DELETE_EVENTS.has(event)) c = '#EF4444'
  else if (TTL_EVENTS.has(event))    c = '#F59E0B'
  else if (RENAME_EVENTS.has(event)) c = '#60A5FA'
  return { color: c, borderColor: c + '55', backgroundColor: c + '18' }
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', { hour12: false, fractionalSecondDigits: 3 })
}

const MAX_ENTRIES = 500

export default function KeyspaceView({ connection, onLog }: {
  connection: Connection
  onLog?: (entry: any) => void
}) {
  const [running, setRunning]           = useState(false)
  const [entries, setEntries]           = useState<KeyspaceEntry[]>([])
  const [filter, setFilter]             = useState('')
  const [configStatus, setConfigStatus] = useState<ConfigStatus>('checking')
  const [enabling, setEnabling]         = useState(false)

  const esRef             = useRef<EventSource | null>(null)
  const entriesCountRef   = useRef(0)

  const connBody = buildConnBody(connection)

  // Check config on mount / connection change
  useEffect(() => {
    setConfigStatus('checking')
    checkConfig()
    return () => stopStream()
  }, [connection.id, connection.db])

  const checkConfig = async () => {
    try {
      const res = await fetch(`/api/redis/${connection.id}/keyspace/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(connBody),
      })
      if (!res.ok) { setConfigStatus('error'); return }
      const data = await res.json()
      setConfigStatus(data.enabled ? 'ok' : 'disabled')
    } catch {
      setConfigStatus('error')
    }
  }

  const enableNotifications = async () => {
    setEnabling(true)
    try {
      const res = await fetch(`/api/redis/${connection.id}/keyspace/enable`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(connBody),
      })
      if (!res.ok) return
      await checkConfig()
      onLog?.({ label: 'Keyspace notifications enabled', detail: 'CONFIG SET notify-keyspace-events KEA' })
    } finally {
      setEnabling(false)
    }
  }

  const stopStream = () => {
    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
    }
    setRunning(false)
  }

  const startStream = async () => {
    setEntries([])
    entriesCountRef.current = 0
    setRunning(true)

    let sessionToken: string
    try {
      sessionToken = await registerSession(connection.id, connection)
    } catch {
      setRunning(false)
      return
    }

    const params = new URLSearchParams({
      sessionToken,
      db: String(connection.db ?? 0),
      timeout: '0',
    })

    const es = new EventSource(`/api/redis/${connection.id}/keyspace/stream?${params}`)
    esRef.current = es

    es.addEventListener('keyspace', (e: MessageEvent) => {
      try {
        const entry: KeyspaceEntry = JSON.parse(e.data)
        setEntries(prev => {
          const next = [entry, ...prev].slice(0, MAX_ENTRIES)
          entriesCountRef.current = next.length
          return next
        })
      } catch { /* ignore malformed */ }
    })

    es.addEventListener('timeout', () => {
      stopStream()
    })

    es.onerror = () => {
      stopStream()
    }

    onLog?.({ label: 'Keyspace listener started', detail: `DB ${connection.db ?? 0}` })
  }

  const handleToggle = () => {
    if (running) {
      stopStream()
      onLog?.({ label: 'Keyspace listener stopped', detail: `${entriesCountRef.current} events captured` })
    } else {
      startStream()
    }
  }

  const filteredEntries = entries.filter(e =>
    !filter || e.key.includes(filter) || e.event.includes(filter)
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-6">
      <h2 className="text-lg font-semibold">Keyspace Notifications</h2>

      <div className="flex items-center justify-between gap-3 rounded-md border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 px-3.5 py-2.5 text-sm">
        <div>
          <strong>⚡ Requirement:</strong> Redis must have <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">notify-keyspace-events KEA</code> enabled to receive events.
          {configStatus === 'disabled' && ' Click "Enable Notifications" below to activate it.'}
          {configStatus === 'ok' && ' ✓ Currently enabled.'}
          {configStatus === 'checking' && ' Checking...'}
          {configStatus === 'error' && ' ⚠️ Could not check config status.'}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={checkConfig}
          disabled={configStatus === 'checking'}
          title="Refresh config status"
        >
          {configStatus === 'checking' ? '⟳' : '⟳ Refresh'}
        </Button>
      </div>

      <div className="rounded-md border bg-card px-3.5 py-2.5 text-sm text-muted-foreground">
        <strong className="text-foreground">ℹ️ What is this tab?</strong> Monitors real-time key changes (set, delete, expire, rename) for DB {connection.db ?? 0}.
        Less detailed than Monitor tab but more focused and lower overhead. Useful for watching specific key mutations.
      </div>

      {configStatus === 'disabled' && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-sm">
          <span>
            ⚠️ Keyspace notifications are <strong>disabled in Redis config</strong>. Click the button to enable them
            (runs <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">CONFIG SET notify-keyspace-events KEA</code>). Without this, no events will be received.
          </span>
          <Button onClick={enableNotifications} disabled={enabling}>
            {enabling ? 'Enabling...' : 'Enable Notifications'}
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2.5">
        <Button
          variant={running ? 'destructive' : 'default'}
          onClick={handleToggle}
          disabled={configStatus === 'checking'}
        >
          {running ? 'Stop' : 'Start'}
        </Button>
        <Input
          className="min-w-[200px] max-w-[320px] flex-1"
          placeholder="Filter by key or event..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          spellCheck={false}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => setEntries([])}
          disabled={entries.length === 0}
        >
          Clear
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">
          {filteredEntries.length}{filter ? ` / ${entries.length}` : ''} event{filteredEntries.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
        {filteredEntries.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No events yet — start listening to see real-time key changes.
          </div>
        ) : (
          <Table>
            <TableHeader className="sticky top-0 bg-card">
              <TableRow>
                <TableHead className="w-[140px]">Timestamp</TableHead>
                <TableHead className="w-[160px]">Event</TableHead>
                <TableHead>Key</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredEntries.map((entry, i) => (
                <TableRow key={i}>
                  <TableCell className="font-mono text-xs text-muted-foreground">{fmtTime(entry.ts)}</TableCell>
                  <TableCell>
                    <span
                      className="inline-block rounded border px-1.5 py-0.5 font-mono text-[11px] font-semibold"
                      style={eventStyle(entry.event)}
                    >
                      {entry.event}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{entry.key}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
