import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import './MonitorView.css'
import { registerSession } from '../../types'

const AUTO_STOP_OPTIONS = [30, 60, 120, 300, 0]
const MAX_RECONNECT = 5

function parseMonitorLine(line) {
  const m = line.match(/^([\d.]+) \[(\d+ [^\]]+)\] (.+)$/)
  if (!m) return { timestamp: '', dbClient: '', command: line, cmdName: '', raw: line }
  const [, ts, dbClient, command] = m
  const d = new Date(parseFloat(ts) * 1000)
  const timestamp = d.toLocaleTimeString('en-US', { hour12: false, fractionalSecondDigits: 3 })
  // Extract first token, stripping Redis protocol quotes: "PING" → PING
  const cmdName = command.replace(/^"/, '').split(/[\s"]/)[0].toUpperCase()
  return { timestamp, dbClient, command, cmdName, raw: line }
}

function formatDuration(micros) {
  if (micros < 1000) return `${micros}µs`
  if (micros < 1000000) return `${(micros / 1000).toFixed(2)}ms`
  return `${(micros / 1000000).toFixed(3)}s`
}

function formatTs(unix) {
  return new Date(unix * 1000).toLocaleString()
}

const REGEX_EXAMPLES = [
  { label: 'Health checks',       pattern: 'PING|HELLO' },
  { label: 'Read commands',       pattern: '^"?(GET|HGET|LRANGE|SMEMBERS|ZRANGE)' },
  { label: 'Write commands',      pattern: '^"?(SET|HSET|LPUSH|SADD|ZADD)' },
  { label: 'Connection / auth',   pattern: '^"?(CLIENT|AUTH|SELECT)' },
  { label: 'Specific client IP',  pattern: '192\\.168\\.1\\.1' },
  { label: 'Multiple commands',   pattern: '^"?(PING|HELLO|AUTH|CLIENT)' },
]

function RegexInfoBtn({ onSelect }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number }>({ top: 0, left: 0 })
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const popupRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const handler = e => {
      if (
        btnRef.current && !btnRef.current.contains(e.target) &&
        popupRef.current && !popupRef.current.contains(e.target)
      ) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 8, right: window.innerWidth - r.right })
    }
    setOpen(o => !o)
  }

  return (
    <>
      <button ref={btnRef} className="regex-info-btn" onClick={toggle} title="Show regex examples">i</button>
      {open && (
        <div ref={popupRef} className="regex-info-popup" style={{ top: pos.top, right: pos.right }}>
          <div className="regex-info-title">Common hide patterns — click to use</div>
          {REGEX_EXAMPLES.map(ex => (
            <div key={ex.pattern} className="regex-info-row" onClick={() => { onSelect(ex.pattern); setOpen(false) }}>
              <span className="regex-info-label">{ex.label}</span>
              <code className="regex-info-pattern">{ex.pattern}</code>
            </div>
          ))}
          <div className="regex-info-hint">Patterns are case-insensitive. Matched against the full raw command line.</div>
        </div>
      )}
    </>
  )
}

export default function MonitorView({ connection, onLog }) {
  const [running, setRunning] = useState(false)
  const [entries, setEntries] = useState([])
  const [filter, setFilter] = useState('')
  const [timeLeft, setTimeLeft] = useState(0)
  const [autoStop, setAutoStop] = useState(60)
  const [showWarning, setShowWarning] = useState(false)
  const [monitorError, setMonitorError] = useState('')
  const [reconnectAttempt, setReconnectAttempt] = useState(0)

  const [hidePing, setHidePing] = useState(false)
  const [hideRegex, setHideRegex] = useState('')
  const [hideRegexError, setHideRegexError] = useState(false)

  const hideRe = useMemo(() => {
    if (!hideRegex.trim()) return null
    try {
      const re = new RegExp(hideRegex, 'i')
      setHideRegexError(false)
      return re
    } catch {
      setHideRegexError(true)
      return null
    }
  }, [hideRegex])

  const [slowlog, setSlowlog] = useState([])
  const [slowlogLoading, setSlowlogLoading] = useState(false)
  const [slowlogError, setSlowlogError] = useState('')

  const THRESHOLD_KEY = 'redivue_slowlog_thresholds'
  const savedThresholds = (() => { try { return JSON.parse(localStorage.getItem(THRESHOLD_KEY) || '{}') } catch { return {} } })()
  const [warnMs, setWarnMs] = useState<number>(savedThresholds.warnMs ?? 10)
  const [dangerMs, setDangerMs] = useState<number>(savedThresholds.dangerMs ?? 100)
  const [warnText, setWarnText] = useState<string>(String(savedThresholds.warnMs ?? 10))
  const [dangerText, setDangerText] = useState<string>(String(savedThresholds.dangerMs ?? 100))

  const saveThresholds = (warn: number, danger: number) => {
    try { localStorage.setItem(THRESHOLD_KEY, JSON.stringify({ warnMs: warn, dangerMs: danger })) } catch { /* ignore */ }
  }

  useEffect(() => {
    saveThresholds(warnMs, dangerMs)
  }, [warnMs, dangerMs])

  const durClass = useCallback((micros: number) => {
    if (micros > dangerMs * 1000) return 'dur-danger'
    if (micros > warnMs * 1000) return 'dur-warn'
    return 'dur-ok'
  }, [warnMs, dangerMs])

  const barClass = useCallback((micros: number) => {
    if (micros > dangerMs * 1000) return 'lat-bar-danger'
    if (micros > warnMs * 1000) return 'lat-bar-warn'
    return 'lat-bar-ok'
  }, [warnMs, dangerMs])

  const esRef = useRef(null)
  const timerRef = useRef(null)
  const streamRef = useRef(null)
  const entriesCountRef = useRef(0)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attemptRef = useRef(0)
  const connectStreamRef = useRef<() => void>(() => {})

  const connBody = {
    host: connection.host,
    port: connection.port,
    password: connection.password,
    db: connection.db ?? 0,
  }

  const stopMonitor = useCallback((capturedCount?: number | null) => {
    if (esRef.current) { esRef.current.close(); esRef.current = null }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null }
    attemptRef.current = 0
    setReconnectAttempt(0)
    setRunning(false)
    setTimeLeft(0)
    if (capturedCount != null) {
      onLog?.({ label: 'Monitor stopped', detail: `${capturedCount} commands captured` })
    }
  }, [onLog])

  const connectStream = useCallback(async () => {
    if (esRef.current) { esRef.current.close(); esRef.current = null }

    const sessionToken = await registerSession(connection.id, connection)
    const params = new URLSearchParams({
      sessionToken,
      timeout: String(autoStop),
    })

    const es = new EventSource(`/api/redis/${connection.id}/monitor/stream?${params}`)
    esRef.current = es

    es.addEventListener('monitor', e => {
      if (attemptRef.current > 0) {
        attemptRef.current = 0
        setReconnectAttempt(0)
      }
      setEntries(prev => {
        const next = [parseMonitorLine(e.data), ...prev].slice(0, 500)
        entriesCountRef.current = next.length
        return next
      })
    })

    es.addEventListener('timeout', e => {
      setMonitorError(`Auto-stopped after ${e.data}s`)
      stopMonitor(entriesCountRef.current)
    })

    // Fatal errors (auth failure, MONITOR rejected) — stop immediately, no reconnect
    es.addEventListener('fatal-error', e => {
      setMonitorError(e.data || 'Monitor error')
      stopMonitor(entriesCountRef.current)
    })

    // Transient errors (Redis down, network loss) — attempt reconnect
    es.addEventListener('monitor-error', e => {
      if (!esRef.current) return
      esRef.current.close()
      esRef.current = null
      scheduleReconnect()
    })

    const scheduleReconnect = () => {
      const next = attemptRef.current + 1
      if (next > MAX_RECONNECT) {
        setMonitorError(`Connection lost after ${MAX_RECONNECT} reconnect attempts.`)
        setRunning(false)
        setReconnectAttempt(0)
        attemptRef.current = 0
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
        return
      }
      attemptRef.current = next
      setReconnectAttempt(next)
      const delay = Math.min(1000 * Math.pow(2, next - 1), 16000)
      reconnectTimerRef.current = setTimeout(() => {
        connectStreamRef.current()
      }, delay)
    }

    es.onerror = () => {
      if (!esRef.current) return
      esRef.current.close()
      esRef.current = null
      scheduleReconnect()
    }
  }, [connection, autoStop, stopMonitor])

  useEffect(() => { connectStreamRef.current = connectStream }, [connectStream])

  useEffect(() => () => stopMonitor(), [stopMonitor])

  const startMonitor = () => {
    setMonitorError('')
    setEntries([])
    entriesCountRef.current = 0
    attemptRef.current = 0
    setReconnectAttempt(0)
    setRunning(true)
    onLog?.({ label: 'Monitor started', detail: `Auto-stop: ${autoStop === 0 ? 'Unlimited' : autoStop + 's'}` })

    if (autoStop > 0) {
      setTimeLeft(autoStop)
      timerRef.current = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) { clearInterval(timerRef.current); return 0 }
          return prev - 1
        })
      }, 1000)
    } else {
      setTimeLeft(0)
    }

    connectStream()
  }

  const fetchSlowlog = async () => {
    setSlowlogLoading(true)
    setSlowlogError('')
    try {
      const res = await fetch(`/api/redis/${connection.id}/slowlog`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...connBody, count: 25 }),
      })
      if (!res.ok) throw new Error('Failed to fetch slow log')
      setSlowlog(await res.json())
    } catch (e) {
      setSlowlogError(e.message)
    } finally {
      setSlowlogLoading(false)
    }
  }

  const filteredEntries = entries.filter(e =>
    (!hidePing || e.cmdName !== 'PING') &&
    (!hideRe || !hideRe.test(e.raw)) &&
    (!filter || e.raw.toLowerCase().includes(filter.toLowerCase()))
  )

  const filteredSlowlog = slowlog.filter(e => {
    const cmd = (e.command || []).join(' ')
    if (hidePing && (e.command?.[0] || '').toUpperCase() === 'PING') return false
    if (hideRe && hideRe.test(cmd)) return false
    return true
  })

  const exportMonitorLog = () => {
    const header = 'Time\tDB/Client\tCommand\n'
    const lines = filteredEntries.map(e => `${e.timestamp}\t${e.dbClient}\t${e.command}`).join('\n')
    const blob = new Blob([header + lines], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `monitor-${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportSlowlogCsv = () => {
    const header = 'ID,Duration,Command,Timestamp,Client\n'
    const rows = filteredSlowlog.map(e =>
      [e.id, e.durationMicros, `"${(e.command || []).join(' ')}"`, formatTs(e.timestamp), e.clientAddr].join(',')
    ).join('\n')
    const blob = new Blob([header + rows], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `slowlog-${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const slowlogStats = useMemo(() => {
    if (!filteredSlowlog.length) return null
    const total = filteredSlowlog.length
    const durations = filteredSlowlog.map(e => e.durationMicros)
    const avgMicros = durations.reduce((s, v) => s + v, 0) / total
    const maxMicros = Math.max(...durations)
    const minMicros = Math.min(...durations)

    const cmdMap: Record<string, { count: number; totalMicros: number; maxMicros: number }> = {}
    filteredSlowlog.forEach(e => {
      const cmd = (e.command?.[0] || 'UNKNOWN').toUpperCase()
      if (!cmdMap[cmd]) cmdMap[cmd] = { count: 0, totalMicros: 0, maxMicros: 0 }
      cmdMap[cmd].count++
      cmdMap[cmd].totalMicros += e.durationMicros
      if (e.durationMicros > cmdMap[cmd].maxMicros) cmdMap[cmd].maxMicros = e.durationMicros
    })

    const topCommands = Object.entries(cmdMap)
      .map(([cmd, s]) => ({ cmd, count: s.count, avgMicros: s.totalMicros / s.count, maxMicros: s.maxMicros, totalMicros: s.totalMicros }))
      .sort((a, b) => b.totalMicros - a.totalMicros)
      .slice(0, 8)

    return { total, avgMicros, maxMicros, minMicros, topCommands }
  }, [filteredSlowlog])

  return (
    <div className="monitor-view">

      {/* ── MONITOR section ── */}
      <div className="monitor-section">
        <div className="monitor-section-header">
          <div className="monitor-title-row">
            <h3 className="monitor-section-title">MONITOR</h3>
            {!running && (
              <div className="monitor-stop-options">
                <span className="monitor-label">{autoStop === 0 ? 'Duration' : 'Auto-stop after'}</span>
                {AUTO_STOP_OPTIONS.map(s => (
                  <button
                    key={s}
                    className={`stop-option-btn ${autoStop === s ? 'active' : ''}`}
                    onClick={() => setAutoStop(s)}
                  >
                    {s === 0 ? 'Unlimited' : `${s}s`}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="monitor-controls">
            <label className="monitor-hide-ping">
              <input type="checkbox" checked={hidePing} onChange={e => setHidePing(e.target.checked)} />
              Hide PING
            </label>
            <div className="regex-input-group">
              <input
                className={`monitor-hide-regex-input ${hideRegexError ? 'regex-error' : ''}`}
                placeholder="Hide regex…"
                value={hideRegex}
                onChange={e => setHideRegex(e.target.value)}
                title={hideRegexError ? 'Invalid regular expression' : 'Hide commands matching this regex'}
                spellCheck={false}
              />
              <RegexInfoBtn onSelect={setHideRegex} />
            </div>
            {(running || entries.length > 0) && (
              <input
                className="monitor-filter-input"
                placeholder="Filter commands..."
                value={filter}
                onChange={e => setFilter(e.target.value)}
              />
            )}
            {running && autoStop > 0 && reconnectAttempt === 0 && (
              <span className={`monitor-countdown ${timeLeft <= 10 ? 'danger' : ''}`}>
                {timeLeft}s left
              </span>
            )}
            {reconnectAttempt > 0 && (
              <span className="monitor-reconnecting">
                Reconnecting {reconnectAttempt}/{MAX_RECONNECT}…
              </span>
            )}
            {running
              ? <button className="monitor-stop-btn" onClick={() => stopMonitor(entriesCountRef.current)}>Stop</button>
              : <button className="monitor-start-btn" onClick={() => setShowWarning(true)}>Start</button>
            }
          </div>
        </div>

        {monitorError && <div className="monitor-error-bar">{monitorError}</div>}

        <div className="monitor-stream">
          {!running && entries.length === 0 && (
            <div className="monitor-idle">
              <p>Click <strong>Start</strong> to begin capturing Redis commands in real time.</p>
              <p className="monitor-idle-sub">Monitor streams every command executed on this Redis instance.</p>
            </div>
          )}
          {entries.length > 0 && (
            <table className="monitor-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>DB / Client</th>
                  <th>Command</th>
                </tr>
              </thead>
              <tbody>
                {filteredEntries.map((e, i) => (
                  <tr key={i}>
                    <td className="monitor-ts">{e.timestamp}</td>
                    <td className="monitor-client">{e.dbClient}</td>
                    <td className="monitor-cmd">{e.command}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {running && entries.length === 0 && (
            <div className="monitor-waiting">Waiting for Redis commands...</div>
          )}
        </div>

        {entries.length > 0 && (
          <div className="monitor-footer">
            {filteredEntries.length} of {entries.length} entries
            {entries.length === 500 && <span className="monitor-cap"> (capped at 500)</span>}
            {hidePing && entries.length !== filteredEntries.length && (
              <span className="monitor-ping-hidden"> · {entries.length - filteredEntries.length} PING hidden</span>
            )}
            <button className="monitor-export-btn" onClick={exportMonitorLog} title="Export visible entries as .txt">Export</button>
            <button className="monitor-clear-btn" onClick={() => setEntries([])}>Clear</button>
          </div>
        )}
      </div>

      {/* ── SLOWLOG section ── */}
      <div className="slowlog-section">
        <div className="monitor-section-header">
          <h3 className="monitor-section-title">SLOW LOG</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className="slowlog-thresholds">
              <label className="threshold-label">Warn &gt;
                <input
                  className="threshold-input" value={warnText} placeholder="0.1"
                  onChange={e => setWarnText(e.target.value)}
                  onBlur={() => {
                    const v = parseFloat(warnText)
                    const valid = isNaN(v) || v <= 0 ? 0.1 : v
                    setWarnMs(valid)
                    setWarnText(String(valid))
                  }}
                />ms
              </label>
              <label className="threshold-label">Danger &gt;
                <input
                  className="threshold-input" value={dangerText} placeholder="0.2"
                  onChange={e => setDangerText(e.target.value)}
                  onBlur={() => {
                    const v = parseFloat(dangerText)
                    const valid = isNaN(v) || v <= 0 ? 0.2 : v
                    setDangerMs(valid)
                    setDangerText(String(valid))
                  }}
                />ms
              </label>
            </div>
            <label className="monitor-hide-ping">
              <input type="checkbox" checked={hidePing} onChange={e => setHidePing(e.target.checked)} />
              Hide PING
            </label>
            <div className="regex-input-group">
              <input
                className={`monitor-hide-regex-input ${hideRegexError ? 'regex-error' : ''}`}
                placeholder="Hide regex…"
                value={hideRegex}
                onChange={e => setHideRegex(e.target.value)}
                title={hideRegexError ? 'Invalid regular expression' : 'Hide commands matching this regex'}
                spellCheck={false}
              />
              <RegexInfoBtn onSelect={setHideRegex} />
            </div>
            {slowlog.length > 0 && (
              <button className="monitor-export-btn" onClick={exportSlowlogCsv} title="Export slow log as CSV">Export CSV</button>
            )}
            <button className="monitor-refresh-btn" onClick={fetchSlowlog} disabled={slowlogLoading}>
              {slowlogLoading ? 'Loading...' : 'Refresh'}
            </button>
          </div>
        </div>

        {slowlogError && <div className="monitor-error-bar">{slowlogError}</div>}

        {slowlogStats && (
          <>
            <div className="slowlog-stats-bar">
              <span className="slowlog-stat-item"><span className="slowlog-stat-label">Entries</span>{slowlogStats.total}</span>
              <span className="slowlog-stat-item"><span className="slowlog-stat-label">Avg</span><span className={durClass(slowlogStats.avgMicros)}>{formatDuration(Math.round(slowlogStats.avgMicros))}</span></span>
              <span className="slowlog-stat-item"><span className="slowlog-stat-label">Max</span><span className={durClass(slowlogStats.maxMicros)}>{formatDuration(slowlogStats.maxMicros)}</span></span>
              <span className="slowlog-stat-item"><span className="slowlog-stat-label">Min</span><span className="dur-ok">{formatDuration(slowlogStats.minMicros)}</span></span>
            </div>
            <div className="slowlog-top-cmds">
              <div className="slowlog-top-title">Top Commands by Total Time</div>
              <div className="latency-chart">
                {(() => {
                  const maxTotal = Math.max(...slowlogStats.topCommands.map(c => c.totalMicros), 1)
                  return slowlogStats.topCommands.map(({ cmd, avgMicros, totalMicros }) => {
                    const pct = Math.round((totalMicros / maxTotal) * 100)
                    const colorClass = barClass(avgMicros)
                    return (
                      <div key={cmd} className="latency-row">
                        <span className="latency-cmd">{cmd}</span>
                        <div className="latency-bar-wrap">
                          <div className={`latency-bar ${colorClass}`} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="latency-label">{formatDuration(totalMicros)}</span>
                      </div>
                    )
                  })
                })()}
              </div>
              <table className="monitor-table slowlog-top-table">
                <thead>
                  <tr>
                    <th>Command</th>
                    <th>Count</th>
                    <th>Avg Duration</th>
                    <th>Max Duration</th>
                    <th>Total Time</th>
                  </tr>
                </thead>
                <tbody>
                  {slowlogStats.topCommands.map(({ cmd, count, avgMicros, maxMicros, totalMicros }) => (
                    <tr key={cmd}>
                      <td className="monitor-cmd">{cmd}</td>
                      <td className="monitor-ts">{count}</td>
                      <td className={`slowlog-dur ${durClass(avgMicros)}`}>{formatDuration(Math.round(avgMicros))}</td>
                      <td className={`slowlog-dur ${durClass(maxMicros)}`}>{formatDuration(maxMicros)}</td>
                      <td className={`slowlog-dur ${durClass(totalMicros)}`}>{formatDuration(totalMicros)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {slowlog.length === 0 && !slowlogLoading ? (
          <div className="monitor-idle">
            <p>Click <strong>Refresh</strong> to load the slow query log.</p>
            <p className="monitor-idle-sub">Shows commands that exceeded the <code>slowlog-log-slower-than</code> threshold.</p>
          </div>
        ) : (
          <div className="slowlog-table-wrap">
            <div className="slowlog-table-title">
              All Entries
              {hidePing && slowlog.length !== filteredSlowlog.length && (
                <span className="slowlog-ping-hidden"> ({slowlog.length - filteredSlowlog.length} PING hidden)</span>
              )}
            </div>
            <table className="monitor-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Duration</th>
                  <th>Command</th>
                  <th>Timestamp</th>
                  <th>Client</th>
                </tr>
              </thead>
              <tbody>
                {filteredSlowlog.map(entry => (
                  <tr key={entry.id}>
                    <td className="monitor-ts">{entry.id}</td>
                    <td className={`slowlog-dur ${durClass(entry.durationMicros)}`}>
                      {formatDuration(entry.durationMicros)}
                    </td>
                    <td className="monitor-cmd">{entry.command?.join(' ')}</td>
                    <td className="monitor-ts">{formatTs(entry.timestamp)}</td>
                    <td className="monitor-client">{entry.clientAddr}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Warning modal ── */}
      {showWarning && (
        <div className="modal-overlay">
          <div className="modal-box">
            <p className="modal-message" style={{ marginBottom: 8 }}>
              <strong style={{ color: '#e3b341' }}>⚠ Production Warning</strong>
            </p>
            <p className="modal-message">
              <code style={{ color: '#f85149' }}>MONITOR</code> streams every Redis command in real time.
              On a busy server this can <strong>reduce throughput by up to 50%</strong>.
            </p>
            <p className="modal-message" style={{ marginTop: 8, color: '#8b949e', fontSize: 12 }}>
              {autoStop === 0 ? (
                <>Monitor will run <strong>indefinitely</strong> until you stop it manually. Keep an eye on server load.</>
              ) : (
                <>Monitor will auto-stop after <strong>{autoStop} seconds</strong>. Use only for short debugging sessions.</>
              )}
            </p>
            <div className="modal-actions" style={{ marginTop: 20 }}>
              <button
                className="btn-danger"
                onClick={() => { setShowWarning(false); startMonitor() }}
              >
                Start anyway
              </button>
              <button className="btn-secondary" onClick={() => setShowWarning(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
