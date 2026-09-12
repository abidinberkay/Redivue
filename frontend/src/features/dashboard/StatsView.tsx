import { useState, useEffect, useRef } from 'react'
import { StatCard, StatRow, EditableStatRow, ToggleStatRow, TOOLTIPS } from './StatCards'
import type { RedisStats, ConnBody } from '../../types'

const AUTO_REFRESH_OPTIONS = [5, 10, 30, 60]

function MaxMemoryModal({ currentValue, onClose, onSave }: { currentValue: string; onClose: () => void; onSave: (val: string) => Promise<void> }) {
  const [input, setInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const PRESETS = [
    { label: '256mb', value: '256mb' }, { label: '512mb', value: '512mb' },
    { label: '1gb', value: '1gb' }, { label: '2gb', value: '2gb' },
    { label: '4gb', value: '4gb' }, { label: '8gb', value: '8gb' },
    { label: '16gb', value: '16gb' }, { label: 'Unlimited', value: '0' },
  ]

  const apply = async (val: string) => {
    setSaving(true); setErr('')
    try { await onSave(val); onClose() }
    catch (e) { setErr((e as Error).message) }
    finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-box modal-wide">
        <h3 className="modal-title">Set Max Memory</h3>
        <div className="mm-current">Current value: <span className="mm-current-val">{currentValue}</span></div>
        <div className="mm-info">
          <p>Controls how much RAM Redis can use. When the limit is reached, Redis applies the configured eviction policy (<code>maxmemory-policy</code>) to free space.</p>
          <div className="mm-syntax-box">
            <div className="mm-syntax-title">Format</div>
            <code>{'<number><unit>'}</code> — e.g. <code>512mb</code>, <code>1.5gb</code>, <code>256000kb</code>
            <div className="mm-units">
              <span><code>b</code> bytes</span><span><code>kb</code> kilobytes</span>
              <span><code>mb</code> megabytes</span><span><code>gb</code> gigabytes</span>
            </div>
          </div>
          <div className="mm-unlimited-note">
            <strong>To remove the limit:</strong> set to <code>0</code> — Redis will use as much memory as the OS allows.
          </div>
        </div>
        {err && <div className="modal-error">{err}</div>}
        <div className="mm-presets">
          {PRESETS.map(p => (
            <button key={p.value} className={`mm-preset-btn${p.value === '0' ? ' mm-preset-unlimited' : ''}`} onClick={() => apply(p.value)} disabled={saving}>{p.label}</button>
          ))}
        </div>
        <div className="ttl-custom-row" style={{ marginTop: 12 }}>
          <input className="form-input" value={input} placeholder="Custom value, e.g. 1.5gb or 768mb" onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && input.trim() && apply(input.trim())} />
          <button className="btn-primary" onClick={() => apply(input.trim())} disabled={saving || !input.trim()}>{saving ? 'Saving...' : 'Set'}</button>
        </div>
        <div className="modal-actions" style={{ marginTop: 16 }}>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

function AofModal({ currentValue, onClose, onToggle, loading }: { currentValue: boolean; onClose: () => void; onToggle: () => void; loading: boolean }) {
  return (
    <div className="modal-overlay">
      <div className="modal-box modal-wide">
        <h3 className="modal-title">AOF — Append-Only File</h3>
        <div className="mm-current">
          Current status:{' '}
          <span className={currentValue ? 'aof-status-on' : 'aof-status-off'}>{currentValue ? 'Enabled' : 'Disabled'}</span>
        </div>
        <div className="mm-info">
          <p><strong>AOF enabled:</strong> Redis logs every write operation to an append-only file on disk. Maximum data safety — you lose at most 1 second of writes.</p>
          <p><strong>AOF disabled:</strong> Only RDB snapshots are used. Data written after the last snapshot will be lost on a crash.</p>
          <div className="mm-unlimited-note" style={{ borderColor: '#e3b34144', background: '#1a1600' }}>
            <strong>⚠ Performance note:</strong> Enabling AOF adds disk I/O on every write.
          </div>
        </div>
        <div className="modal-actions" style={{ marginTop: 16 }}>
          <button className={currentValue ? 'btn-danger' : 'btn-primary'} onClick={onToggle} disabled={loading}>
            {loading ? 'Saving...' : currentValue ? 'Disable AOF' : 'Enable AOF'}
          </button>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

export function StatsView({ stats, loading, onRefresh, onLog, connectionId, connBody }: {
  stats: RedisStats | null; loading: boolean; onRefresh: () => void;
  onLog: (entry: any) => void; connectionId: string; connBody: ConnBody
}) {
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [interval, setInterval_] = useState(10)
  const [countdown, setCountdown] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [configLoading, setConfigLoading] = useState(false)
  const [showMaxMemoryModal, setShowMaxMemoryModal] = useState(false)
  const [showAofModal, setShowAofModal] = useState(false)

  const startAutoRefresh = (secs: number) => {
    clearInterval(timerRef.current!); clearInterval(countdownRef.current!)
    setCountdown(secs)
    timerRef.current = setInterval(() => { onRefresh(); setCountdown(secs) }, secs * 1000)
    countdownRef.current = setInterval(() => { setCountdown(prev => (prev <= 1 ? secs : prev - 1)) }, 1000)
  }

  useEffect(() => {
    if (autoRefresh) { startAutoRefresh(interval) }
    else { clearInterval(timerRef.current!); clearInterval(countdownRef.current!); setCountdown(0) }
    return () => { clearInterval(timerRef.current!); clearInterval(countdownRef.current!) }
  }, [autoRefresh, interval])

  const configSet = async (param: string, value: string) => {
    setConfigLoading(true)
    try {
      const res = await fetch(`/api/redis/${connectionId}/config/set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...connBody, param, value }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Config set failed') }
      onRefresh()
    } finally { setConfigLoading(false) }
  }

  const handleMaxMemorySave = async (v: string) => {
    const oldValue = stats!.maxMemory
    await configSet('maxmemory', v)
    onLog({ label: 'Max Memory changed', detail: `${oldValue} → ${v === '0' ? 'unlimited' : v}` })
  }

  const handleAofToggle = async () => {
    const wasEnabled = stats!.aofEnabled
    const oldVal = wasEnabled ? 'yes' : 'no'
    const newVal = wasEnabled ? 'no' : 'yes'
    await configSet('appendonly', newVal)
    onLog({
      label: 'AOF toggled',
      detail: `${wasEnabled ? 'Enabled' : 'Disabled'} → ${!wasEnabled ? 'Enabled' : 'Disabled'}`,
      undo: async () => {
        const res = await fetch(`/api/redis/${connectionId}/config/set`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...connBody, param: 'appendonly', value: oldVal }),
        })
        if (!res.ok) throw new Error('Undo failed')
        onRefresh()
      }
    })
  }

  if (!stats && !loading) return null
  if (loading && !stats) return <div className="loading">Loading stats...</div>

  return (
    <div className="stats-view">
      <div className="stats-refresh-bar">
        <label className="auto-refresh-toggle">
          <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
          Auto-refresh
        </label>
        {autoRefresh && (
          <>
            <div className="refresh-interval-btns">
              {AUTO_REFRESH_OPTIONS.map(s => (
                <button key={s} className={`interval-btn${interval === s ? ' active' : ''}`} onClick={() => setInterval_(s)}>{s}s</button>
              ))}
            </div>
            <span className="refresh-countdown">next in {countdown}s</span>
          </>
        )}
        {loading && <span className="stats-refreshing">Refreshing...</span>}
      </div>

      <div className="stats-grid">
        <StatCard label="Memory Used" value={stats!.memoryUsed} sub={`Peak: ${stats!.usedMemoryPeak} · Max: ${stats!.maxMemory}`} />
        <StatCard label={<>Total Keys <span className="stat-label-highlight">(DB {connBody.db})</span></>} value={stats!.totalKeys.toLocaleString()} />
        <StatCard label="Ops / sec" value={stats!.opsPerSec.toLocaleString()} accent />
        <StatCard label="Hit Rate" value={stats!.hitRate} accent />
      </div>

      <div className="stats-sections">
        <div className="stats-section">
          <div className="stats-section-title">Server</div>
          <StatRow label="Redis Version" value={stats!.redisVersion} />
          <StatRow label="Role" value={stats!.role} highlight={stats!.role === 'master'} />
          <StatRow label="Uptime" value={stats!.uptime} />
          <StatRow label="Connected Clients" value={stats!.connectedClients} />
          <StatRow label="Total Connections" value={stats!.totalConnectionsReceived?.toLocaleString()} />
        </div>
        <div className="stats-section">
          <div className="stats-section-title">Performance</div>
          <StatRow label="Ops / sec" value={stats!.opsPerSec} />
          <StatRow label="Keyspace Hit Rate" value={stats!.hitRate} highlight />
          <StatRow label="Total Commands" value={stats!.totalCommandsProcessed?.toLocaleString()} />
        </div>
        <div className="stats-section">
          <div className="stats-section-title">Memory</div>
          <StatRow label="Used Memory" value={stats!.memoryUsed} />
          <StatRow label="Peak Memory" value={stats!.usedMemoryPeak} />
          <EditableStatRow label="Max Memory" value={stats!.maxMemory} tooltip={TOOLTIPS['Max Memory']} onEdit={() => setShowMaxMemoryModal(true)} />
          <StatRow label="Fragmentation Ratio" value={stats!.memFragmentationRatio} highlight={parseFloat(String(stats!.memFragmentationRatio)) > 1.5} />
        </div>
        <div className="stats-section">
          <div className="stats-section-title">Persistence</div>
          <StatRow label="RDB Last Save" value={stats!.rdbLastBgsaveStatus} highlight={stats!.rdbLastBgsaveStatus === 'ok'} />
          <ToggleStatRow label="AOF" value={stats!.aofEnabled} onEdit={() => setShowAofModal(true)} tooltip={TOOLTIPS['AOF']} />
        </div>
      </div>

      {showMaxMemoryModal && <MaxMemoryModal currentValue={stats!.maxMemory} onClose={() => setShowMaxMemoryModal(false)} onSave={handleMaxMemorySave} />}
      {showAofModal && <AofModal currentValue={stats!.aofEnabled} onClose={() => setShowAofModal(false)} loading={configLoading} onToggle={async () => { await handleAofToggle(); setShowAofModal(false) }} />}
    </div>
  )
}
