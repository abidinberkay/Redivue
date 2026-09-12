import { useState, useEffect, useCallback, useRef } from 'react'
import './Dashboard.css'
import KeysBrowser from '../keys'
import { MultiCliConsole } from '../cli/MultiCliConsole'
import MonitorView from '../monitor/MonitorView'
import MigrationView from '../migration/MigrationView'
import MemoryView from '../memory/MemoryView'
import PubSubView from '../pubsub/PubSubView'
import KeyDiffView from '../keydiff/KeyDiffView'
import KeyspaceView from '../keyspace/KeyspaceView'
import { StatsView } from './StatsView'
import { ConfigView } from './ConfigView'
import { ActivityPanel } from './ActivityPanel'
import type { Connection, ConnBody, RedisStats } from '../../types'
import { connBody as buildConnBody } from '../../types'

export default function Dashboard({ connection, onRefreshHealth, onChangeDb, onKeyCountUpdate }: {
  connection: Connection
  onRefreshHealth: (conn: Connection) => void
  onChangeDb?: (connId: number, db: number) => void
  onKeyCountUpdate?: (connId: number, keyCount: number) => void
}) {
  const [stats, setStats] = useState<RedisStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState('stats')
  const [activityLog, setActivityLog] = useState<any[]>([])
  const [showActivityPanel, setShowActivityPanel] = useState(false)

  const connBody: ConnBody = buildConnBody(connection)

  // Always-current ref so fetchStats never closes over a stale connBody
  const connBodyRef = useRef(connBody)
  connBodyRef.current = connBody

  const addLog = useCallback((entry: any) => {
    setActivityLog(prev => [{ id: Date.now(), ts: new Date(), undone: false, ...entry }, ...prev].slice(0, 100))
    setShowActivityPanel(true)
  }, [])

  const markUndone = useCallback((id: number) => {
    setActivityLog(prev => prev.map(e => e.id === id ? { ...e, undone: true, undo: null } : e))
  }, [])

  const fetchStats = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/redis/${connection.id}/stats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(connBodyRef.current),  // always reads latest db
        signal,
      })
      if (!response.ok) throw new Error('Failed to fetch stats')
      const data = await response.json()
      // guard: skip if this request was superseded by a newer one
      if (signal?.aborted) return
      setStats(data)
      onKeyCountUpdate?.(connection.id, data.totalKeys)
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setError((err as Error).message)
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [connection.id, onKeyCountUpdate])

  useEffect(() => {
    setStats(null)
    const controller = new AbortController()
    fetchStats(controller.signal)
    return () => controller.abort()
  }, [connection.id, connection.db, fetchStats])

  const TABS = ['stats','keys','cli','monitor','config','migration','memory','pubsub','diff','keyspace'] as const
  type Tab = typeof TABS[number]

  const tabLabel = (tab: Tab) => {
    if (tab === 'pubsub') return 'Pub/Sub'
    if (tab === 'diff') return 'Key Diff'
    if (tab === 'keyspace') return 'Notifications'
    return tab.charAt(0).toUpperCase() + tab.slice(1)
  }

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>
          {connection.name || `${connection.host}:${connection.port}`}
          <span className="dashboard-db-badge">DB {connection.db ?? 0}</span>
        </h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => fetchStats()} disabled={loading} className="refresh-btn">
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
          <button
            className={`activity-toggle-btn${showActivityPanel ? ' active' : ''}`}
            onClick={() => setShowActivityPanel(p => !p)}
            title="Toggle activity log"
          >
            Activity{activityLog.length > 0 ? ` (${activityLog.length})` : ''}
          </button>
        </div>
      </div>

      {error && <div className="error-alert">{error}</div>}

      <div className="dashboard-body">
        <div className="dashboard-main">
          <div className="tabs">
            {TABS.map(tab => (
              <button key={tab} className={`tab-btn ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>
                {tabLabel(tab)}
              </button>
            ))}
          </div>

          <div className="tab-content" style={{ display: activeTab === 'stats' ? 'block' : 'none' }}>
            <StatsView stats={stats} loading={loading} onRefresh={fetchStats} onLog={addLog} connectionId={String(connection.id)} connBody={connBody} />
          </div>

          <div className="tab-content keys-tab-content" style={{ display: activeTab === 'keys' ? 'flex' : 'none' }}>
            <KeysBrowser connection={connection} onLog={addLog} onRefreshHealth={onRefreshHealth} />
          </div>

          <div className="tab-content cli-tab-content" style={{ display: activeTab === 'cli' ? 'flex' : 'none', flexDirection: 'column', overflow: 'hidden' }}>
            <MultiCliConsole connection={connection} onLog={addLog} />
          </div>

          <div className="tab-content" style={{ display: activeTab === 'monitor' ? 'block' : 'none' }}>
            <MonitorView connection={connection} onLog={addLog} />
          </div>

          <div className="tab-content config-tab-content" style={{ display: activeTab === 'config' ? 'flex' : 'none' }}>
            <ConfigView connectionId={String(connection.id)} connBody={connBody} active={activeTab === 'config'} onLog={addLog} />
          </div>

          <div className="tab-content" style={{ display: activeTab === 'migration' ? 'flex' : 'none', flexDirection: 'column', overflow: 'hidden' }}>
            <MigrationView connection={connection} onLog={addLog} onRefreshHealth={onRefreshHealth} />
          </div>

          <div className="tab-content" style={{ display: activeTab === 'memory' ? 'flex' : 'none', flexDirection: 'column', overflow: 'hidden' }}>
            <MemoryView connection={connection} onLog={addLog} />
          </div>

          <div className="tab-content" style={{ display: activeTab === 'pubsub' ? 'flex' : 'none', flexDirection: 'column', overflow: 'hidden' }}>
            <PubSubView connection={connection} onLog={addLog} />
          </div>

          <div className="tab-content" style={{ display: activeTab === 'diff' ? 'flex' : 'none', flexDirection: 'column', overflow: 'hidden' }}>
            <KeyDiffView connection={connection} onChangeDb={onChangeDb} onLog={addLog} />
          </div>

          <div className="tab-content" style={{ display: activeTab === 'keyspace' ? 'flex' : 'none', flexDirection: 'column', overflow: 'hidden' }}>
            <KeyspaceView connection={connection} onLog={addLog} />
          </div>
        </div>

        {showActivityPanel && (
          <ActivityPanel log={activityLog} onMarkUndone={markUndone} onClear={() => setActivityLog([])} />
        )}
      </div>
    </div>
  )
}
