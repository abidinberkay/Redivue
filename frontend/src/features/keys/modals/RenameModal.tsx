import { useState } from 'react'
import type { ConnBody } from '../../../types'

export function RenameModal({ keyName, connBody, connectionId, onClose, onSuccess }: {
  keyName: string; connBody: ConnBody; connectionId: string;
  onClose: () => void; onSuccess: (newKey: string) => void
}) {
  const [newName, setNewName] = useState(keyName)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleRename = async () => {
    const trimmed = newName.trim()
    if (!trimmed || trimmed === keyName) { setError('Enter a different key name'); return }
    setSaving(true); setError('')
    try {
      const res = await fetch(`/api/redis/${connectionId}/key/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...connBody, key: keyName, newKey: trimmed }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Rename failed') }
      onSuccess(trimmed)
    } catch (e) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-box modal-wide">
        <h3 className="modal-title">Rename Key</h3>
        <div className="ttl-current" style={{ marginBottom: 12, wordBreak: 'break-all' }}>
          Current: <span style={{ color: '#58a6ff' }}>{keyName}</span>
        </div>
        {error && <div className="modal-error">{error}</div>}
        <div className="ttl-custom-row">
          <input className="form-input" value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleRename()} autoFocus />
          <button className="btn-primary" onClick={handleRename} disabled={saving}>
            {saving ? 'Renaming...' : 'Rename'}
          </button>
        </div>
        <div className="modal-actions" style={{ marginTop: 16 }}>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
