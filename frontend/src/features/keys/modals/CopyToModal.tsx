import { useState } from 'react'
import type { ConnBody } from '../../../types'

const DB_OPTIONS = Array.from({ length: 16 }, (_, i) => i)

export function CopyToModal({ keys, connectionId, connBody, onClose, onLog }: {
  keys: string[]; connectionId: string; connBody: ConnBody;
  onClose: () => void; onLog?: (entry: any) => void
}) {
  const [allConns] = useState(() => {
    try {
      const saved = localStorage.getItem('redivue_connections')
      if (!saved) return []
      return JSON.parse(saved)
    } catch { return [] }
  })
  const [targetId, setTargetId] = useState('')
  const [targetDb, setTargetDb] = useState(0)
  const [replace, setReplace] = useState(false)
  const [copying, setCopying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [errors, setErrors] = useState<string[]>([])
  const [done, setDone] = useState(false)

  const targetConn = allConns.find((c: any) => String(c.id) === targetId)
  const isSameConnAndDb = String(targetConn?.id) === String(connectionId) && targetDb === connBody.db

  const handleCopy = async () => {
    if (!targetConn || isSameConnAndDb) return
    setCopying(true); setProgress(0); setErrors([])
    try {
      const res = await fetch(`/api/redis/${connectionId}/keys/copy-batch`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...connBody,
          keys,
          targetHost: targetConn.host,
          targetPort: targetConn.port,
          targetPassword: targetConn.password,
          targetDb,
          targetAuthType: targetConn.authType ?? 'PASSWORD',
          targetUsername: targetConn.username ?? null,
          targetUrl: targetConn.url ?? null,
          replace,
        }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Copy failed') }
      const data = await res.json()
      const errs = (data.failed || []).map((f: any) => `${f.key}: ${f.error}`)
      setProgress(keys.length); setErrors(errs); setDone(true)
      if (errs.length === 0) {
        const okCount = (data.succeeded || []).length
        const targetLabel = targetConn.name || `${targetConn.host}:${targetConn.port}`
        onLog?.({ label: 'Copy to connection', detail: `${okCount} key${okCount !== 1 ? 's' : ''} → ${targetLabel} db${targetDb}` })
      }
    } catch (e) { setErrors([(e as Error).message]); setDone(true) }
    finally { setCopying(false) }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-box modal-wide">
        <h3 className="modal-title">Copy {keys.length} key{keys.length !== 1 ? 's' : ''} to another database</h3>
        {allConns.length === 0 ? (
          <>
            <p className="modal-message" style={{ color: '#8b949e', margin: '16px 0' }}>
              No connections available.
            </p>
            <div className="modal-actions" style={{ marginTop: 16 }}>
              <button className="btn-secondary" onClick={onClose}>Close</button>
            </div>
          </>
        ) : !done ? (
          <>
            <ul className="bulk-key-list" style={{ marginBottom: 16 }}>
              {keys.slice(0, 5).map(k => <li key={k}>{k}</li>)}
              {keys.length > 5 && <li className="bulk-more">...and {keys.length - 5} more</li>}
            </ul>

            <div className="copy-target-label">Target connection</div>
            <div className="copy-conn-list">
              {allConns.map((c: any) => {
                const isCurrent = String(c.id) === String(connectionId)
                return (
                  <div
                    key={c.id}
                    className={`copy-conn-item${String(c.id) === targetId ? ' copy-conn-selected' : ''}`}
                    onClick={() => { setTargetId(String(c.id)); if (isCurrent) setTargetDb(0) }}
                  >
                    <span className="copy-conn-name">
                      {c.name || `${c.host}:${c.port}`}
                      {isCurrent && <span style={{ color: '#8b949e', fontSize: '0.8em', marginLeft: 6 }}>(this connection)</span>}
                    </span>
                    <span className="copy-conn-addr">{c.host}:{c.port}</span>
                  </div>
                )
              })}
            </div>

            {targetId && (
              <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                <label style={{ color: '#8b949e', fontSize: '0.9em' }}>Target database</label>
                <select
                  value={targetDb}
                  onChange={e => setTargetDb(Number(e.target.value))}
                  style={{ background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 4, padding: '3px 8px' }}
                >
                  {DB_OPTIONS.map(db => (
                    <option key={db} value={db}>
                      db{db}{String(targetConn?.id) === String(connectionId) && db === connBody.db ? ' (current)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {isSameConnAndDb && (
              <p style={{ color: '#f0883e', fontSize: '0.85em', margin: '8px 0 0' }}>
                Select a different database or connection.
              </p>
            )}

            <label className="copy-replace-row">
              <input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} />
              <span>Overwrite if key already exists in target</span>
            </label>

            {copying && <div className="bulk-progress">Copying {progress}/{keys.length}...</div>}
            <div className="modal-actions" style={{ marginTop: 16 }}>
              <button
                className="btn-primary"
                onClick={handleCopy}
                disabled={copying || !targetId || isSameConnAndDb}
              >
                {copying ? `Copying ${progress}/${keys.length}...` : `Copy ${keys.length} key${keys.length !== 1 ? 's' : ''}`}
              </button>
              <button className="btn-secondary" onClick={onClose} disabled={copying}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            {errors.length === 0 ? (
              <p className="modal-message" style={{ color: '#3fb950', margin: '12px 0' }}>
                ✓ All {keys.length} key{keys.length !== 1 ? 's' : ''} copied successfully to{' '}
                <strong>{targetConn?.name || `${targetConn?.host}:${targetConn?.port}`}</strong> db{targetDb}
              </p>
            ) : (
              <>
                <p className="modal-message" style={{ color: '#f85149', margin: '12px 0' }}>{errors.length} key{errors.length !== 1 ? 's' : ''} failed to copy.</p>
                <ul className="bulk-key-list">{errors.map((e, i) => <li key={i} style={{ color: '#f85149' }}>{e}</li>)}</ul>
              </>
            )}
            <div className="modal-actions" style={{ marginTop: 16 }}>
              <button className="btn-secondary" onClick={onClose}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
