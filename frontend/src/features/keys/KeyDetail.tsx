import { useState, useEffect, useRef } from 'react'
import { decompress as zstdDecompress } from 'fzstd'
import * as lz4 from 'lz4js'
import Snappy from 'snappyjs'
import { useLiveTtl } from './hooks/useLiveTtl'
import { LiveTtl } from './components/LiveTtl'
import { TtlEditorModal } from './modals/TtlEditorModal'
import { RenameModal } from './modals/RenameModal'
import { ConfirmDialog } from './modals/ConfirmDialog'
import { TYPE_COLORS } from './constants'
import type { ConnBody } from '../../types'

type DecompAlgo = 'gzip' | 'deflate' | 'zstd' | 'lz4' | 'snappy'
const DECOMP_ALGOS: DecompAlgo[] = ['gzip', 'deflate', 'zstd', 'lz4', 'snappy']

function strToBytes(s: string): Uint8Array {
  try {
    const b64 = atob(s)
    return Uint8Array.from(b64, c => c.charCodeAt(0))
  } catch {
    return Uint8Array.from(s, c => c.charCodeAt(0) & 0xff)
  }
}

async function decompressValue(val: string, algo: DecompAlgo): Promise<string> {
  const bytes = strToBytes(val)
  let result: Uint8Array

  if (algo === 'gzip' || algo === 'deflate') {
    const ds = new DecompressionStream(algo)
    const writer = ds.writable.getWriter()
    const reader = ds.readable.getReader()
    writer.write(bytes as Uint8Array<ArrayBuffer>)
    writer.close()
    const chunks: Uint8Array[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value as Uint8Array)
    }
    const total = chunks.reduce((acc, c) => acc + c.length, 0)
    result = new Uint8Array(total)
    let off = 0
    for (const c of chunks) { result.set(c, off); off += c.length }
  } else if (algo === 'zstd') {
    result = zstdDecompress(bytes)
  } else if (algo === 'lz4') {
    const buf: Uint8Array = lz4.decompress(bytes)
    result = buf
  } else {
    result = new Uint8Array(Snappy.uncompress(bytes))
  }

  return new TextDecoder().decode(result)
}

interface KeyDetailProps {
  result: any
  connBody: ConnBody
  connectionId: string
  onRefresh: () => void
  onKeyDeleted: (key: string) => void
  onLog?: (entry: any) => void
  isFavorite?: boolean
  onToggleFavorite?: () => void
}

export function KeyDetail({ result, connBody, connectionId, onRefresh, onKeyDeleted, onLog, isFavorite, onToggleFavorite }: KeyDetailProps) {
  const { key, type, value, ttl } = result || {}

  const [editingString, setEditingString] = useState(false)
  const [stringVal, setStringVal] = useState(value || '')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showTtlEditor, setShowTtlEditor] = useState(false)
  const [showRename, setShowRename] = useState(false)
  const [saving, setSaving] = useState(false)
  const [hashField, setHashField] = useState('')
  const [hashValue, setHashValue] = useState('')
  const [listValue, setListValue] = useState('')
  const [listOp, setListOp] = useState('rpush')
  const [setMemberValue, setSetMemberValue] = useState('')
  const [zsetMember, setZsetMember] = useState('')
  const [zsetScore, setZsetScore] = useState('0')
  // stream state
  const [streamFields, setStreamFields] = useState([{ field: '', value: '' }])
  const [streamEntryId, setStreamEntryId] = useState('')
  const [streamGroups, setStreamGroups] = useState<any>(null)
  const [streamGroupsTab, setStreamGroupsTab] = useState<'entries' | 'groups'>('entries')
  const [loadingGroups, setLoadingGroups] = useState(false)
  // json state
  const [editingJson, setEditingJson] = useState(false)
  const [jsonValue, setJsonValue] = useState(value || '{}')
  // formatter state (string type only)
  type Formatter = 'auto' | 'json' | 'hex' | 'binary' | 'timestamp' | DecompAlgo
  const [formatter, setFormatter] = useState<Formatter>('auto')
  const [decompResult, setDecompResult] = useState<{ loading: boolean; text: string | null; error: string | null }>({ loading: false, text: null, error: null })
  const decompAbort = useRef(0)

  const liveTtl = useLiveTtl(ttl)

  const loadStreamGroups = async () => {
    setLoadingGroups(true)
    try {
      const res = await fetch(`/api/redis/${connectionId}/key/stream-groups`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...connBody, key }),
      })
      if (res.ok) setStreamGroups(await res.json())
    } catch (_) { /* ignore */ }
    finally { setLoadingGroups(false) }
  }

  useEffect(() => {
    if (type === 'stream' && streamGroupsTab === 'groups' && !streamGroups) {
      loadStreamGroups()
    }
  }, [streamGroupsTab, type])

  useEffect(() => {
    if (!(DECOMP_ALGOS as string[]).includes(formatter)) {
      setDecompResult({ loading: false, text: null, error: null })
      return
    }
    const id = ++decompAbort.current
    setDecompResult({ loading: true, text: null, error: null })
    decompressValue(value || '', formatter as DecompAlgo)
      .then(text => { if (decompAbort.current === id) setDecompResult({ loading: false, text, error: null }) })
      .catch(e => { if (decompAbort.current === id) setDecompResult({ loading: false, text: null, error: `Cannot decompress as ${formatter.toUpperCase()}: ${(e as Error).message || 'invalid data'}` }) })
  }, [formatter, value])

  if (!result) return null

  const handleExport = () => {
    const blob = new Blob([JSON.stringify({ key, type, ttl, value }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `${key.replace(/[^\w-]/g, '_')}.json`; a.click(); URL.revokeObjectURL(url)
  }

  const handleDeleteKey = async () => {
    try {
      const res = await fetch(`/api/redis/${connectionId}/key/delete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...connBody, key }),
      })
      if (!res.ok) throw new Error('Delete failed')
      setShowDeleteConfirm(false)
      if (onLog) onLog({ label: 'Deleted key', detail: `"${key}"` })
      onKeyDeleted(key)
    } catch (err) { alert((err as Error).message) }
  }

  const handleSaveString = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/redis/${connectionId}/key/set-string`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...connBody, key, value: stringVal, ttl: ttl > 0 ? ttl : -1 }),
      })
      if (!res.ok) throw new Error('Save failed')
      setEditingString(false)
      if (onLog) onLog({ label: 'Updated value', detail: `"${key}"`, oldValue: value ?? '', newValue: stringVal })
      onRefresh()
    } catch (err) { alert((err as Error).message) }
    finally { setSaving(false) }
  }

  const hashOp = async (field: string, val: string, op: string) => {
    try {
      await fetch(`/api/redis/${connectionId}/key/hash-field`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...connBody, key, field, value: val, operation: op }),
      })
      if (op === 'set') { setHashField(''); setHashValue('') }
      onRefresh()
    } catch (err) { alert((err as Error).message) }
  }

  const listOp_ = async (val: string, op: string) => {
    try {
      await fetch(`/api/redis/${connectionId}/key/list-op`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...connBody, key, value: val, operation: op }),
      })
      if (op !== 'lrem') setListValue('')
      onRefresh()
    } catch (err) { alert((err as Error).message) }
  }

  const setOp = async (val: string, op: string) => {
    try {
      await fetch(`/api/redis/${connectionId}/key/set-op`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...connBody, key, value: val, operation: op }),
      })
      if (op === 'add') setSetMemberValue('')
      onRefresh()
    } catch (err) { alert((err as Error).message) }
  }

  const zsetOp = async (member: string, scoreVal: number, op: string) => {
    try {
      await fetch(`/api/redis/${connectionId}/key/zset-op`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...connBody, key, member, score: scoreVal, operation: op }),
      })
      if (op === 'add') { setZsetMember(''); setZsetScore('0') }
      onRefresh()
    } catch (err) { alert((err as Error).message) }
  }

  const renderValue = () => {
    if (value === null || value === undefined) return <span className="value-null">null</span>

    if (type === 'string') {
      if (editingString) return (
        <div className="edit-string-area">
          <textarea className="form-textarea" value={stringVal} onChange={e => setStringVal(e.target.value)} rows={6} />
          <div className="edit-actions">
            <button className="btn-primary btn-sm" onClick={handleSaveString} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
            <button className="btn-secondary btn-sm" onClick={() => { setEditingString(false); setStringVal(value) }}>Cancel</button>
          </div>
        </div>
      )
      const FORMATTER_LABELS: Record<string, string> = {
        auto: 'Auto', json: 'JSON', hex: 'HEX', binary: 'Binary', timestamp: 'Timestamp',
        gzip: 'GZIP', deflate: 'Deflate', zstd: 'ZSTD', lz4: 'LZ4', snappy: 'Snappy',
      }
      const ALL_FORMATTERS: Formatter[] = ['auto', 'json', 'hex', 'binary', 'timestamp', 'gzip', 'deflate', 'zstd', 'lz4', 'snappy']
      return (
        <div>
          <div className="formatter-bar">
            {ALL_FORMATTERS.map(f => (
              <button key={f} className={`formatter-btn${formatter === f ? ' active' : ''}${(DECOMP_ALGOS as string[]).includes(f) ? ' formatter-btn-decomp' : ''}`} onClick={() => setFormatter(f)}>
                {FORMATTER_LABELS[f]}
              </button>
            ))}
          </div>
          {renderFormatted(value, formatter)}
        </div>
      )
    }

    if (type === 'hash') return (
      <div>
        <table className="value-table">
          <thead><tr><th>Field</th><th>Value</th><th style={{ width: 50 }}>Actions</th></tr></thead>
          <tbody>
            {Object.entries(value).map(([f, v]) => (
              <tr key={f}>
                <td className="field-key">{f}</td><td>{String(v)}</td>
                <td><button className="btn-delete-sm" onClick={() => hashOp(f, '', 'delete')} title="Delete field">✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="inline-add-form">
          <input className="form-input-sm" placeholder="field" value={hashField} onChange={e => setHashField(e.target.value)} />
          <input className="form-input-sm" placeholder="value" value={hashValue} onChange={e => setHashValue(e.target.value)} />
          <button className="btn-primary btn-sm" onClick={() => hashField.trim() && hashOp(hashField, hashValue, 'set')}>Add Field</button>
        </div>
      </div>
    )

    if (type === 'list') return (
      <div>
        <table className="value-table">
          <thead><tr><th>Index</th><th>Value</th><th style={{ width: 50 }}>Actions</th></tr></thead>
          <tbody>
            {[...value].map((v: string, i: number) => (
              <tr key={i}>
                <td className="field-key">{i}</td><td>{v}</td>
                <td><button className="btn-delete-sm" onClick={() => listOp_(v, 'lrem')} title="Remove">✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="inline-add-form">
          <select className="form-select-sm" value={listOp} onChange={e => setListOp(e.target.value)}>
            <option value="rpush">RPUSH (tail)</option><option value="lpush">LPUSH (head)</option>
          </select>
          <input className="form-input-sm" placeholder="value" value={listValue} onChange={e => setListValue(e.target.value)} />
          <button className="btn-primary btn-sm" onClick={() => listValue.trim() && listOp_(listValue, listOp)}>Add</button>
        </div>
      </div>
    )

    if (type === 'set') return (
      <div>
        <table className="value-table">
          <thead><tr><th>Member</th><th style={{ width: 50 }}>Actions</th></tr></thead>
          <tbody>
            {[...value].map((v: string, i: number) => (
              <tr key={i}>
                <td>{v}</td>
                <td><button className="btn-delete-sm" onClick={() => setOp(v, 'remove')} title="Remove">✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="inline-add-form">
          <input className="form-input-sm" placeholder="member" value={setMemberValue} onChange={e => setSetMemberValue(e.target.value)} />
          <button className="btn-primary btn-sm" onClick={() => setMemberValue.trim() && setOp(setMemberValue, 'add')}>Add Member</button>
        </div>
      </div>
    )

    if (type === 'zset') return (
      <div>
        <table className="value-table">
          <thead><tr><th>Score</th><th>Member</th><th style={{ width: 50 }}>Actions</th></tr></thead>
          <tbody>
            {value.map((entry: any, i: number) => (
              <tr key={i}>
                <td className="field-key">{entry.score}</td><td>{entry.member}</td>
                <td><button className="btn-delete-sm" onClick={() => zsetOp(entry.member, 0, 'remove')} title="Remove">✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="inline-add-form">
          <input className="form-input-sm" placeholder="member" value={zsetMember} onChange={e => setZsetMember(e.target.value)} />
          <input className="form-input-sm" placeholder="score" value={zsetScore} onChange={e => setZsetScore(e.target.value)} type="number" style={{ width: 80 }} />
          <button className="btn-primary btn-sm" onClick={() => zsetMember.trim() && zsetOp(zsetMember, parseFloat(zsetScore) || 0, 'add')}>Add</button>
        </div>
      </div>
    )

    if (type === 'stream') {
      const entries: Array<{ id: string; fields: Record<string, string> }> = value || []

      const handleStreamAdd = async () => {
        const validFields = streamFields.filter(f => f.field.trim())
        if (validFields.length === 0) return
        const fieldsMap: Record<string, string> = {}
        validFields.forEach(f => { fieldsMap[f.field] = f.value })
        try {
          const res = await fetch(`/api/redis/${connectionId}/key/stream-add`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...connBody, key, entryId: streamEntryId || '*', fields: fieldsMap }),
          })
          if (!res.ok) throw new Error('Failed to add entry')
          setStreamFields([{ field: '', value: '' }])
          setStreamEntryId('')
          onRefresh()
        } catch (err) { alert((err as Error).message) }
      }

      const handleStreamDel = async (entryId: string) => {
        try {
          await fetch(`/api/redis/${connectionId}/key/stream-del`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...connBody, key, entryId }),
          })
          onRefresh()
        } catch (err) { alert((err as Error).message) }
      }

      return (
        <div>
          <div className="stream-tab-bar">
            <button className={`stream-tab${streamGroupsTab === 'entries' ? ' active' : ''}`} onClick={() => setStreamGroupsTab('entries')}>Entries ({entries.length})</button>
            <button className={`stream-tab${streamGroupsTab === 'groups' ? ' active' : ''}`} onClick={() => { setStreamGroupsTab('groups'); if (!streamGroups) loadStreamGroups() }}>Consumer Groups</button>
          </div>

          {streamGroupsTab === 'entries' && (
            <div>
              <table className="value-table">
                <thead><tr><th style={{ width: 180 }}>Entry ID</th><th>Fields</th><th style={{ width: 50 }}>Del</th></tr></thead>
                <tbody>
                  {entries.map(entry => (
                    <tr key={entry.id}>
                      <td className="field-key" style={{ fontFamily: 'monospace', fontSize: 12 }}>{entry.id}</td>
                      <td>
                        <div className="stream-fields-inline">
                          {Object.entries(entry.fields || {}).map(([f, v]) => (
                            <span key={f} className="stream-field-chip"><span className="stream-field-name">{f}</span>: {v}</span>
                          ))}
                        </div>
                      </td>
                      <td><button className="btn-delete-sm" onClick={() => handleStreamDel(entry.id)} title="Delete entry">✕</button></td>
                    </tr>
                  ))}
                  {entries.length === 0 && <tr><td colSpan={3} style={{ color: '#888', textAlign: 'center' }}>Stream is empty</td></tr>}
                </tbody>
              </table>

              <div className="stream-add-form">
                <div className="stream-add-header">
                  <span>Add Entry</span>
                  <input className="form-input-sm" style={{ width: 180 }} placeholder="Entry ID (blank = auto)" value={streamEntryId} onChange={e => setStreamEntryId(e.target.value)} />
                </div>
                {streamFields.map((sf, idx) => (
                  <div key={idx} className="inline-add-form">
                    <input className="form-input-sm" placeholder="field" value={sf.field} onChange={e => { const n = [...streamFields]; n[idx].field = e.target.value; setStreamFields(n) }} />
                    <input className="form-input-sm" placeholder="value" value={sf.value} onChange={e => { const n = [...streamFields]; n[idx].value = e.target.value; setStreamFields(n) }} />
                    {streamFields.length > 1 && <button className="btn-delete-sm" onClick={() => setStreamFields(streamFields.filter((_, i) => i !== idx))}>✕</button>}
                  </div>
                ))}
                <div className="inline-add-form">
                  <button className="btn-secondary btn-sm" onClick={() => setStreamFields([...streamFields, { field: '', value: '' }])}>+ Field</button>
                  <button className="btn-primary btn-sm" onClick={handleStreamAdd}>Add Entry</button>
                </div>
              </div>
            </div>
          )}

          {streamGroupsTab === 'groups' && (
            <div>
              {loadingGroups && <div style={{ padding: 16, color: '#888' }}>Loading...</div>}
              {!loadingGroups && streamGroups && (
                streamGroups.groups.length === 0
                  ? <div style={{ padding: 16, color: '#888' }}>No consumer groups. Create one via CLI: <code>XGROUP CREATE {key} mygroup $ MKSTREAM</code></div>
                  : streamGroups.groups.map((g: any) => (
                    <div key={g.name} className="stream-group-block">
                      <div className="stream-group-header">
                        <strong>{g.name}</strong>
                        <span className="stream-group-meta">pending: {g['pending-count'] ?? g.pending ?? 0} · last-delivered: {g['last-delivered-id'] ?? '-'}</span>
                      </div>
                      {g.consumers && g.consumers.length > 0 && (
                        <table className="value-table" style={{ marginTop: 6 }}>
                          <thead><tr><th>Consumer</th><th>Pending</th><th>Idle (ms)</th></tr></thead>
                          <tbody>
                            {g.consumers.map((c: any) => (
                              <tr key={c.name}><td>{c.name}</td><td>{c.pending ?? 0}</td><td>{c.idle ?? '-'}</td></tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  ))
              )}
              <button className="btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={() => { setStreamGroups(null); loadStreamGroups() }}>↻ Refresh</button>
            </div>
          )}
        </div>
      )
    }

    if (type === 'json') {
      let parsedJson: any
      try { parsedJson = typeof value === 'string' ? JSON.parse(value) : value } catch (_) { parsedJson = value }

      const handleJsonSave = async () => {
        try {
          const res = await fetch(`/api/redis/${connectionId}/key/json-set`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...connBody, key, path: '$', value: jsonValue }),
          })
          const result = await res.json()
          if (!res.ok || result.error) throw new Error(result.error || 'Failed to save JSON')
          setEditingJson(false)
          if (onLog) onLog({ label: 'Updated JSON', detail: `"${key}"` })
          onRefresh()
        } catch (err) { alert((err as Error).message) }
      }

      if (editingJson) {
        return (
          <div className="edit-string-area">
            <textarea className="form-textarea" value={jsonValue} onChange={e => setJsonValue(e.target.value)} rows={10} spellCheck="false" style={{ fontFamily: 'monospace', fontSize: '12px' }} />
            <div className="edit-actions">
              <button className="btn-primary btn-sm" onClick={handleJsonSave}>Save</button>
              <button className="btn-secondary btn-sm" onClick={() => { setEditingJson(false); setJsonValue(value) }}>Cancel</button>
            </div>
          </div>
        )
      }

      return (
        <div className="json-viewer">
          <div className="json-tree">
            {renderJsonTree(parsedJson, '')}
          </div>
        </div>
      )
    }

    return <pre className="value-string">{JSON.stringify(value, null, 2)}</pre>
  }

  const renderJsonTree = (obj: any, path: string, depth: number = 0): JSX.Element => {
    if (obj === null) return <span className="json-null">null</span>
    if (typeof obj === 'boolean') return <span className="json-bool">{obj ? 'true' : 'false'}</span>
    if (typeof obj === 'number') return <span className="json-number">{obj}</span>
    if (typeof obj === 'string') return <span className="json-string">&quot;{obj}&quot;</span>
    if (Array.isArray(obj)) {
      return (
        <div className="json-array">
          <span className="json-bracket">[</span>
          {obj.length === 0 ? <span className="json-empty">(empty)</span> : (
            <div className="json-items">
              {obj.map((item, i) => (
                <div key={i} className="json-item">
                  <span className="json-index">[{i}]:</span> {renderJsonTree(item, `${path}[${i}]`, depth + 1)}
                </div>
              ))}
            </div>
          )}
          <span className="json-bracket">]</span>
        </div>
      )
    }
    if (typeof obj === 'object') {
      const keys = Object.keys(obj)
      return (
        <div className="json-object">
          <span className="json-bracket">{'{'}</span>
          {keys.length === 0 ? <span className="json-empty">(empty)</span> : (
            <div className="json-items">
              {keys.map((k, i) => (
                <div key={k} className="json-item">
                  <span className="json-key">&quot;{k}&quot;</span>: {renderJsonTree(obj[k], `${path}.${k}`, depth + 1)}
                </div>
              ))}
            </div>
          )}
          <span className="json-bracket">{'}'}</span>
        </div>
      )
    }
    return <span>{String(obj)}</span>
  }

  const renderFormatted = (val: string, fmt: Formatter): JSX.Element => {
    if (fmt === 'auto') return <pre className="value-string">{val}</pre>

    if (fmt === 'json') {
      try {
        const parsed = JSON.parse(val)
        return (
          <div className="json-viewer">
            <div className="json-tree">{renderJsonTree(parsed, '')}</div>
          </div>
        )
      } catch {
        return (
          <div>
            <div className="formatter-error">⚠ Not valid JSON</div>
            <pre className="value-string">{val}</pre>
          </div>
        )
      }
    }

    if (fmt === 'hex') {
      const bytes = Array.from(val).map(c => c.charCodeAt(0))
      const lines: JSX.Element[] = []
      for (let i = 0; i < bytes.length; i += 16) {
        const chunk = bytes.slice(i, i + 16)
        const offset = i.toString(16).padStart(8, '0')
        const hex = chunk.map(b => b.toString(16).padStart(2, '0')).join(' ')
        const ascii = chunk.map(b => (b >= 32 && b < 127) ? String.fromCharCode(b) : '.').join('')
        lines.push(
          <div key={i} className="hex-line">
            <span className="hex-offset">{offset}</span>
            <span className="hex-bytes">{hex.padEnd(47, ' ')}</span>
            <span className="hex-ascii">{ascii}</span>
          </div>
        )
      }
      return <div className="hex-dump">{lines.length ? lines : <span className="formatter-error">(empty)</span>}</div>
    }

    if (fmt === 'binary') {
      const binary = Array.from(val).map(c => c.charCodeAt(0).toString(2).padStart(8, '0')).join(' ')
      return <pre className="value-string formatter-binary">{binary || '(empty)'}</pre>
    }

    if (fmt === 'timestamp') {
      const num = Number(val)
      if (isNaN(num)) return (
        <div>
          <div className="formatter-error">⚠ Not a valid number</div>
          <pre className="value-string">{val}</pre>
        </div>
      )
      const asSeconds = num > 1e12 ? new Date(num) : new Date(num * 1000)
      return (
        <div className="timestamp-view">
          <table className="value-table">
            <tbody>
              <tr><td className="field-key">Raw value</td><td>{val}</td></tr>
              <tr><td className="field-key">ISO 8601</td><td>{asSeconds.toISOString()}</td></tr>
              <tr><td className="field-key">Local time</td><td>{asSeconds.toLocaleString()}</td></tr>
              <tr><td className="field-key">UTC</td><td>{asSeconds.toUTCString()}</td></tr>
              <tr><td className="field-key">Interpretation</td><td>{num > 1e12 ? 'milliseconds' : 'seconds'}</td></tr>
            </tbody>
          </table>
        </div>
      )
    }

    if ((DECOMP_ALGOS as string[]).includes(fmt)) {
      if (decompResult.loading) return <div className="formatter-loading">Decompressing...</div>
      if (decompResult.error) return (
        <div>
          <div className="formatter-error">⚠ {decompResult.error}</div>
          <pre className="value-string">{val}</pre>
        </div>
      )
      if (decompResult.text !== null) {
        try {
          const parsed = JSON.parse(decompResult.text)
          return (
            <div>
              <div className="formatter-decompressed-label">{fmt.toUpperCase()} → JSON</div>
              <div className="json-viewer"><div className="json-tree">{renderJsonTree(parsed, '')}</div></div>
            </div>
          )
        } catch {
          return (
            <div>
              <div className="formatter-decompressed-label">{fmt.toUpperCase()} decompressed</div>
              <pre className="value-string">{decompResult.text}</pre>
            </div>
          )
        }
      }
      return null
    }

    return <pre className="value-string">{val}</pre>
  }

  return (
    <div className="value-panel">
      <div className="value-header">
        <span className="value-key-name">{key}</span>
        <span className={`type-badge ${TYPE_COLORS[type] || ''}`}>{type}</span>
        <LiveTtl ttl={liveTtl} />
        {onToggleFavorite && (
          <button
            className={`btn-favorite-key${isFavorite ? ' btn-favorite-key--active' : ''}`}
            onClick={onToggleFavorite}
            title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            {isFavorite ? '★ Favorited' : '☆ Add to favorites'}
          </button>
        )}
        <button className="btn-ttl-edit" onClick={() => setShowTtlEditor(true)} title="Edit TTL">⏱ TTL</button>
        <button className="btn-export-key" onClick={handleExport} title="Export as JSON">⬇ Export</button>
        {(type === 'string' || type === 'json') && (
          <button className="btn-edit-key" onClick={() => {
            if (type === 'string') { setStringVal(value); setEditingString(true) }
            else { setJsonValue(value); setEditingJson(true) }
          }} title="Edit value">✏ Edit</button>
        )}
        <button className="btn-rename" onClick={() => setShowRename(true)} title="Rename key">✏ Rename</button>
        <button className="btn-refresh-sm" onClick={onRefresh} title="Refresh">↻</button>
        <button className="btn-delete-key" onClick={() => setShowDeleteConfirm(true)} title="Delete key">🗑</button>
      </div>
      {liveTtl > 0 && liveTtl < 60 ? (
        <div className="ttl-expiry-warning">⚠️ This key expires in less than 60 seconds!</div>
      ) : liveTtl === 0 || liveTtl === -2 ? (
        <div className="ttl-expiry-warning ttl-expired-banner">⚠️ This key has expired</div>
      ) : null}
      <div className="value-body">{renderValue()}</div>

      {showDeleteConfirm && (
        <ConfirmDialog message={`Are you sure you want to delete key "${key}"?`} onConfirm={handleDeleteKey} onCancel={() => setShowDeleteConfirm(false)} />
      )}
      {showTtlEditor && (
        <TtlEditorModal keyName={key} currentTtl={liveTtl} connBody={connBody} connectionId={connectionId}
          onClose={() => setShowTtlEditor(false)}
          onSuccess={(newTtl) => { setShowTtlEditor(false); if (onLog) onLog({ label: 'Set TTL', detail: `"${key}" → ${newTtl === -1 ? 'no expiry' : newTtl + 's'}` }); onRefresh() }} />
      )}
      {showRename && (
        <RenameModal keyName={key} connBody={connBody} connectionId={connectionId}
          onClose={() => setShowRename(false)}
          onSuccess={(newKey) => {
            setShowRename(false)
            if (onLog) onLog({
              label: 'Renamed key', detail: `"${key}" → "${newKey}"`,
              undo: async () => {
                const res = await fetch(`/api/redis/${connectionId}/key/rename`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ ...connBody, key: newKey, newKey: key }),
                })
                if (!res.ok) throw new Error('Rename undo failed')
              }
            })
            onKeyDeleted(key)
          }} />
      )}
    </div>
  )
}
