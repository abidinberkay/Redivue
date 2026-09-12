import { useState, useEffect } from 'react'
import './KeyDiffView.css'
import type { Connection } from '../../types'
import { connBody } from '../../types'

const STORAGE_KEY = 'redivue_connections'

function loadConnections(): Connection[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

type DiffLineStatus = 'same' | 'left-only' | 'right-only' | 'placeholder'

interface DiffLine { text: string; status: DiffLineStatus }

interface KeyValueResult {
  key: string; type: string; value: unknown; ttl: number
  memoryBytes?: number | null; encoding?: string | null; elementCount?: number | null
}

interface DiffResult {
  left: KeyValueResult | null; right: KeyValueResult | null
  leftError: string | null; rightError: string | null
}

interface BatchCopyResult {
  succeeded: number; skipped: string[]; failed: { key: string; error: string }[]
}

function valueToText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}

function computeDiff(leftText: string, rightText: string): { left: DiffLine[]; right: DiffLine[] } {
  const L = leftText.split('\n'), R = rightText.split('\n')
  const m = L.length, n = R.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = L[i-1] === R[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1])

  const ops: Array<{ type: 'same' | 'left-only' | 'right-only'; l: string; r: string }> = []
  let i = m, j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && L[i-1] === R[j-1]) { ops.unshift({ type: 'same', l: L[i-1], r: R[j-1] }); i--; j-- }
    else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) { ops.unshift({ type: 'right-only', l: '', r: R[j-1] }); j-- }
    else { ops.unshift({ type: 'left-only', l: L[i-1], r: '' }); i-- }
  }

  const left: DiffLine[] = [], right: DiffLine[] = []
  for (const op of ops) {
    if (op.type === 'same') { left.push({ text: op.l, status: 'same' }); right.push({ text: op.r, status: 'same' }) }
    else if (op.type === 'left-only') { left.push({ text: op.l, status: 'left-only' }); right.push({ text: '', status: 'placeholder' }) }
    else { left.push({ text: '', status: 'placeholder' }); right.push({ text: op.r, status: 'right-only' }) }
  }
  return { left, right }
}

function formatTtl(ttl: number): string {
  if (ttl === -1) return 'no expiry'
  if (ttl === -2) return 'key missing'
  return `${ttl}s`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function KeyDiffView({ connection, onChangeDb, onLog }: {
  connection: Connection
  onChangeDb?: (connId: number, db: number) => void
  onLog?: (entry: { label: string; detail: string }) => void
}) {
  const allConnections = loadConnections()

  const [rightId, setRightId] = useState('')
  const [rightDb, setRightDb] = useState(0)
  const [key, setKey] = useState('')
  const [isSwapped, setIsSwapped] = useState(false)

  // Sync rightDb when the selected right connection changes
  useEffect(() => {
    const found = loadConnections().find(c => String(c.id) === rightId)
    setRightDb(found?.db ?? 0)
  }, [rightId])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<DiffResult | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [pendingSync, setPendingSync] = useState<'left-to-right' | 'right-to-left' | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [copied, setCopied] = useState(false)

  // Batch sync state
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchPattern, setBatchPattern] = useState('*')
  const [batchDirection, setBatchDirection] = useState<'left-to-right' | 'right-to-left'>('left-to-right')
  const [batchSrcDb, setBatchSrcDb] = useState(0)
  const [batchTgtDb, setBatchTgtDb] = useState(0)
  const [batchFoundKeys, setBatchFoundKeys] = useState<string[] | null>(null)
  const [batchScanning, setBatchScanning] = useState(false)
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchResult, setBatchResult] = useState<BatchCopyResult | null>(null)
  const [pendingBatch, setPendingBatch] = useState(false)

  const rightConn = allConnections.find((c: Connection) => String(c.id) === rightId) ?? null
  // effectiveLeft/Right carry the correct db value (local state overrides stored db)
  const effectiveLeft: Connection = isSwapped && rightConn
    ? { ...rightConn, db: rightDb }
    : { ...connection, db: connection.db ?? 0 }
  const effectiveRight: Connection | null = isSwapped
    ? { ...connection, db: connection.db ?? 0 }
    : rightConn ? { ...rightConn, db: rightDb } : null

  const isSameConnSameDb = rightConn != null &&
    String(rightConn.id) === String(connection.id) &&
    rightDb === (connection.db ?? 0)

  const connName = (c: Connection) => c.name || `${c.host}:${c.port}`

  const saveRightDb = (db: number) => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      const conns = raw ? JSON.parse(raw) : []
      localStorage.setItem(STORAGE_KEY, JSON.stringify(conns.map((c: Connection) => String(c.id) === rightId ? { ...c, db } : c)))
    } catch { /* ignore */ }
  }

  const handleLeftDbChange = (db: number) => {
    setResult(null)
    if (!isSwapped) onChangeDb?.(connection.id, db)
    else { setRightDb(db); saveRightDb(db) }
  }

  const handleRightDbChange = (db: number) => {
    setResult(null)
    if (!isSwapped) { setRightDb(db); saveRightDb(db) }
    else onChangeDb?.(connection.id, db)
  }

  const handleCompare = async () => {
    if (!key.trim() || !effectiveRight) return
    setLoading(true); setError(''); setResult(null)
    try {
      const res = await fetch('/api/redis/diff', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: key.trim(),
          left: connBody(effectiveLeft),
          right: connBody(effectiveRight),
        }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error((d as { error?: string }).error || 'Comparison failed') }
      setResult(await res.json())
    } catch (e) { setError((e as Error).message) }
    finally { setLoading(false) }
  }

  const handleSwap = () => { setIsSwapped(s => !s); setResult(null); setBatchFoundKeys(null); setBatchResult(null) }

  const copyKeyToClipboard = async () => {
    if (!key.trim()) return
    await navigator.clipboard.writeText(key.trim())
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleSync = async (direction: 'left-to-right' | 'right-to-left') => {
    if (!effectiveRight || !key.trim()) return
    const source = direction === 'left-to-right' ? effectiveLeft : effectiveRight
    const target = direction === 'left-to-right' ? effectiveRight : effectiveLeft
    setPendingSync(null); setSyncing(true); setError('')
    try {
      const res = await fetch(`/api/redis/${source.id}/key/copy-to`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...connBody(source),
          key: key.trim(),
          targetHost: target.host, targetPort: target.port, targetPassword: target.password, targetDb: target.db ?? 0,
          targetAuthType: target.authType ?? 'PASSWORD',
          targetUsername: target.username ?? null,
          targetUrl: target.url ?? null,
          replace: true,
        }),
      })
      if (!res.ok) throw new Error('Sync failed')
      onLog?.({ label: 'Key copied', detail: `"${key.trim()}" → ${connName(target)} DB ${target.db ?? 0}` })
      await handleCompare()
    } catch (e) { setError((e as Error).message) }
    finally { setSyncing(false) }
  }

  const batchSrcConn = batchDirection === 'left-to-right' ? effectiveLeft : effectiveRight
  const batchTgtConn = batchDirection === 'left-to-right' ? effectiveRight : effectiveLeft

  const openBatch = () => {
    setBatchSrcDb((batchDirection === 'left-to-right' ? effectiveLeft : effectiveRight)?.db ?? 0)
    setBatchTgtDb((batchDirection === 'left-to-right' ? effectiveRight : effectiveLeft)?.db ?? 0)
    setBatchOpen(o => !o)
    setBatchFoundKeys(null)
    setBatchResult(null)
  }

  const changeBatchDir = (dir: 'left-to-right' | 'right-to-left') => {
    setBatchDirection(dir)
    setBatchFoundKeys(null)
    setBatchResult(null)
    setBatchSrcDb((dir === 'left-to-right' ? effectiveLeft : effectiveRight)?.db ?? 0)
    setBatchTgtDb((dir === 'left-to-right' ? effectiveRight : effectiveLeft)?.db ?? 0)
  }

  const handleBatchScan = async () => {
    if (!batchSrcConn) return
    setBatchScanning(true); setBatchFoundKeys(null); setBatchResult(null); setError('')
    try {
      const res = await fetch(`/api/redis/${batchSrcConn.id}/keys/scan-all`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...connBody({ ...batchSrcConn, db: batchSrcDb }), pattern: batchPattern || '*' }),
      })
      if (!res.ok) throw new Error('Scan failed')
      const data = await res.json()
      setBatchFoundKeys(data.keys?.map((k: { key: string }) => k.key) ?? [])
    } catch (e) { setError((e as Error).message) }
    finally { setBatchScanning(false) }
  }

  const handleBatchCopy = async () => {
    if (!batchFoundKeys?.length || !batchSrcConn || !batchTgtConn) return
    setPendingBatch(false); setBatchRunning(true); setBatchResult(null); setError('')
    try {
      const res = await fetch(`/api/redis/${batchSrcConn.id}/keys/copy-batch`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...connBody({ ...batchSrcConn, db: batchSrcDb }),
          keys: batchFoundKeys,
          targetHost: batchTgtConn.host, targetPort: batchTgtConn.port, targetPassword: batchTgtConn.password, targetDb: batchTgtDb,
          targetAuthType: batchTgtConn.authType ?? 'PASSWORD',
          targetUsername: batchTgtConn.username ?? null,
          targetUrl: batchTgtConn.url ?? null,
          replace: true,
        }),
      })
      if (!res.ok) throw new Error('Batch copy failed')
      const data = await res.json()
      const succeeded = (data.succeeded ?? []).length
      const failed = (data.failed ?? []).length
      setBatchResult({ succeeded, skipped: data.skipped ?? [], failed: data.failed ?? [] })
      if (failed === 0) {
        onLog?.({ label: 'Batch copy', detail: `${succeeded} key${succeeded !== 1 ? 's' : ''} → ${connName(batchTgtConn!)} DB ${batchTgtDb}` })
      } else {
        onLog?.({ label: 'Batch copy (partial)', detail: `${succeeded} ok, ${failed} failed → ${connName(batchTgtConn!)} DB ${batchTgtDb}` })
      }
    } catch (e) { setError((e as Error).message) }
    finally { setBatchRunning(false) }
  }

  const exportAsJSON = () => {
    if (!result) return
    const data = {
      key,
      exportedAt: new Date().toISOString(),
      left: { connection: connName(effectiveLeft), db: effectiveLeft.db ?? 0, value: result.left?.value ?? null, ttl: result.left?.ttl, encoding: result.left?.encoding, memoryBytes: result.left?.memoryBytes },
      right: { connection: effectiveRight ? connName(effectiveRight) : '', db: effectiveRight?.db ?? 0, value: result.right?.value ?? null, ttl: result.right?.ttl, encoding: result.right?.encoding, memoryBytes: result.right?.memoryBytes },
    }
    download(`diff-${key}-${Date.now()}.json`, JSON.stringify(data, null, 2), 'application/json')
  }

  const exportAsText = () => {
    if (!result) return
    const lines: string[] = [
      `--- ${connName(effectiveLeft)} (DB ${effectiveLeft.db ?? 0})`,
      `+++ ${effectiveRight ? connName(effectiveRight) : ''} (DB ${effectiveRight?.db ?? 0})`,
      `@@ key: ${key} @@`,
    ]
    if (diff) {
      for (let idx = 0; idx < diff.left.length; idx++) {
        const l = diff.left[idx], r = diff.right[idx]
        if (l.status === 'left-only') lines.push(`-${l.text}`)
        else if (r.status === 'right-only') lines.push(`+${r.text}`)
        else if (l.status === 'same') lines.push(` ${l.text}`)
      }
    } else {
      lines.push(leftText, '---', rightText)
    }
    download(`diff-${key}-${Date.now()}.txt`, lines.join('\n'), 'text/plain')
  }

  function download(filename: string, content: string, mime: string) {
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  }

  const leftText = result?.leftError ? '' : result?.left ? valueToText(result.left.value) : ''
  const rightText = result?.rightError ? '' : result?.right ? valueToText(result.right.value) : ''
  const canDiff = result && !result.leftError && !result.rightError
  const diff = canDiff ? computeDiff(leftText, rightText) : null
  const identical = canDiff && leftText === rightText

  const diffStats = diff ? {
    added: diff.right.filter(l => l.status === 'right-only').length,
    removed: diff.left.filter(l => l.status === 'left-only').length,
    same: diff.left.filter(l => l.status === 'same').length,
  } : null
  const similarity = diffStats
    ? Math.round((2 * diffStats.same) / Math.max(1,
        diff!.left.filter(l => l.status !== 'placeholder').length +
        diff!.right.filter(l => l.status !== 'placeholder').length
      ) * 100)
    : null

  const canSyncLeftToRight = result && result.left && !result.leftError && (result.rightError || !identical)
  const canSyncRightToLeft = result && result.right && !result.rightError && (result.leftError || !identical)

  const matchSearch = (text: string) => searchTerm.trim() && text.toLowerCase().includes(searchTerm.toLowerCase())

  const renderMeta = (kv: KeyValueResult) => {
    const parts: string[] = [`TTL: ${formatTtl(kv.ttl)}`]
    if (kv.encoding) parts.push(kv.encoding)
    if (kv.elementCount != null) parts.push(`${kv.elementCount} items`)
    if (kv.memoryBytes != null) parts.push(formatBytes(kv.memoryBytes))
    return parts.join(' · ')
  }

  const renderLines = (lines: DiffLine[]) => (
    <pre className="keydiff-pre">
      {lines.map((line, i) => (
        <div key={i} className={`keydiff-line keydiff-line-${line.status}${matchSearch(line.text) ? ' keydiff-line-match' : ''}`}>
          {line.text || ' '}
        </div>
      ))}
    </pre>
  )

  return (
    <div className="keydiff-view">
      <div className="keydiff-header">
        <h3 className="keydiff-title">Key Diff</h3>
        <p className="keydiff-subtitle">Compare and sync keys across connections.</p>
      </div>

      {/* Connection selector row */}
      <div className="keydiff-controls">
        <div className="keydiff-connections">
          <div className="keydiff-conn keydiff-conn-left">
            <div className="keydiff-conn-label">Left</div>
            <div className="keydiff-conn-name">{connName(effectiveLeft)}</div>
            <select
              className="keydiff-db-select"
              value={effectiveLeft.db ?? 0}
              onChange={e => handleLeftDbChange(Number(e.target.value))}
            >
              {Array.from({ length: 16 }, (_, i) => (
                <option key={i} value={i}>DB {i}</option>
              ))}
            </select>
          </div>

          <button
            className="keydiff-swap-btn"
            onClick={handleSwap}
            title="Swap left and right connections"
            disabled={!rightId}
          >⇄</button>

          <div className="keydiff-conn keydiff-conn-right">
            <div className="keydiff-conn-label">Right</div>
            {allConnections.length === 0 ? (
              <div className="keydiff-no-conn">No connections available.</div>
            ) : (
              <select
                className="keydiff-select"
                value={rightId}
                onChange={e => { setRightId(e.target.value); setResult(null); setIsSwapped(false); setBatchFoundKeys(null) }}
              >
                <option value="">— Select connection —</option>
                {allConnections.map((c: Connection) => (
                  <option key={c.id} value={String(c.id)}>
                    {connName(c)}{String(c.id) === String(connection.id) ? ' (this)' : ''}
                  </option>
                ))}
              </select>
            )}
            {rightId && (
              <select
                className="keydiff-db-select"
                value={effectiveRight?.db ?? 0}
                onChange={e => handleRightDbChange(Number(e.target.value))}
              >
                {Array.from({ length: 16 }, (_, i) => (
                  <option key={i} value={i}>DB {i}</option>
                ))}
              </select>
            )}
          </div>
        </div>

        {isSameConnSameDb && (
          <p style={{ color: '#f0883e', fontSize: '0.85em', margin: '0 0 8px' }}>
            Left and right are the same connection and database — select a different database.
          </p>
        )}

        {/* Key input row */}
        <div className="keydiff-key-row">
          <div className="keydiff-key-input-wrap">
            <input
              className="keydiff-key-input"
              type="text"
              placeholder="Key name (e.g. user:42)"
              value={key}
              onChange={e => { setKey(e.target.value); setResult(null) }}
              onKeyDown={e => e.key === 'Enter' && handleCompare()}
              disabled={loading}
            />
            <button
              className={`keydiff-clipboard-btn${copied ? ' keydiff-clipboard-btn-ok' : ''}`}
              onClick={copyKeyToClipboard}
              disabled={!key.trim()}
              title="Copy key name to clipboard"
            >{copied ? '✓' : '⎘'}</button>
          </div>
          <button
            className="keydiff-btn keydiff-btn-primary"
            onClick={handleCompare}
            disabled={loading || !key.trim() || !rightId || isSameConnSameDb}
          >{loading ? 'Comparing...' : 'Compare'}</button>
        </div>
      </div>

      {error && <div className="keydiff-error">{error}</div>}

      {result && (
        <div className="keydiff-result">
          {/* Meta bar */}
          <div className="keydiff-result-meta">
            <span className={`keydiff-badge ${identical ? 'keydiff-badge-same' : 'keydiff-badge-diff'}`}>
              {identical ? 'Identical' : 'Values differ'}
            </span>

            {result.left && result.right && result.left.type !== result.right.type && (
              <span className="keydiff-meta-detail keydiff-type-mismatch">Type: {result.left.type} vs {result.right.type}</span>
            )}
            {result.left && result.right && result.left.type === result.right.type && (
              <span className="keydiff-meta-detail">Type: {result.left.type}</span>
            )}

            {diffStats && !identical && (
              <span className="keydiff-stats">
                {diffStats.removed > 0 && <span className="keydiff-stat-rem">−{diffStats.removed}</span>}
                {diffStats.added > 0 && <span className="keydiff-stat-add">+{diffStats.added}</span>}
                {similarity != null && <span className="keydiff-stat-sim">{similarity}% similar</span>}
              </span>
            )}

            <div className="keydiff-meta-actions">
              {result && (
                <div className="keydiff-export-group">
                  <button className="keydiff-btn keydiff-btn-export" onClick={exportAsJSON} title="Export as JSON">JSON</button>
                  <button className="keydiff-btn keydiff-btn-export" onClick={exportAsText} title="Export as unified diff text">Text diff</button>
                </div>
              )}
              {(canSyncLeftToRight || canSyncRightToLeft) && (
                <div className="keydiff-sync-actions">
                  {canSyncLeftToRight && (
                    <button className="keydiff-btn keydiff-btn-sync" onClick={() => setPendingSync('left-to-right')} disabled={syncing}>
                      {syncing ? '...' : 'Copy left → right'}
                    </button>
                  )}
                  {canSyncRightToLeft && (
                    <button className="keydiff-btn keydiff-btn-sync" onClick={() => setPendingSync('right-to-left')} disabled={syncing}>
                      {syncing ? '...' : 'Copy right → left'}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Search bar */}
          <div className="keydiff-search-bar">
            <input
              className="keydiff-search-input"
              type="text"
              placeholder="Search in values…"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <button className="keydiff-search-clear" onClick={() => setSearchTerm('')}>×</button>
            )}
          </div>

          {/* Side-by-side panels */}
          <div className="keydiff-panels">
            <div className="keydiff-panel">
              <div className="keydiff-panel-header">
                <span className="keydiff-panel-name">{connName(effectiveLeft)}</span>
                {result.left && <span className="keydiff-panel-meta">{renderMeta(result.left)}</span>}
              </div>
              <div className="keydiff-panel-body">
                {result.leftError
                  ? <div className="keydiff-missing">{result.leftError}</div>
                  : diff ? renderLines(diff.left)
                  : <pre className="keydiff-pre">{leftText || <span className="keydiff-empty">(empty)</span>}</pre>
                }
              </div>
            </div>

            <div className="keydiff-panel">
              <div className="keydiff-panel-header">
                <span className="keydiff-panel-name">{effectiveRight ? connName(effectiveRight) : ''}</span>
                {result.right && <span className="keydiff-panel-meta">{renderMeta(result.right)}</span>}
              </div>
              <div className="keydiff-panel-body">
                {result.rightError
                  ? <div className="keydiff-missing">{result.rightError}</div>
                  : diff ? renderLines(diff.right)
                  : <pre className="keydiff-pre">{rightText || <span className="keydiff-empty">(empty)</span>}</pre>
                }
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Batch sync section */}
      {rightId && (
        <div className="keydiff-batch">
          <button className="keydiff-batch-toggle" onClick={openBatch}>
            <span className="keydiff-batch-arrow">{batchOpen ? '▾' : '▸'}</span> Batch Copy
            <span className="keydiff-batch-hint">Copy multiple keys matching a pattern</span>
          </button>

          {batchOpen && effectiveRight && (
            <div className="keydiff-batch-body">
              <div className="keydiff-batch-dir-row">
                <label className="keydiff-batch-dir-label">Direction</label>
                <div className="keydiff-batch-dir-options">
                  <label className="keydiff-batch-radio">
                    <input type="radio" value="left-to-right" checked={batchDirection === 'left-to-right'}
                      onChange={() => changeBatchDir('left-to-right')} />
                    {connName(effectiveLeft)} → {connName(effectiveRight)}
                  </label>
                  <label className="keydiff-batch-radio">
                    <input type="radio" value="right-to-left" checked={batchDirection === 'right-to-left'}
                      onChange={() => changeBatchDir('right-to-left')} />
                    {connName(effectiveRight)} → {connName(effectiveLeft)}
                  </label>
                </div>
              </div>

              <div className="keydiff-batch-db-row">
                <span className="keydiff-batch-db-label">Source DB</span>
                <select className="keydiff-db-select" value={batchSrcDb}
                  onChange={e => { setBatchSrcDb(Number(e.target.value)); setBatchFoundKeys(null); setBatchResult(null) }}>
                  {Array.from({ length: 16 }, (_, i) => <option key={i} value={i}>DB {i}</option>)}
                </select>
                <span className="keydiff-batch-db-arrow">→</span>
                <span className="keydiff-batch-db-label">Target DB</span>
                <select className="keydiff-db-select" value={batchTgtDb}
                  onChange={e => { setBatchTgtDb(Number(e.target.value)); setBatchResult(null) }}>
                  {Array.from({ length: 16 }, (_, i) => <option key={i} value={i}>DB {i}</option>)}
                </select>
              </div>

              <div className="keydiff-batch-scan-row">
                <input
                  className="keydiff-key-input"
                  type="text"
                  placeholder="Pattern (e.g. user:* or *)"
                  value={batchPattern}
                  onChange={e => { setBatchPattern(e.target.value); setBatchFoundKeys(null); setBatchResult(null) }}
                  onKeyDown={e => e.key === 'Enter' && handleBatchScan()}
                />
                <button
                  className="keydiff-btn keydiff-btn-secondary"
                  onClick={handleBatchScan}
                  disabled={batchScanning || batchRunning}
                >{batchScanning ? 'Scanning...' : 'Find Keys'}</button>
              </div>

              {batchFoundKeys !== null && (
                <div className="keydiff-batch-found">
                  {batchFoundKeys.length === 0
                    ? <span className="keydiff-batch-found-zero">No keys match this pattern.</span>
                    : <>
                        <span className="keydiff-batch-found-count">{batchFoundKeys.length} key{batchFoundKeys.length !== 1 ? 's' : ''} found</span>
                        <ul className="keydiff-batch-key-list">
                          {batchFoundKeys.slice(0, 6).map(k => <li key={k}>{k}</li>)}
                          {batchFoundKeys.length > 6 && <li className="keydiff-batch-more">...and {batchFoundKeys.length - 6} more</li>}
                        </ul>
                        {!pendingBatch ? (
                          <button
                            className="keydiff-btn keydiff-btn-sync"
                            onClick={() => setPendingBatch(true)}
                            disabled={batchRunning}
                          >Copy {batchFoundKeys.length} key{batchFoundKeys.length !== 1 ? 's' : ''} →</button>
                        ) : (
                          <div className="keydiff-batch-confirm">
                            <span>Copy <strong>{batchFoundKeys.length}</strong> keys from <strong>{connName(batchSrcConn!)} DB {batchSrcDb}</strong> to <strong>{connName(batchTgtConn!)} DB {batchTgtDb}</strong>? Existing keys will be overwritten.</span>
                            <button className="keydiff-btn keydiff-btn-confirm-ok" onClick={handleBatchCopy} disabled={batchRunning}>
                              {batchRunning ? 'Copying...' : 'Yes, copy all'}
                            </button>
                            <button className="keydiff-btn keydiff-btn-confirm-cancel" onClick={() => setPendingBatch(false)}>Cancel</button>
                          </div>
                        )}
                      </>
                  }
                </div>
              )}

              {batchResult && (
                <div className={`keydiff-batch-result ${batchResult.failed.length === 0 ? 'keydiff-batch-result-ok' : 'keydiff-batch-result-partial'}`}>
                  {batchResult.failed.length === 0
                    ? `✓ ${batchResult.succeeded} key${batchResult.succeeded !== 1 ? 's' : ''} copied successfully${batchResult.skipped.length > 0 ? ` · ${batchResult.skipped.length} skipped` : ''}`
                    : `✓ ${batchResult.succeeded} succeeded · ✗ ${batchResult.failed.length} failed`
                  }
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Single key copy confirm overlay */}
      {pendingSync && effectiveRight && (() => {
        const src = pendingSync === 'left-to-right' ? effectiveLeft : effectiveRight
        const tgt = pendingSync === 'left-to-right' ? effectiveRight : effectiveLeft
        return (
          <div className="keydiff-confirm-overlay">
            <div className="keydiff-confirm-box">
              <div className="keydiff-confirm-title">Confirm Copy</div>
              <div className="keydiff-confirm-body">
                <p>This will overwrite the key in the target connection:</p>
                <div className="keydiff-confirm-detail">
                  <div className="keydiff-confirm-row">
                    <span className="keydiff-confirm-label">Key</span>
                    <code className="keydiff-confirm-value">{key}</code>
                  </div>
                  <div className="keydiff-confirm-row">
                    <span className="keydiff-confirm-label">From</span>
                    <span className="keydiff-confirm-value">{connName(src)} <span className="keydiff-confirm-db">DB {src.db ?? 0}</span></span>
                  </div>
                  <div className="keydiff-confirm-row">
                    <span className="keydiff-confirm-label">To</span>
                    <span className="keydiff-confirm-value keydiff-confirm-target">{connName(tgt)} <span className="keydiff-confirm-db">DB {tgt.db ?? 0}</span></span>
                  </div>
                </div>
                <p className="keydiff-confirm-warn">Existing value in the target will be replaced.</p>
              </div>
              <div className="keydiff-confirm-actions">
                <button className="keydiff-btn keydiff-btn-confirm-ok" onClick={() => handleSync(pendingSync)}>Yes, copy</button>
                <button className="keydiff-btn keydiff-btn-confirm-cancel" onClick={() => setPendingSync(null)}>Cancel</button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
