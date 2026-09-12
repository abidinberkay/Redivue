import { useState } from 'react'
import type { ConnBody, Connection } from '../../../types'

export function PatternDeleteModal({ connectionId, connBody, onClose, onLog, onRefresh, onRefreshHealth }: {
  connectionId: string; connBody: ConnBody;
  onClose: () => void; onLog?: (entry: any) => void;
  onRefresh?: () => void; onRefreshHealth?: (conn: Connection) => void
}) {
  const [patternInput, setPatternInput] = useState('*')
  const [previewKeys, setPreviewKeys] = useState<any[] | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  const handleFind = async () => {
    if (!patternInput.trim()) { setError('Enter a pattern'); return }
    setPreviewing(true); setError(''); setPreviewKeys(null)
    try {
      const res = await fetch(`/api/redis/${connectionId}/keys/scan-all`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...connBody, pattern: patternInput.trim() }),
      })
      if (!res.ok) throw new Error('Scan failed')
      const data = await res.json()
      setPreviewKeys(data.keys)
    } catch (e) { setError((e as Error).message) }
    finally { setPreviewing(false) }
  }

  const handleDelete = async () => {
    if (!previewKeys || previewKeys.length === 0) return
    setDeleting(true); setError('')
    try {
      const res = await fetch(`/api/redis/${connectionId}/keys/delete-by-pattern`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...connBody, pattern: patternInput.trim() }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Delete failed') }
      const data = await res.json()
      onLog?.({ label: 'Pattern delete', detail: `Deleted ${data.deleted} keys matching "${patternInput}"` })
      onRefresh?.()
      onRefreshHealth?.({ id: parseInt(connectionId) || 0, ...connBody })
      onClose()
    } catch (e) { setError((e as Error).message) }
    finally { setDeleting(false) }
  }

  const handleBackup = async () => {
    if (!previewKeys || previewKeys.length === 0) return
    let results: any[] = []
    try {
      const res = await fetch(`/api/redis/${connectionId}/keys/values-batch`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...connBody, keys: previewKeys.map(k => k.key) }),
      })
      if (res.ok) results = await res.json()
    } catch { /* ignore */ }
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `redis-backup-pattern-${ts}.json`; a.click(); URL.revokeObjectURL(url)
  }

  return (
    <div className="modal-overlay">
      <div className="modal-box modal-wide">
        <h3 className="modal-title">Delete by Pattern</h3>
        <p className="modal-message" style={{ marginBottom: 12, color: '#8b949e' }}>
          Scan for all keys matching a pattern and delete them. Use <code>user:*</code>, <code>session:*</code>, etc.
        </p>
        <div className="pattern-delete-row">
          <input className="form-input" type="text" placeholder="e.g. session:* or cache:user:*"
            value={patternInput} onChange={e => { setPatternInput(e.target.value); setPreviewKeys(null) }}
            onKeyDown={e => e.key === 'Enter' && handleFind()} disabled={deleting} />
          <button className="btn-secondary" onClick={handleFind} disabled={previewing || deleting || !patternInput.trim()}>
            {previewing ? 'Searching...' : 'Find Keys'}
          </button>
        </div>
        {error && <div className="modal-error">{error}</div>}
        {previewKeys !== null && (
          <div className="pattern-delete-preview">
            {previewKeys.length === 0 ? (
              <p className="modal-message" style={{ color: '#8b949e' }}>No keys match this pattern.</p>
            ) : (
              <>
                <p className="modal-message" style={{ color: '#f85149', marginBottom: 8 }}>
                  ⚠ <strong>{previewKeys.length}</strong> key{previewKeys.length !== 1 ? 's' : ''} found. Deleting cannot be undone.
                </p>
                <ul className="bulk-key-list">
                  {previewKeys.slice(0, 10).map(k => <li key={k.key}>{k.key}</li>)}
                  {previewKeys.length > 10 && <li className="bulk-more">...and {previewKeys.length - 10} more</li>}
                </ul>
                {deleting && <div className="bulk-progress">Deleting {previewKeys.length} keys...</div>}
                <div className="modal-actions" style={{ marginTop: 16 }}>
                  <button className="btn-danger" onClick={handleDelete} disabled={deleting}>
                    {deleting ? 'Deleting...' : `🗑 Delete ${previewKeys.length} key${previewKeys.length !== 1 ? 's' : ''}`}
                  </button>
                  <button className="btn-secondary" onClick={handleBackup} disabled={deleting} title="Download JSON before deleting">⬇ Download first</button>
                  <button className="btn-secondary" onClick={onClose} disabled={deleting}>Cancel</button>
                </div>
              </>
            )}
          </div>
        )}
        {previewKeys === null && (
          <div className="modal-actions" style={{ marginTop: 20 }}>
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  )
}
