import { useState } from 'react'
import type { ConnBody } from '../../../types'

const TYPE_DESCRIPTIONS: Record<string, string> = {
  string: 'A single text value — plain text, JSON, numbers, binary.',
  hash: 'A map of field → value pairs (like an object/dict). Creates the key with one initial field; add more fields after creation.',
  list: 'An ordered list of strings (like an array). Creates the key with one initial item; push more items after creation.',
  set: 'An unordered collection of unique strings. Creates the key with one initial member; add more members after creation.',
  zset: 'Like a set but each member has a numeric score for ordering. Creates the key with one initial member.',
  stream: 'An append-only log of time-ordered entries. Each entry has an auto-generated ID and one or more field-value pairs.',
  json: 'A JSON document (requires RedisJSON module). Store and query complex JSON structures with JSONPath support.',
}

const TTL_PRESETS = [
  { label: '1h', seconds: 3600 },
  { label: '1d', seconds: 86400 },
  { label: '7d', seconds: 604800 },
  { label: '30d', seconds: 2592000 },
]

export function AddKeyModal({ connBody, connectionId, onClose, onSuccess }: {
  connBody: ConnBody; connectionId: string;
  onClose: () => void; onSuccess: (key: string, type: string) => void
}) {
  const [type, setType] = useState('string')
  const [key, setKey] = useState('')
  const [value, setValue] = useState('')
  const [ttl, setTtl] = useState('')
  const [field, setField] = useState('')
  const [score, setScore] = useState('0')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [streamFields, setStreamFields] = useState([{ field: '', value: '' }])
  const [jsonValue, setJsonValue] = useState('{}')

  const handleSave = async () => {
    if (!key.trim()) { setError('Key name is required'); return }
    if (type === 'hash' && !field.trim()) { setError('Field name is required for Hash'); return }
    if ((type === 'list' || type === 'set' || type === 'zset') && !value.trim()) { setError('A value is required to create this key'); return }
    if (type === 'stream' && !streamFields.some(f => f.field.trim())) { setError('At least one field is required for Stream'); return }
    if (type === 'json') {
      try { JSON.parse(jsonValue) } catch (_) { setError('Invalid JSON'); return }
    }
    setSaving(true); setError('')
    try {
      let endpoint: string, body: any
      if (type === 'stream') {
        const fieldsMap: Record<string, string> = {}
        streamFields.filter(f => f.field.trim()).forEach(f => { fieldsMap[f.field] = f.value })
        endpoint = `/api/redis/${connectionId}/key/stream-add`
        body = { ...connBody, key, entryId: '*', fields: fieldsMap }
      } else if (type === 'json') {
        endpoint = `/api/redis/${connectionId}/key/json-set`
        body = { ...connBody, key, path: '$', value: jsonValue }
      } else {
        switch (type) {
          case 'string': endpoint = `/api/redis/${connectionId}/key/set-string`; body = { ...connBody, key, value, ttl: ttl ? parseInt(ttl) : -1 }; break
          case 'hash': endpoint = `/api/redis/${connectionId}/key/hash-field`; body = { ...connBody, key, field, value, operation: 'set' }; break
          case 'list': endpoint = `/api/redis/${connectionId}/key/list-op`; body = { ...connBody, key, value, operation: 'rpush' }; break
          case 'set': endpoint = `/api/redis/${connectionId}/key/set-op`; body = { ...connBody, key, value, operation: 'add' }; break
          case 'zset': endpoint = `/api/redis/${connectionId}/key/zset-op`; body = { ...connBody, key, member: value, score: parseFloat(score) || 0, operation: 'add' }; break
          default: return
        }
      }
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) throw new Error('Failed to create key')
      if (ttl && type !== 'string') {
        await fetch(`/api/redis/${connectionId}/key/set-ttl`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...connBody, key, ttl: parseInt(ttl) }),
        })
      }
      onSuccess(key, type)
    } catch (err) { setError((err as Error).message) }
    finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-box modal-wide">
        <h3 className="modal-title">Add New Key</h3>
        {error && <div className="modal-error">{error}</div>}

        <div className="form-group">
          <label>Type</label>
          <select value={type} onChange={e => { setType(e.target.value); setError('') }} className="form-select">
            <option value="string">String</option><option value="hash">Hash</option>
            <option value="list">List</option><option value="set">Set</option>
            <option value="zset">Sorted Set</option><option value="stream">Stream</option><option value="json">JSON</option>
          </select>
          <div className="form-hint">{TYPE_DESCRIPTIONS[type]}</div>
        </div>

        <div className="form-group">
          <label>Key name</label>
          <input className="form-input" value={key} onChange={e => setKey(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSave()}
            placeholder="e.g. user:1001 or session:abc" autoFocus />
        </div>

        {type === 'hash' && (
          <div className="form-group">
            <label>Field name <span className="form-required">*</span></label>
            <input className="form-input" value={field} onChange={e => setField(e.target.value)} placeholder="e.g. username" />
          </div>
        )}

        {type === 'stream' ? (
          <div className="form-group">
            <label>Fields <span className="form-required">*</span></label>
            {streamFields.map((sf, idx) => (
              <div key={idx} className="inline-add-form" style={{ marginBottom: 4 }}>
                <input className="form-input-sm" placeholder="field" value={sf.field} onChange={e => { const n = [...streamFields]; n[idx].field = e.target.value; setStreamFields(n) }} />
                <input className="form-input-sm" placeholder="value" value={sf.value} onChange={e => { const n = [...streamFields]; n[idx].value = e.target.value; setStreamFields(n) }} />
                {streamFields.length > 1 && <button type="button" className="btn-delete-sm" onClick={() => setStreamFields(streamFields.filter((_, i) => i !== idx))}>✕</button>}
              </div>
            ))}
            <button type="button" className="btn-secondary btn-sm" onClick={() => setStreamFields([...streamFields, { field: '', value: '' }])}>+ Add field</button>
          </div>
        ) : type === 'json' ? (
          <div className="form-group">
            <label>JSON Value <span className="form-required">*</span></label>
            <textarea className="form-textarea" value={jsonValue} onChange={e => setJsonValue(e.target.value)}
              placeholder='{"key": "value"}' rows={6} spellCheck="false" style={{ fontFamily: 'monospace', fontSize: '12px' }} />
            <div className="form-hint">Valid JSON required. Try: {`{"user": "john", "age": 30}`}</div>
          </div>
        ) : (
          <div className="form-group">
            <label>
              {type === 'string' && 'Value'}{type === 'hash' && 'Field value'}
              {type === 'list' && 'First item'}{type === 'set' && 'Member'}{type === 'zset' && 'Member'}
            </label>
            <textarea className="form-textarea" value={value} onChange={e => setValue(e.target.value)}
              placeholder={type === 'string' ? 'e.g. hello world or {"json": true}' : type === 'hash' ? 'e.g. Berkay' : type === 'list' ? 'e.g. item-1' : type === 'set' ? 'e.g. tag:backend' : 'e.g. task-deploy'}
              rows={type === 'string' ? 4 : 2} />
          </div>
        )}

        {type === 'zset' && (
          <div className="form-group">
            <label>Score</label>
            <input className="form-input" value={score} onChange={e => setScore(e.target.value)} placeholder="0" type="number" step="any" />
            <div className="form-hint">Numeric value used for ordering — lower score ranks first in ascending queries.</div>
          </div>
        )}

        <div className="form-group">
          <label>TTL <span className="form-label-sub">(optional — leave empty for no expiry)</span></label>
          <div className="ttl-quick-row">
            {TTL_PRESETS.map(p => (
              <button key={p.label} type="button"
                className={`ttl-quick-btn ${ttl === String(p.seconds) ? 'active' : ''}`}
                onClick={() => setTtl(ttl === String(p.seconds) ? '' : String(p.seconds))}>{p.label}</button>
            ))}
            {ttl && <button type="button" className="ttl-quick-btn ttl-quick-clear" onClick={() => setTtl('')}>✕ clear</button>}
          </div>
          <input className="form-input" value={ttl} onChange={e => setTtl(e.target.value)} placeholder="or type custom seconds, e.g. 1800" type="number" min="1" />
        </div>

        <div className="modal-actions">
          <button className="btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Creating...' : 'Create'}</button>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
