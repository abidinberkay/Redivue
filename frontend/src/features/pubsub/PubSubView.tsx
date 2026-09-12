import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import './PubSubView.css'
import { connBody as buildConnBody, registerSession } from '../../types'

const AUTO_STOP_OPTIONS = [60, 300, 600, 1800]
const MAX_RECONNECTS = 5
const RECONNECT_DELAY_MS = 2000

function tryParseJson(str) {
  try { return JSON.parse(str) } catch { return null }
}

function fmtAutoStop(s) {
  if (s < 60) return `${s}s`
  if (s < 3600) return `${s / 60}m`
  return `${s / 3600}h`
}

function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString('en-US', { hour12: false, fractionalSecondDigits: 3 })
}

function renderHighlightedJson(jsonStr) {
  const parts = []
  let keyIndex = 0
  const regex = /("(?:\\.|[^"\\])*")|(\btrue\b|\bfalse\b|\bnull\b)|(\d+\.?\d*)|([{}[\]:,])/g
  let match
  let lastIndex = 0

  while ((match = regex.exec(jsonStr)) !== null) {
    if (match.index > lastIndex) {
      parts.push(jsonStr.slice(lastIndex, match.index))
    }

    if (match[1]) {
      const nextChar = jsonStr[match.index + match[1].length]
      const isKey = nextChar === ':'
      parts.push(<span key={`${isKey ? 'k' : 's'}-${keyIndex++}`} className={isKey ? 'json-key' : 'json-string'}>{match[1]}</span>)
    } else if (match[2]) {
      parts.push(<span key={`b-${keyIndex++}`} className="json-boolean">{match[2]}</span>)
    } else if (match[3]) {
      parts.push(<span key={`n-${keyIndex++}`} className="json-number">{match[3]}</span>)
    } else if (match[4]) {
      parts.push(<span key={`d-${keyIndex++}`} className="json-delimiter">{match[4]}</span>)
    }

    lastIndex = regex.lastIndex
  }

  if (lastIndex < jsonStr.length) {
    parts.push(jsonStr.slice(lastIndex))
  }

  return parts
}

export default function PubSubView({ connection, onLog }) {
  // subscribe state
  const [subscribed, setSubscribed] = useState(false)
  const [channelsInput, setChannelsInput] = useState('')
  const [patternsInput, setPatternsInput] = useState('')
  const [messages, setMessages] = useState([])
  const [filter, setFilter] = useState('')
  const [prettyJson, setPrettyJson] = useState(true)
  const [stickyBottom, setStickyBottom] = useState(false)
  const [msgRate, setMsgRate] = useState(0)
  const [autoStop, setAutoStop] = useState(300)
  const [timeLeft, setTimeLeft] = useState(0)
  const [subError, setSubError] = useState('')
  const [reconnectMsg, setReconnectMsg] = useState('')
  const [activeSubs, setActiveSubs] = useState([])

  // discovery state
  const [discoverPattern, setDiscoverPattern] = useState('')
  const [discoverResults, setDiscoverResults] = useState(null)
  const [discovering, setDiscovering] = useState(false)
  const [discoverError, setDiscoverError] = useState('')

  // publish state
  const [pubChannel, setPubChannel] = useState('')
  const [pubMessage, setPubMessage] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [pubResult, setPubResult] = useState(null)
  const [pubError, setPubError] = useState('')
  const [publishHistory, setPublishHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem('pubsub-publish-history') || '[]') } catch { return [] }
  })

  const esRef = useRef(null)
  const timerRef = useRef(null)
  const msgCountRef = useRef(0)
  const reconnectCountRef = useRef(0)
  const reconnectTimerRef = useRef(null)
  const activeRef = useRef(false)
  const streamRef = useRef(null)

  const connBody = buildConnBody(connection)

  const stopSubscribe = useCallback((capturedCount?: number | null) => {
    if (esRef.current) { esRef.current.close(); esRef.current = null }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null }
    reconnectCountRef.current = 0
    activeRef.current = false
    setReconnectMsg('')
    setSubscribed(false)
    setTimeLeft(0)
    if (capturedCount != null) {
      onLog?.({ label: 'Pub/Sub unsubscribed', detail: `${capturedCount} messages received` })
    }
  }, [onLog])

  useEffect(() => () => stopSubscribe(), [stopSubscribe])

  // recalculate msg/s every second using a 5-second sliding window
  useEffect(() => {
    if (!subscribed) { setMsgRate(0); return }
    const id = setInterval(() => {
      const cutoff = Date.now() - 5000
      setMessages(prev => {
        const recent = prev.filter(m => m.ts >= cutoff).length
        setMsgRate(+(recent / 5).toFixed(1))
        return prev
      })
    }, 1000)
    return () => clearInterval(id)
  }, [subscribed])

  const channelStats = useMemo(() => {
    const map: Record<string, number> = {}
    for (const m of messages) {
      const key = m.channel || '(unknown)'
      map[key] = (map[key] || 0) + 1
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1])
  }, [messages])

  useEffect(() => {
    if (stickyBottom && streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight
    }
  }, [messages, stickyBottom])

  const discoverChannels = async () => {
    setDiscovering(true)
    setDiscoverError('')
    try {
      const sessionToken = await registerSession(connection.id, connection)
      const params = new URLSearchParams({
        sessionToken,
        ...(discoverPattern.trim() ? { pattern: discoverPattern.trim() } : {}),
      })
      const res = await fetch(`/api/redis/${connection.id}/pubsub/channels?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Discovery failed')
      setDiscoverResults(data)
    } catch (e) {
      setDiscoverError(e.message)
    } finally {
      setDiscovering(false)
    }
  }

  const addDiscoveredChannel = (ch) => {
    setChannelsInput(prev => {
      const existing = prev.split(',').map(s => s.trim()).filter(Boolean)
      if (existing.includes(ch)) return prev
      return existing.length ? `${prev}, ${ch}` : ch
    })
  }

  const startSubscribe = async () => {
    const channels = channelsInput.split(',').map(s => s.trim()).filter(Boolean)
    const patterns = patternsInput.split(',').map(s => s.trim()).filter(Boolean)
    if (channels.length === 0 && patterns.length === 0) {
      setSubError('Enter at least one channel or pattern')
      return
    }
    setSubError('')
    setReconnectMsg('')
    setMessages([])
    msgCountRef.current = 0
    activeRef.current = true
    setActiveSubs([...channels, ...patterns.map(p => `${p} (pattern)`)])
    setSubscribed(true)
    setTimeLeft(autoStop)
    onLog?.({ label: 'Pub/Sub subscribed', detail: [...channels, ...patterns].join(', ') })

    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) { clearInterval(timerRef.current); return 0 }
        return prev - 1
      })
    }, 1000)

    let sessionToken: string
    try {
      sessionToken = await registerSession(connection.id, connection)
    } catch {
      setSubError('Failed to register session — cannot start stream')
      stopSubscribe(0)
      return
    }

    const params = new URLSearchParams({
      sessionToken,
      timeout: String(autoStop),
      ...(channels.length ? { channels: channels.join(',') } : {}),
      ...(patterns.length ? { patterns: patterns.join(',') } : {}),
    })

    const doConnect = (urlParams) => {
      if (!activeRef.current) return
      if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null }

      const es = new EventSource(`/api/redis/${connection.id}/pubsub/stream?${urlParams}`)
      esRef.current = es

      es.addEventListener('started', () => {
        reconnectCountRef.current = 0
        setReconnectMsg('')
      })

      es.addEventListener('message', e => {
        try {
          const msg = JSON.parse(e.data)
          setMessages(prev => {
            const next = [msg, ...prev].slice(0, 1000)
            msgCountRef.current = next.length
            return next
          })
        } catch { /* ignore malformed */ }
      })

      es.addEventListener('timeout', e => {
        setSubError(`Auto-stopped after ${e.data}s`)
        stopSubscribe(msgCountRef.current)
      })

      es.addEventListener('pubsub-error', e => {
        setSubError(e.data || 'Subscribe error')
        stopSubscribe(msgCountRef.current)
      })

      es.onerror = () => {
        if (!esRef.current) return
        esRef.current.close()
        esRef.current = null

        reconnectCountRef.current += 1
        if (reconnectCountRef.current > MAX_RECONNECTS) {
          setReconnectMsg('')
          setSubError(`Connection lost — could not reconnect after ${MAX_RECONNECTS} attempts.`)
          stopSubscribe(msgCountRef.current)
          return
        }

        const attempt = reconnectCountRef.current
        setReconnectMsg(`Connection lost — reconnecting (${attempt}/${MAX_RECONNECTS})...`)
        reconnectTimerRef.current = setTimeout(() => doConnect(urlParams), RECONNECT_DELAY_MS)
      }
    }

    doConnect(params)
  }

  const handlePublish = async () => {
    if (!pubChannel.trim()) { setPubError('Channel is required'); return }
    setPublishing(true)
    setPubError('')
    setPubResult(null)
    try {
      const res = await fetch(`/api/redis/${connection.id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...connBody, channel: pubChannel.trim(), message: pubMessage }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Publish failed')
      setPubResult(data.received)
      onLog?.({ label: 'Message published', detail: `${pubChannel.trim()} → ${data.received} subscriber(s)` })
      setPublishHistory(prev => {
        const entry = { channel: pubChannel.trim(), message: pubMessage }
        const filtered = prev.filter(h => !(h.channel === entry.channel && h.message === entry.message))
        const next = [entry, ...filtered].slice(0, 20)
        localStorage.setItem('pubsub-publish-history', JSON.stringify(next))
        return next
      })
    } catch (e) {
      setPubError(e.message)
    } finally {
      setPublishing(false)
    }
  }

  const filteredMessages = messages.filter(m =>
    !filter ||
    (m.channel || '').toLowerCase().includes(filter.toLowerCase()) ||
    (m.message || '').toLowerCase().includes(filter.toLowerCase())
  )

  const displayMessages = stickyBottom ? [...filteredMessages].reverse() : filteredMessages

  const exportMessages = () => {
    const header = 'Time\tChannel\tPattern\tMessage\n'
    const lines = filteredMessages.map(m =>
      `${fmtTime(m.ts)}\t${m.channel}\t${m.pattern || ''}\t${m.message}`
    ).join('\n')
    const blob = new Blob([header + lines], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `pubsub-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="pubsub-view">

      {/* ── SUBSCRIBE section ── */}
      <div className="pubsub-section">
        <div className="pubsub-section-header">
          <div className="pubsub-title-row">
            <h3 className="pubsub-section-title">SUBSCRIBE</h3>
            {!subscribed && (
              <div className="pubsub-stop-options">
                <span className="pubsub-label">Auto-stop after</span>
                {AUTO_STOP_OPTIONS.map(s => (
                  <button
                    key={s}
                    className={`stop-option-btn ${autoStop === s ? 'active' : ''}`}
                    onClick={() => setAutoStop(s)}
                  >
                    {fmtAutoStop(s)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── CHANNEL DISCOVERY ── */}
        {!subscribed && (
          <div className="pubsub-discover">
            <div className="pubsub-discover-bar">
              <span className="pubsub-discover-label">Discover active channels</span>
              <input
                className="pubsub-discover-input"
                placeholder="Pattern (default: *)"
                value={discoverPattern}
                onChange={e => setDiscoverPattern(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && discoverChannels()}
                spellCheck={false}
              />
              <button
                className="pubsub-discover-btn"
                onClick={discoverChannels}
                disabled={discovering}
              >
                {discovering ? 'Scanning...' : 'Scan'}
              </button>
              {discoverResults !== null && (
                <button
                  className="pubsub-discover-clear"
                  onClick={() => setDiscoverResults(null)}
                >✕</button>
              )}
            </div>
            {discoverError && <div className="pubsub-error-bar">{discoverError}</div>}
            {discoverResults !== null && (
              discoverResults.length === 0
                ? <div className="pubsub-discover-empty">No active channels found</div>
                : <div className="pubsub-discover-results">
                    {discoverResults.map(({ channel, subscribers }) => (
                      <button
                        key={channel}
                        className="pubsub-discover-row"
                        onClick={() => addDiscoveredChannel(channel)}
                        title="Click to add to Channels input"
                      >
                        <span className="pubsub-discover-ch">{channel}</span>
                        <span className="pubsub-discover-sub">{subscribers} sub{subscribers !== 1 ? 's' : ''}</span>
                      </button>
                    ))}
                  </div>
            )}
          </div>
        )}

        {!subscribed ? (
          <div className="pubsub-sub-form">
            <div className="pubsub-field">
              <label className="pubsub-field-label">Channels <span className="pubsub-hint">(SUBSCRIBE — exact names, comma-separated)</span></label>
              <input
                className="pubsub-input"
                placeholder="e.g. news, alerts, user:123:events"
                value={channelsInput}
                onChange={e => setChannelsInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && startSubscribe()}
                spellCheck={false}
              />
            </div>
            <div className="pubsub-field">
              <label className="pubsub-field-label">Patterns <span className="pubsub-hint">(PSUBSCRIBE — glob patterns, comma-separated)</span></label>
              <input
                className="pubsub-input"
                placeholder="e.g. news.*, user:*:events, __keyspace@0__:*"
                value={patternsInput}
                onChange={e => setPatternsInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && startSubscribe()}
                spellCheck={false}
              />
            </div>
            <button className="pubsub-start-btn" onClick={startSubscribe}>Subscribe</button>
          </div>
        ) : (
          <div className="pubsub-active-bar">
            <span className="pubsub-active-label">Listening on:</span>
            {activeSubs.map((s, i) => <span key={i} className="pubsub-chip">{s}</span>)}
            <span className={`pubsub-countdown ${timeLeft <= 10 ? 'danger' : ''}`}>{timeLeft}s left</span>
            <button className="pubsub-stop-btn" onClick={() => stopSubscribe(msgCountRef.current)}>Unsubscribe</button>
          </div>
        )}

        {reconnectMsg && <div className="pubsub-reconnect-bar">{reconnectMsg}</div>}
        {subError && <div className="pubsub-error-bar">{subError}</div>}

        {(subscribed || messages.length > 0) && (
          <div className="pubsub-stream-controls">
            <input
              className="pubsub-filter-input"
              placeholder="Filter messages..."
              value={filter}
              onChange={e => setFilter(e.target.value)}
            />
            {messages.length > 0 && (
              <>
                <button
                  className={`pubsub-pretty-btn ${prettyJson ? 'active' : ''}`}
                  onClick={() => setPrettyJson(v => !v)}
                  title="Toggle JSON pretty-print"
                >
                  {'JSON Beautify'}
                </button>
                <button
                  className={`pubsub-pretty-btn ${stickyBottom ? 'active' : ''}`}
                  onClick={() => setStickyBottom(v => !v)}
                  title={stickyBottom ? 'Auto-scroll on — newest messages at bottom' : 'Auto-scroll off — newest messages at top'}
                >
                  {stickyBottom ? '↓ Oldest First' : '↑ Newest first'}
                </button>
                <span className="pubsub-count">{filteredMessages.length} of {messages.length}</span>
                <button className="pubsub-export-btn" onClick={exportMessages}>Export</button>
                <button className="pubsub-clear-btn" onClick={() => setMessages([])}>Clear</button>
              </>
            )}
          </div>
        )}

        {messages.length > 0 && (
          <div className="pubsub-stats-bar">
            <span
              className="pubsub-rate pubsub-tooltip"
              data-tooltip="Messages per second — calculated from a 5-second sliding window"
            >{msgRate}/s</span>
            {channelStats.map(([ch, count]) => (
              <span
                key={ch}
                className="pubsub-channel-stat pubsub-tooltip"
                data-tooltip={`${count} message${count !== 1 ? 's' : ''} received on "${ch}"`}
              >
                <span className="pubsub-channel-stat-name">{ch}</span>
                <span className="pubsub-channel-stat-count">{count}</span>
              </span>
            ))}
          </div>
        )}

        <div className="pubsub-stream" ref={streamRef}>
          {!subscribed && messages.length === 0 && (
            <div className="pubsub-idle">
              <p>Enter channels or patterns and click <strong>Subscribe</strong> to listen for messages in real time.</p>
              <p className="pubsub-idle-sub">Unlike MONITOR, subscribing does not impact Redis performance.</p>
            </div>
          )}
          {subscribed && messages.length === 0 && (
            <div className="pubsub-waiting">Waiting for messages...</div>
          )}
          {messages.length > 0 && (
            <table className="pubsub-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Channel</th>
                  <th>Pattern</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {displayMessages.map((m, i) => (
                  <tr key={i}>
                    <td className="pubsub-ts">{fmtTime(m.ts)}</td>
                    <td className="pubsub-channel">{m.channel}</td>
                    <td className="pubsub-pattern">{m.pattern || '—'}</td>
                    <td className="pubsub-msg">
                      {(() => {
                        if (!prettyJson) return m.message
                        const parsed = tryParseJson(m.message)
                        return parsed !== null
                          ? <pre className="pubsub-msg-json">{renderHighlightedJson(JSON.stringify(parsed, null, 2))}</pre>
                          : m.message
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── PUBLISH section ── */}
      <div className="pubsub-section">
        <div className="pubsub-section-header">
          <h3 className="pubsub-section-title">PUBLISH</h3>
          {publishHistory.length > 0 && (
            <button
              className="pubsub-clear-btn"
              onClick={() => { setPublishHistory([]); localStorage.removeItem('pubsub-publish-history') }}
            >Clear history</button>
          )}
        </div>

        <div className="pubsub-publish-form">
          <input
            className="pubsub-input pubsub-pub-channel"
            placeholder="Channel"
            value={pubChannel}
            onChange={e => setPubChannel(e.target.value)}
            spellCheck={false}
          />
          <input
            className="pubsub-input pubsub-pub-message"
            placeholder="Message"
            value={pubMessage}
            onChange={e => setPubMessage(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !publishing && handlePublish()}
            spellCheck={false}
          />
          <button className="pubsub-start-btn" onClick={handlePublish} disabled={publishing}>
            {publishing ? 'Publishing...' : 'Publish'}
          </button>
        </div>

        {pubError && <div className="pubsub-error-bar">{pubError}</div>}
        {pubResult != null && (
          <div className="pubsub-pub-result">
            Delivered to <strong>{pubResult}</strong> subscriber{pubResult !== 1 ? 's' : ''}
            {pubResult === 0 && <span className="pubsub-pub-zero"> — no one is listening on this channel</span>}
          </div>
        )}

        {publishHistory.length > 0 && (
          <div className="pubsub-history">
            <div className="pubsub-history-label">Recent</div>
            {publishHistory.map((h, i) => (
              <button
                key={i}
                className="pubsub-history-row"
                onClick={() => { setPubChannel(h.channel); setPubMessage(h.message); setPubResult(null) }}
              >
                <span className="pubsub-history-channel">{h.channel}</span>
                <span className="pubsub-history-msg">{h.message || <em>empty</em>}</span>
              </button>
            ))}
          </div>
        )}
      </div>

    </div>
  )
}
