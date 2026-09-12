import { useState } from 'react'
import type { ConnBody } from '../../../types'

export function BulkTtlModal({ keys, connBody, connectionId, onClose, onSuccess }: {
  keys: string[]; connBody: ConnBody; connectionId: string;
  onClose: () => void; onSuccess: () => void
}) {
  const [custom, setCustom] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const PRESETS = [
    { label: 'Remove TTL', seconds: -1 },
    { label: '1 hour', seconds: 3600 },
    { label: '1 day', seconds: 86400 },
    { label: '7 days', seconds: 604800 },
  ]

  const applyAll = async (seconds: number) => {
    setSaving(true); setError('')
    try {
      const res = await fetch(`/api/redis/${connectionId}/keys/set-ttl-batch`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...connBody, keys, ttl: seconds }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Failed') }
      const data = await res.json()
      if (data.failed > 0) setError(`${data.failed} key(s) failed`)
      else onSuccess()
    } catch (e) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  const handleCustomApply = () => {
    const v = parseInt(custom)
    if (isNaN(v) || v === 0) { setError('Enter valid seconds (-1 removes TTL)'); return }
    applyAll(v)
  }

  return (
    <div className="modal-overlay">
      <div className="modal-box modal-wide">
        <h3 className="modal-title">Bulk TTL — {keys.length} keys</h3>
        <ul className="bulk-key-list">
          {keys.slice(0, 10).map(k => <li key={k}>{k}</li>)}
          {keys.length > 10 && <li className="bulk-more">...and {keys.length - 10} more</li>}
        </ul>
        {error && <div className="modal-error">{error}</div>}
        {saving && <div className="bulk-progress">Applying TTL to {keys.length} keys...</div>}
        <div className="ttl-presets">
          {PRESETS.map(p => (
            <button key={p.label} className={`ttl-preset-btn ${p.seconds === -1 ? 'ttl-preset-remove' : ''}`}
              onClick={() => applyAll(p.seconds)} disabled={saving}>{p.label}</button>
          ))}
        </div>
        <div className="ttl-custom-row">
          <input className="form-input" type="number" placeholder="Custom seconds"
            value={custom} onChange={e => setCustom(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCustomApply()} />
          <button className="btn-primary" onClick={handleCustomApply} disabled={saving}>Set</button>
        </div>
        <div className="modal-actions" style={{ marginTop: 16 }}>
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
