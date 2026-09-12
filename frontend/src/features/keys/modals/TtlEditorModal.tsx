import { useState } from 'react'
import { LiveTtl } from '../components/LiveTtl'
import type { ConnBody } from '../../../types'

export function TtlEditorModal({ keyName, currentTtl, connBody, connectionId, onClose, onSuccess }: {
  keyName: string; currentTtl: number; connBody: ConnBody; connectionId: string;
  onClose: () => void; onSuccess: (ttl: number) => void
}) {
  const [custom, setCustom] = useState(currentTtl > 0 ? String(currentTtl) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const PRESETS = [
    { label: 'Remove TTL', seconds: -1 },
    { label: '5 min', seconds: 300 },
    { label: '1 hour', seconds: 3600 },
    { label: '6 hours', seconds: 21600 },
    { label: '1 day', seconds: 86400 },
    { label: '7 days', seconds: 604800 },
    { label: '30 days', seconds: 2592000 },
  ]

  const apply = async (seconds: number) => {
    setSaving(true); setError('')
    try {
      const res = await fetch(`/api/redis/${connectionId}/key/set-ttl`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...connBody, key: keyName, ttl: seconds }),
      })
      if (!res.ok) throw new Error('Failed to set TTL')
      onSuccess(seconds)
    } catch (e) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  const handleCustomApply = () => {
    const v = parseInt(custom)
    if (isNaN(v) || v === 0) { setError('Enter valid seconds (use -1 to remove TTL)'); return }
    apply(v)
  }

  return (
    <div className="modal-overlay">
      <div className="modal-box modal-wide">
        <h3 className="modal-title">TTL Manager — <span className="modal-key-name">{keyName}</span></h3>
        <div className="ttl-current">Current TTL: <LiveTtl ttl={currentTtl} /></div>
        {error && <div className="modal-error">{error}</div>}
        <div className="ttl-presets">
          {PRESETS.map(p => (
            <button key={p.label} className={`ttl-preset-btn ${p.seconds === -1 ? 'ttl-preset-remove' : ''}`}
              onClick={() => apply(p.seconds)} disabled={saving}>{p.label}</button>
          ))}
        </div>
        <div className="ttl-custom-row">
          <input className="form-input" type="number" placeholder="Custom seconds (e.g. 1800)"
            value={custom} onChange={e => setCustom(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCustomApply()} />
          <button className="btn-primary" onClick={handleCustomApply} disabled={saving}>
            {saving ? 'Saving...' : 'Set'}
          </button>
        </div>
        <div className="modal-actions" style={{ marginTop: 16 }}>
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
