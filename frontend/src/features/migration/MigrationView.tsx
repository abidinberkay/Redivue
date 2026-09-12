import { useState, useCallback, useEffect } from 'react'
import './MigrationView.css'
import { connBody as buildConnBody } from '../../types'

const STORAGE_KEY = 'redivue_connections'

function loadConnections() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function fmtBytes(bytes: number) {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export default function MigrationView({ connection, onLog, onRefreshHealth }) {
  const allConnections = loadConnections()

  const [mode, setMode] = useState<'ram' | 'disk' | 'import'>('ram')

  // --- shared state ---
  const [targetId, setTargetId] = useState('')
  const [targetDb, setTargetDb] = useState(0)
  const [pattern, setPattern] = useState('*')
  const [replace, setReplace] = useState(false)

  // --- RAM mode state ---
  const [foundKeys, setFoundKeys] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [migrating, setMigrating] = useState(false)
  const [ramResults, setRamResults] = useState(null)
  const [scanError, setScanError] = useState('')

  // --- Command Import state ---
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importParsed, setImportParsed] = useState<string[]>([])
  const [importing2, setImporting2] = useState(false)
  const [importResults, setImportResults] = useState<{ total: number; succeeded: number; failed: { command: string; error: string }[] } | null>(null)
  const [importError2, setImportError2] = useState('')

  // --- Disk mode state ---
  const [exporting, setExporting] = useState(false)
  const [exportInfo, setExportInfo] = useState<{ fileId: string; keyCount: number; fileSize: number; source: string; pattern: string } | null>(null)
  const [exportError, setExportError] = useState('')
  const [importing, setImporting] = useState(false)
  const [diskResults, setDiskResults] = useState(null)
  const [importError, setImportError] = useState('')
  const [exportList, setExportList] = useState<any[]>([])
  const [loadingExports, setLoadingExports] = useState(false)

  const connBody = buildConnBody(connection)
  const targetConn = allConnections.find(c => String(c.id) === targetId)
  const isSameConnAndDb = targetConn != null && String(targetConn.id) === String(connection.id) && targetDb === (connection.db ?? 0)
  const targetName = (c) => c.name || `${c.host}:${c.port}`

  const resetResults = () => {
    setRamResults(null)
    setDiskResults(null)
    setScanError('')
    setExportError('')
    setImportError('')
  }

  const switchMode = (m: 'ram' | 'disk' | 'import') => {
    setMode(m)
    setFoundKeys(null)
    setExportInfo(null)
    setImportFile(null)
    setImportParsed([])
    setImportResults(null)
    setImportError2('')
    resetResults()
    if (m === 'disk') loadExportList()
  }

  const handleImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null
    setImportFile(file)
    setImportParsed([])
    setImportResults(null)
    setImportError2('')
    if (!file) return
    const reader = new FileReader()
    reader.onload = evt => {
      const text = evt.target?.result as string
      const lines = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
      setImportParsed(lines)
    }
    reader.readAsText(file)
  }

  const handleRunImport = async () => {
    if (importParsed.length === 0) return
    setImporting2(true)
    setImportResults(null)
    setImportError2('')
    try {
      const res = await fetch(`/api/redis/${connection.id}/bulk/import-commands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...connBody, commands: importParsed }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Import failed')
      const data = await res.json()
      setImportResults(data)
      if (data.failed.length === 0) {
        onLog?.({ label: 'Command Import', detail: `${data.succeeded} commands executed successfully` })
      }
      onRefreshHealth?.(connection)
    } catch (e: any) {
      setImportError2(e.message)
    } finally {
      setImporting2(false)
    }
  }

  const loadExportList = async () => {
    setLoadingExports(true)
    try {
      const r = await fetch(`/api/redis/${connection.id}/migration/exports`, { method: 'GET' })
      if (!r.ok) throw new Error('Failed to load exports')
      const data = await r.json()
      setExportList(data)
    } catch (e) {
      console.error('Error loading exports:', e)
      setExportList([])
    } finally {
      setLoadingExports(false)
    }
  }

  const handleDeleteExport = async (fileId: string) => {
    if (!confirm(`Delete export ${fileId}?`)) return
    try {
      const r = await fetch(`/api/redis/${connection.id}/migration/exports/${fileId}`, { method: 'DELETE' })
      if (!r.ok) throw new Error('Delete failed')
      setExportList(prev => prev.filter(e => e.fileId !== fileId))
    } catch (e) {
      alert(`Failed to delete: ${e.message}`)
    }
  }

  useEffect(() => {
    if (mode === 'disk') loadExportList()
  }, [mode])

  // ── RAM: scan ──
  const handleScan = useCallback(async () => {
    if (!pattern.trim()) return
    setScanning(true)
    setScanError('')
    setFoundKeys(null)
    setRamResults(null)
    try {
      const res = await fetch(`/api/redis/${connection.id}/keys/scan-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...connBody, pattern: pattern.trim() }),
      })
      if (!res.ok) throw new Error('Scan failed')
      const data = await res.json()
      setFoundKeys(data.keys)
    } catch (e) {
      setScanError(e.message)
    } finally {
      setScanning(false)
    }
  }, [connection, pattern])

  // ── RAM: migrate ──
  const handleRamMigrate = async () => {
    if (!foundKeys || foundKeys.length === 0 || !targetConn) return
    setMigrating(true)
    setRamResults(null)
    try {
      const res = await fetch(`/api/redis/${connection.id}/keys/copy-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...connBody,
          keys: foundKeys.map(k => k.key),
          targetHost: targetConn.host,
          targetPort: targetConn.port,
          targetPassword: targetConn.password,
          targetDb,
          replace,
        }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Migration failed')
      const data = await res.json()
      const succeeded = data.succeeded || []
      const skipped = data.skipped || []
      const failed = data.failed || []
      setRamResults({ succeeded: succeeded.length, skipped, failed })
      if (failed.length === 0) {
        onLog?.({ label: 'RAM Migration completed', detail: `${succeeded.length} keys → ${targetName(targetConn)} DB ${targetDb}` })
      }
      onRefreshHealth?.(connection)
      onRefreshHealth?.(targetConn)
    } catch (e) {
      setRamResults({ succeeded: 0, skipped: [], failed: [{ key: '(batch)', error: e.message }] })
    } finally {
      setMigrating(false)
    }
  }

  // ── Disk: export ──
  const handleExport = async () => {
    if (!pattern.trim()) return
    setExporting(true)
    setExportError('')
    setExportInfo(null)
    setDiskResults(null)
    try {
      const res = await fetch(`/api/redis/${connection.id}/migration/export-disk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...connBody, pattern: pattern.trim() }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Export failed')
      const data = await res.json()
      setExportInfo(data)
      onLog?.({ label: 'Disk Export', detail: `${data.keyCount} keys saved (${fmtBytes(data.fileSize)})` })
      loadExportList()
    } catch (e) {
      setExportError(e.message)
    } finally {
      setExporting(false)
    }
  }

  // ── Disk: import ──
  const handleDiskImport = async () => {
    if (!exportInfo || !targetConn) return
    setImporting(true)
    setDiskResults(null)
    setImportError('')
    try {
      const res = await fetch(`/api/redis/${connection.id}/migration/import-disk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileId: exportInfo.fileId,
          targetHost: targetConn.host,
          targetPort: targetConn.port,
          targetPassword: targetConn.password,
          targetDb,
          replace,
        }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Import failed')
      const data = await res.json()
      setDiskResults({ succeeded: data.succeeded, skipped: data.skipped || [], failed: data.failed || [] })
      if ((data.failed || []).length === 0) {
        onLog?.({ label: 'Disk Import completed', detail: `${data.succeeded} keys → ${targetName(targetConn)} DB ${targetDb}` })
      }
      onRefreshHealth?.(connection)
      onRefreshHealth?.(targetConn)
      loadExportList()
    } catch (e) {
      setImportError(e.message)
    } finally {
      setImporting(false)
    }
  }

  // ── Disk: download file ──
  const handleDownload = () => {
    if (!exportInfo) return
    window.open(`/api/redis/${connection.id}/migration/download/${exportInfo.fileId}`, '_blank')
  }

  const results = mode === 'ram' ? ramResults : diskResults

  return (
    <div className="migration-view">
      <div className="migration-header">
        <h3 className="migration-title">Data Migration</h3>
        <p className="migration-subtitle">Copy keys from this connection to another Redis instance.</p>
      </div>

      <div className="migration-body">

        {/* Mode selector */}
        <div className="migration-mode-toggle">
          <button
            className={`migration-mode-btn${mode === 'ram' ? ' active' : ''}`}
            onClick={() => switchMode('ram')}
          >
            <span className="migration-mode-icon">⚡</span>
            <span className="migration-mode-label">RAM Migration</span>
            <span className="migration-mode-desc">Fast, direct copy over network</span>
          </button>
          <button
            className={`migration-mode-btn${mode === 'disk' ? ' active' : ''}`}
            onClick={() => switchMode('disk')}
          >
            <span className="migration-mode-icon">💾</span>
            <span className="migration-mode-label">Disk Migration</span>
            <span className="migration-mode-desc">Export to file, then import — safe for large datasets</span>
          </button>
          <button
            className={`migration-mode-btn${mode === 'import' ? ' active' : ''}`}
            onClick={() => switchMode('import')}
          >
            <span className="migration-mode-icon">⬆</span>
            <span className="migration-mode-label">Bulk Import</span>
            <span className="migration-mode-desc">Run Redis commands from a .txt or .redis file</span>
          </button>
        </div>

        {/* Command Import UI */}
        {mode === 'import' && (
          <div className="migration-section">
            <div className="migration-section-title">Upload command file</div>
            <p className="migration-import-hint">
              One Redis command per line (e.g. <code>SET key value</code>, <code>HSET myhash f v</code>).
              Lines starting with <code>#</code> and blank lines are ignored.
            </p>
            <input
              type="file"
              accept=".txt,.redis,.cli"
              className="migration-file-input"
              onChange={handleImportFileChange}
              disabled={importing2}
            />
            {importParsed.length > 0 && (
              <div className="migration-found">
                <span className="migration-found-count">{importParsed.length} command{importParsed.length !== 1 ? 's' : ''} parsed</span>
                <ul className="migration-key-preview">
                  {importParsed.slice(0, 6).map((cmd, i) => <li key={i}><code>{cmd}</code></li>)}
                  {importParsed.length > 6 && <li className="migration-key-more">...and {importParsed.length - 6} more</li>}
                </ul>
              </div>
            )}
            {importError2 && <div className="migration-error">{importError2}</div>}
            {importResults && (
              <div className={`migration-result ${importResults.failed.length === 0 ? 'migration-result-ok' : 'migration-result-partial'}`}>
                {importResults.failed.length === 0 ? (
                  <span>✓ {importResults.succeeded} of {importResults.total} commands executed successfully</span>
                ) : (
                  <>
                    <div>✓ {importResults.succeeded} succeeded · ✗ {importResults.failed.length} failed</div>
                    <ul className="migration-errors">
                      {importResults.failed.map((f, i) => (
                        <li key={i}><span className="migration-error-key">{f.command}</span> — {f.error}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
            <div className="migration-actions" style={{ marginTop: 12 }}>
              <button
                className="migration-btn migration-btn-primary"
                onClick={handleRunImport}
                disabled={importing2 || importParsed.length === 0}
              >
                {importing2 ? `Running...` : `⬆ Run ${importParsed.length} command${importParsed.length !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        )}

        {/* Source → Target + Pattern + Options + Results + Actions (ram/disk only) */}
        {mode !== 'import' && <>
          <div className="migration-route">
            <div className="migration-endpoint migration-source">
              <div className="migration-endpoint-label">Source</div>
              <div className="migration-endpoint-name">{connection.name || `${connection.host}:${connection.port}`}</div>
              <div className="migration-endpoint-addr">{connection.host}:{connection.port} · DB {connection.db ?? 0}</div>
            </div>
            <div className="migration-arrow">→</div>
            <div className="migration-endpoint migration-target-box">
              <div className="migration-endpoint-label">Target</div>
              {allConnections.length === 0 ? (
                <p className="migration-no-target">No connections available.</p>
              ) : (
                <select
                  className="migration-target-select"
                  value={targetId}
                  onChange={e => {
                    setTargetId(e.target.value)
                    const conn = allConnections.find(c => String(c.id) === e.target.value)
                    setTargetDb(conn?.db ?? 0)
                    setFoundKeys(null)
                    resetResults()
                  }}
                >
                  <option value="">— Select target —</option>
                  {allConnections.map(c => (
                    <option key={c.id} value={String(c.id)}>
                      {targetName(c)}{String(c.id) === String(connection.id) ? ' (this connection)' : ''}
                    </option>
                  ))}
                </select>
              )}
              {targetId && (
                <select
                  className="migration-db-select"
                  value={targetDb}
                  onChange={e => setTargetDb(Number(e.target.value))}
                >
                  {Array.from({ length: 16 }, (_, i) => (
                    <option key={i} value={i}>DB {i}</option>
                  ))}
                </select>
              )}
              {targetId && isSameConnAndDb && (
                <p style={{ color: '#f0883e', fontSize: '0.85em', margin: '4px 0 0' }}>
                  Select a different database — source and target are the same.
                </p>
              )}
            </div>
          </div>

          {/* Pattern */}
          <div className="migration-section">
            <div className="migration-section-title">Keys to migrate</div>
            <div className="migration-pattern-row">
              <input
                className="migration-input"
                type="text"
                placeholder="Pattern (e.g. user:* or *)"
                value={pattern}
                onChange={e => { setPattern(e.target.value); setFoundKeys(null); resetResults() }}
                onKeyDown={e => e.key === 'Enter' && (mode === 'ram' ? handleScan() : handleExport())}
                disabled={migrating || importing || exporting}
              />
              {mode === 'ram' ? (
                <button
                  className="migration-btn migration-btn-secondary"
                  onClick={handleScan}
                  disabled={scanning || migrating || !pattern.trim()}
                >
                  {scanning ? 'Scanning...' : 'Find Keys'}
                </button>
              ) : (
                <button
                  className="migration-btn migration-btn-disk"
                  onClick={handleExport}
                  disabled={exporting || importing || !pattern.trim()}
                >
                  {exporting ? 'Exporting...' : '💾 Export to Disk'}
                </button>
              )}
            </div>

            {/* RAM: found keys */}
            {mode === 'ram' && (
              <>
                {scanError && <div className="migration-error">{scanError}</div>}
                {foundKeys !== null && (
                  <div className="migration-found">
                    <span className="migration-found-count">
                      {foundKeys.length === 0 ? 'No keys match this pattern.' : `${foundKeys.length} key${foundKeys.length !== 1 ? 's' : ''} found`}
                    </span>
                    {foundKeys.length > 0 && (
                      <ul className="migration-key-preview">
                        {foundKeys.slice(0, 8).map(k => <li key={k.key}>{k.key}</li>)}
                        {foundKeys.length > 8 && <li className="migration-key-more">...and {foundKeys.length - 8} more</li>}
                      </ul>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Disk: export info & list */}
            {mode === 'disk' && (
              <>
                {exportError && <div className="migration-error">{exportError}</div>}
                {exportInfo && (
                  <div className="migration-export-info">
                    <div className="migration-export-stats">
                      <span className="migration-export-stat">
                        <span className="migration-export-stat-label">Keys</span>
                        <span className="migration-export-stat-value">{exportInfo.keyCount.toLocaleString()}</span>
                      </span>
                      <span className="migration-export-stat">
                        <span className="migration-export-stat-label">File Size</span>
                        <span className="migration-export-stat-value">{fmtBytes(exportInfo.fileSize)}</span>
                      </span>
                      <span className="migration-export-stat">
                        <span className="migration-export-stat-label">Pattern</span>
                        <span className="migration-export-stat-value migration-export-pattern">{exportInfo.pattern}</span>
                      </span>
                    </div>
                    <div className="migration-export-actions">
                      <span className="migration-export-saved">✓ Saved to server disk</span>
                      <button className="migration-btn-download" onClick={handleDownload}>⬇ Download backup</button>
                    </div>
                  </div>
                )}

                {/* Export list */}
                {exportList.length > 0 && (
                  <div className="migration-export-list">
                    <div className="migration-export-list-title">
                      💾 Saved Exports ({exportList.length})
                    </div>
                    <div className="migration-export-list-items">
                      {exportList.map(exp => (
                        <div key={exp.fileId} className="migration-export-item">
                          <div className="migration-export-item-info">
                            <div className="migration-export-item-source">{exp.source} · {exp.pattern}</div>
                            <div className="migration-export-item-meta">
                              {exp.keyCount?.toLocaleString() || 0} keys · {fmtBytes(exp.fileSize)} · {new Date(exp.exportedAt).toLocaleString()}
                            </div>
                          </div>
                          <div className="migration-export-item-actions">
                            <button
                              className="migration-export-item-btn migration-export-item-delete"
                              onClick={() => handleDeleteExport(exp.fileId)}
                              title="Delete from server"
                            >
                              🗑️ Delete
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Options */}
          <div className="migration-section">
            <div className="migration-section-title">Options</div>
            <label className="migration-option-row">
              <input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} disabled={migrating || importing} />
              <span>
                <strong>Overwrite existing keys</strong>
                <span className="migration-option-desc">
                  {replace
                    ? 'Keys that already exist in the target will be deleted and replaced with the source value.'
                    : 'Keys that already exist in the target will be skipped — only new keys will be copied.'}
                </span>
              </span>
            </label>
          </div>

          {/* Results */}
          {results && (
            <>
              <div className={`migration-result ${results.failed.length === 0 ? 'migration-result-ok' : 'migration-result-partial'}`}>
                {results.failed.length === 0 ? (
                  <span>
                    ✓ {results.succeeded} key{results.succeeded !== 1 ? 's' : ''} migrated successfully to <strong>{targetConn ? targetName(targetConn) : ''}</strong>
                    {results.skipped.length > 0 ? ` · ${results.skipped.length} skipped` : ''}
                  </span>
                ) : (
                  <>
                    <div>✓ {results.succeeded} succeeded{results.skipped.length > 0 ? ` · ${results.skipped.length} skipped` : ''} · ✗ {results.failed.length} failed</div>
                    <ul className="migration-errors">
                      {results.failed.map((f, i) => (
                        <li key={i}><span className="migration-error-key">{f.key}</span> — {f.error}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
              {results.skipped.length > 0 && (
                <div className="migration-skipped-box">
                  <div className="migration-skipped-title">Skipped keys — already exist in target</div>
                  <p className="migration-skipped-hint">These keys were not copied because a key with the same name already exists in the target. Enable <strong>Overwrite existing keys</strong> to replace them.</p>
                  <ul className="migration-skipped-list">
                    {results.skipped.map(k => <li key={k}>{k}</li>)}
                  </ul>
                </div>
              )}
            </>
          )}

          {/* Action button */}
          <div className="migration-actions">
            {mode === 'ram' ? (
              <button
                className="migration-btn migration-btn-primary"
                onClick={handleRamMigrate}
                disabled={migrating || !targetId || !foundKeys || foundKeys.length === 0 || isSameConnAndDb}
              >
                {migrating ? 'Migrating...' : `⚡ Migrate ${foundKeys ? foundKeys.length : 0} key${foundKeys?.length !== 1 ? 's' : ''}`}
              </button>
            ) : (
              <button
                className="migration-btn migration-btn-primary"
                onClick={handleDiskImport}
                disabled={importing || !targetId || !exportInfo || exportInfo.keyCount === 0 || isSameConnAndDb}
              >
                {importing ? 'Importing...' : exportInfo ? `💾 Import ${exportInfo.keyCount.toLocaleString()} keys to target` : '💾 Import to target'}
              </button>
            )}
            {importError && <div className="migration-error" style={{ marginTop: 8 }}>{importError}</div>}
          </div>
        </>}

      </div>
    </div>
  )
}
