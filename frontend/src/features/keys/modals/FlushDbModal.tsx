import { useState } from 'react'
import type { ConnBody } from '../../../types'

export function FlushDbModal({ connectionId, connBody, onClose, onSuccess }: {
  connectionId: string; connBody: ConnBody; onClose: () => void; onSuccess: () => void
}) {
  const [confirm, setConfirm] = useState('')
  const [flushing, setFlushing] = useState(false)
  const [error, setError] = useState('')
  const db = connBody.db ?? 0
  const expected = `FLUSHDB ${db}`

  const handleFlush = async () => {
    setFlushing(true); setError('')
    try {
      const res = await fetch(`/api/redis/${connectionId}/keys/delete-by-pattern`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...connBody, pattern: '*' }),
      })
      if (!res.ok) throw new Error('Flush failed')
      onSuccess()
    } catch (e) { setError((e as Error).message); setFlushing(false) }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-box modal-wide">
        <h3 className="modal-title">Flush Database {db}</h3>
        <div className="mm-unlimited-note" style={{ borderColor: '#f8514944', background: '#1a0a0a', marginBottom: 16 }}>
          <strong>⚠ Danger:</strong> This will permanently delete <strong>all keys</strong> in <strong>DB {db}</strong>. This cannot be undone.
        </div>
        <p style={{ color: '#8b949e', fontSize: 13, marginBottom: 12 }}>
          Type <code style={{ color: '#f85149', background: '#1a0a0a', padding: '2px 6px', borderRadius: 4 }}>{expected}</code> to confirm:
        </p>
        <input className="form-input" value={confirm} onChange={e => setConfirm(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && confirm === expected && handleFlush()}
          placeholder={expected} autoFocus />
        {error && <div className="modal-error">{error}</div>}
        <div className="modal-actions" style={{ marginTop: 16 }}>
          <button className="btn-danger" onClick={handleFlush} disabled={confirm !== expected || flushing}>
            {flushing ? 'Flushing...' : 'Flush DB'}
          </button>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
