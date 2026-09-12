import { useState } from 'react'
import type { ConnBody } from '../../../types'

export function BulkDeleteModal({ keys, connectionId, connBody, onClose, onConfirm, loading, error }: {
  keys: string[]; connectionId: string; connBody: ConnBody;
  onClose: () => void; onConfirm: () => void; loading: boolean; error: string
}) {
  const [backupLoading, setBackupLoading] = useState(false)

  const handleBackup = async () => {
    setBackupLoading(true)
    let results: any[] = []
    try {
      const res = await fetch(`/api/redis/${connectionId}/keys/values-batch`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...connBody, keys }),
      })
      if (res.ok) results = await res.json()
    } catch { /* ignore */ }
    setBackupLoading(false)
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `redis-backup-${ts}.json`; a.click(); URL.revokeObjectURL(url)
  }

  return (
    <div className="modal-overlay">
      <div className="modal-box modal-wide">
        <h3 className="modal-title">Delete {keys.length} keys?</h3>
        <p className="modal-message" style={{ marginBottom: 12, color: '#f85149' }}>
          ⚠ This action cannot be undone. All selected keys will be permanently deleted.
        </p>
        <ul className="bulk-key-list">
          {keys.slice(0, 10).map(k => <li key={k}>{k}</li>)}
          {keys.length > 10 && <li className="bulk-more">...and {keys.length - 10} more</li>}
        </ul>
        {error && <div className="modal-error">{error}</div>}
        <div className="modal-actions" style={{ marginTop: 20 }}>
          <button className="btn-danger" onClick={onConfirm} disabled={loading || backupLoading}>{loading ? 'Deleting...' : 'Delete All'}</button>
          <button className="btn-secondary" onClick={handleBackup} disabled={loading || backupLoading} title="Download JSON file with these keys before deleting">
            {backupLoading ? 'Downloading...' : '⬇ Download first'}
          </button>
          <button className="btn-secondary" onClick={onClose} disabled={loading || backupLoading}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
