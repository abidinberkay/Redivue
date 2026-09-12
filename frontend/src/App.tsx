import { useState, useEffect, useCallback, useRef } from 'react'
import './App.css'
import ConnectionForm from './features/connections/ConnectionForm'
import Dashboard from './features/dashboard'
import { encryptPassword, decryptPassword } from './utils/encryption'
import type { Connection, HealthInfo, StoredConnection } from './types'
import { connBody } from './types'

const STORAGE_KEY = 'redivue_connections'
const SIDEBAR_WIDTH_KEY = 'redivue_sidebar_width'
const SIDEBAR_MIN_WIDTH = 200
const SIDEBAR_MAX_WIDTH = 560
const SIDEBAR_DEFAULT_WIDTH = 260

function loadSidebarWidth(): number {
  const raw = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY))
  if (!raw || Number.isNaN(raw)) return SIDEBAR_DEFAULT_WIDTH
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, raw))
}

/** Connection → slim, password-encrypted shape persisted to localStorage / exported to file. */
function toStored({
  id, name, host, port, password, db, authType, username, url, useTls,
  masterName, sentinelNodes, sentinelPassword, clusterNodes, socketPath,
  sshEnabled, sshHost, sshPort, sshUser, sshPassword, sshPrivateKey, sshPrivateKeyPassphrase,
  tlsSkipVerify, tlsCaCert, tlsClientCert, tlsClientKey,
}: Connection): StoredConnection {
  return {
    id,
    name,
    host,
    port,
    password: encryptPassword(password),
    db: db ?? 0,
    authType: authType ?? 'PASSWORD',
    username: username ?? null,
    url: url ?? null,
    useTls: useTls ?? false,
    masterName: masterName ?? null,
    sentinelNodes: sentinelNodes ?? null,
    sentinelPassword: encryptPassword(sentinelPassword ?? null),
    clusterNodes: clusterNodes ?? null,
    socketPath: socketPath ?? null,
    sshEnabled: sshEnabled ?? false,
    sshHost: sshHost ?? null,
    sshPort: sshPort ?? null,
    sshUser: sshUser ?? null,
    sshPassword: encryptPassword(sshPassword ?? null),
    sshPrivateKey: encryptPassword(sshPrivateKey ?? null),
    sshPrivateKeyPassphrase: encryptPassword(sshPrivateKeyPassphrase ?? null),
    tlsSkipVerify: tlsSkipVerify ?? false,
    tlsCaCert: tlsCaCert ?? null,
    tlsClientCert: tlsClientCert ?? null,
    tlsClientKey: encryptPassword(tlsClientKey ?? null),
  }
}

/** Stored/exported shape → live Connection (decrypts passwords). */
function fromStored(c: StoredConnection): Connection {
  return {
    ...c,
    password: decryptPassword(c.password) ?? c.password,
    sentinelPassword: c.sentinelPassword ? (decryptPassword(c.sentinelPassword) ?? c.sentinelPassword) : null,
    sshPassword: c.sshPassword ? (decryptPassword(c.sshPassword) ?? c.sshPassword) : null,
    sshPrivateKey: c.sshPrivateKey ? (decryptPassword(c.sshPrivateKey) ?? c.sshPrivateKey) : null,
    sshPrivateKeyPassphrase: c.sshPrivateKeyPassphrase ? (decryptPassword(c.sshPrivateKeyPassphrase) ?? c.sshPrivateKeyPassphrase) : null,
    tlsClientKey: c.tlsClientKey ? (decryptPassword(c.tlsClientKey) ?? c.tlsClientKey) : null,
    connected: false,
    stats: null,
  }
}

function loadFromStorage(): Connection[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw).map(fromStored)
  } catch {
    return []
  }
}

function saveToStorage(connections: Connection[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(connections.map(toStored)))
  } catch { /* ignore */ }
}

// Fields never written to an exported file unless the user explicitly opts in
const SECRET_FIELDS = ['password', 'sentinelPassword', 'sshPassword', 'sshPrivateKey', 'sshPrivateKeyPassphrase', 'tlsClientKey'] as const

function App() {
  const [connections, setConnections] = useState<Connection[]>(loadFromStorage)
  const [selectedConnection, setSelectedConnection] = useState<Connection | null>(null)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [showExportBox, setShowExportBox] = useState(false)
  const [exportIncludeSecrets, setExportIncludeSecrets] = useState(false)
  const [importMessage, setImportMessage] = useState('')
  const [healthMap, setHealthMap] = useState<Record<number, HealthInfo>>({})
  const abortControllerRef = useRef<Record<number, AbortController>>({})
  const importFileRef = useRef<HTMLInputElement>(null)
  const [sidebarWidth, setSidebarWidth] = useState<number>(loadSidebarWidth)
  const [resizingSidebar, setResizingSidebar] = useState(false)

  const refetchHealth = useCallback(async (conn: Connection) => {
    if (!conn) return
    if (abortControllerRef.current[conn.id]) {
      abortControllerRef.current[conn.id].abort()
    }
    abortControllerRef.current[conn.id] = new AbortController()

    try {
      const res = await fetch(`/api/redis/${conn.id}/stats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(connBody(conn)),
        signal: abortControllerRef.current[conn.id].signal,
      })
      if (!res.ok) throw new Error()
      const data = await res.json()
      setHealthMap(prev => ({ ...prev, [conn.id]: { status: 'ok', keyCount: data.totalKeys } }))
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setHealthMap(prev => ({ ...prev, [conn.id]: { status: 'error', keyCount: null } }))
      }
    }
  }, [])

  const checkHealth = useCallback((conn: Connection) => {
    setHealthMap(prev => ({ ...prev, [conn.id]: { status: 'checking', keyCount: prev[conn.id]?.keyCount ?? null } }))
    refetchHealth(conn)
  }, [refetchHealth])

  useEffect(() => {
    const stored = loadFromStorage()
    if (stored.length > 0) {
      stored.forEach(conn => checkHealth(conn))
    }
  }, [checkHealth])

  const addConnection = (connection: Omit<Connection, 'id'>) => {
    const newConn: Connection = { id: Date.now(), ...connection, connected: false, stats: null }
    setConnections(prev => {
      const updated = [...prev, newConn]
      saveToStorage(updated)
      return updated
    })
    setSelectedConnection(newConn)
    checkHealth(newConn)
  }

  const removeConnection = (e: React.MouseEvent, id: number) => {
    e.stopPropagation()
    setConnections(prev => {
      const updated = prev.filter(c => c.id !== id)
      saveToStorage(updated)
      return updated
    })
    setSelectedConnection(prev => prev?.id === id ? null : prev)
  }

  const clearAllConnections = () => {
    setConnections([])
    setSelectedConnection(null)
    localStorage.removeItem(STORAGE_KEY)
    setShowClearConfirm(false)
  }

  // Downloads the current connection list as a JSON file. Secrets (passwords, keys) are
  // stripped by default — exportIncludeSecrets is an explicit opt-in since the file lands
  // on disk in plaintext (localStorage's XOR+base64 "encryption" is trivially reversible,
  // not real protection).
  const exportConnections = async () => {
    if (connections.length === 0) return
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      connections: connections.map(c => {
        const stored = toStored(c) as Record<string, unknown>
        if (!exportIncludeSecrets) {
          SECRET_FIELDS.forEach(f => { stored[f] = null })
        }
        return stored
      }),
    }
    const json = JSON.stringify(data, null, 2)
    const filename = `redivue-connections-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`

    // Chromium browsers: let the user pick where to save (e.g. Desktop) via a native dialog.
    const picker = (window as any).showSaveFilePicker
    if (picker) {
      try {
        const handle = await picker({
          suggestedName: filename,
          types: [{ description: 'JSON file', accept: { 'application/json': ['.json'] } }],
        })
        const writable = await handle.createWritable()
        await writable.write(json)
        await writable.close()
        setShowExportBox(false)
        return
      } catch (err) {
        if ((err as Error).name === 'AbortError') return // user cancelled the dialog
        // fall through to the download-link fallback below
      }
    }

    // Fallback (Firefox/Safari, or picker failure): triggers the browser's own save-as/download prompt.
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
    setShowExportBox(false)
  }

  const importConnections = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file later
    if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const content = evt.target?.result as string
        const data = JSON.parse(content)
        const rawList: StoredConnection[] = Array.isArray(data.connections) ? data.connections : Array.isArray(data) ? data : []
        // Reassign ids so imported entries never collide with existing ones; skip malformed entries.
        const imported: Connection[] = []
        rawList.forEach((c, i) => {
          if (!c || typeof c.host !== 'string' || !c.host || typeof c.port !== 'number') return
          imported.push(fromStored({ ...c, id: Date.now() + i }))
        })
        if (imported.length === 0) {
          setImportMessage('No valid connections found in file')
        } else {
          setConnections(prev => {
            const updated = [...prev, ...imported]
            saveToStorage(updated)
            return updated
          })
          imported.forEach(checkHealth)
          const skipped = rawList.length - imported.length
          setImportMessage(`Imported ${imported.length} connection${imported.length !== 1 ? 's' : ''}${skipped > 0 ? `, skipped ${skipped} invalid` : ''}`)
        }
      } catch {
        setImportMessage('Failed to read file — not valid JSON')
      }
      setTimeout(() => setImportMessage(''), 5000)
    }
    reader.readAsText(file)
  }

  const changeDb = (connId: number, db: number) => {
    setConnections(prev => {
      const updated = prev.map(c => c.id === connId ? { ...c, db } : c)
      saveToStorage(updated)
      return updated
    })
    setSelectedConnection(prev => prev?.id === connId ? { ...prev, db } : prev)
  }

  // Called by Dashboard after its own fetchStats succeeds — updates sidebar key count without an extra request
  const updateKeyCount = useCallback((connId: number, keyCount: number) => {
    setHealthMap(prev => ({
      ...prev,
      [connId]: { status: 'ok', keyCount },
    }))
  }, [])

  const startSidebarResize = (e: React.MouseEvent) => {
    e.preventDefault()
    setResizingSidebar(true)
  }

  useEffect(() => {
    if (!resizingSidebar) return

    const onMouseMove = (e: MouseEvent) => {
      const next = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, e.clientX))
      setSidebarWidth(next)
    }
    const onMouseUp = () => setResizingSidebar(false)

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    document.body.classList.add('sidebar-resizing')
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.classList.remove('sidebar-resizing')
    }
  }, [resizingSidebar])

  // Persist once the drag ends rather than on every mousemove.
  useEffect(() => {
    if (!resizingSidebar) localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth))
  }, [resizingSidebar, sidebarWidth])

  return (
    <div className="app">
      <header className="header">
        <h1>Redivue</h1>
        <p>Multi-Redis Dashboard</p>
      </header>

      <main className="main-container">
        <aside className="sidebar" style={{ width: sidebarWidth }}>
          <ConnectionForm onAddConnection={addConnection} />

          <div className="connections-list">
            <div className="connections-list-header">
              <h3>Connections</h3>
              <div className="connections-header-actions">
                <button
                  className="conn-io-btn"
                  onClick={() => setShowExportBox(v => !v)}
                  disabled={connections.length === 0}
                  title="Export connections as JSON"
                >⬇</button>
                <button
                  className="conn-io-btn"
                  onClick={() => importFileRef.current?.click()}
                  title="Import connections from JSON"
                >⬆</button>
                <input
                  ref={importFileRef}
                  type="file"
                  accept=".json"
                  onChange={importConnections}
                  style={{ display: 'none' }}
                />

                {connections.length > 0 && (
                  <button
                    className="clear-all-btn"
                    onClick={() => setShowClearConfirm(true)}
                    title="Remove all connections"
                  >
                    Clear all
                  </button>
                )}
              </div>
            </div>

            {importMessage && (
              <div className="import-status-box">{importMessage}</div>
            )}

            {showExportBox && (
              <div className="clear-confirm-box">
                <label className="export-secrets-label">
                  <input
                    type="checkbox"
                    checked={exportIncludeSecrets}
                    onChange={e => setExportIncludeSecrets(e.target.checked)}
                  />
                  Include passwords &amp; secrets (saved as plaintext in the file)
                </label>
                <div className="clear-confirm-actions">
                  <button className="confirm-yes-btn" onClick={exportConnections}>Download</button>
                  <button className="confirm-no-btn" onClick={() => setShowExportBox(false)}>Cancel</button>
                </div>
              </div>
            )}

            {showClearConfirm && (
              <div className="clear-confirm-box">
                <p>Remove all saved connections?</p>
                <div className="clear-confirm-actions">
                  <button className="confirm-yes-btn" onClick={clearAllConnections}>Remove all</button>
                  <button className="confirm-no-btn" onClick={() => setShowClearConfirm(false)}>Cancel</button>
                </div>
              </div>
            )}

            {connections.length === 0 ? (
              <p className="no-connections">No connections yet</p>
            ) : (
              <ul>
                {connections.map((conn) => {
                  const health = healthMap[conn.id]
                  const dotClass = health?.status === 'ok' ? 'status-dot status-dot-ok'
                    : health?.status === 'error' ? 'status-dot status-dot-error'
                    : 'status-dot status-dot-checking'
                  return (
                    <li
                      key={conn.id}
                      className={`connection-item ${selectedConnection?.id === conn.id ? 'active' : ''}`}
                      onClick={() => setSelectedConnection(conn)}
                    >
                      <span className={dotClass} title={health?.status === 'ok' ? 'Connected' : health?.status === 'error' ? 'Unreachable' : 'Checking...'}></span>
                      <span className="connection-name">{
                        conn.name ||
                        (conn.authType === 'URL' ? conn.url :
                        conn.authType === 'SENTINEL' ? `sentinel/${conn.masterName}` :
                        conn.authType === 'CLUSTER' ? `cluster` :
                        conn.authType === 'SOCKET' ? conn.socketPath :
                        `${conn.host}:${conn.port}`)
                      }</span>
                      {health?.status === 'ok' && health.keyCount != null && (
                        <span className="conn-key-count" title="Total keys">{health.keyCount.toLocaleString()}</span>
                      )}
                      <select
                        className="conn-db-select"
                        value={conn.db ?? 0}
                        title="Select database"
                        onClick={e => e.stopPropagation()}
                        onChange={e => changeDb(conn.id, parseInt(e.target.value))}
                      >
                        {Array.from({ length: 16 }, (_, i) => (
                          <option key={i} value={i}>DB {i}</option>
                        ))}
                      </select>
                      <button
                        className="remove-conn-btn"
                        onClick={(e) => removeConnection(e, conn.id)}
                        title="Remove connection"
                      >
                        ×
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </aside>

        <div
          className={`sidebar-resize-handle${resizingSidebar ? ' active' : ''}`}
          onMouseDown={startSidebarResize}
          title="Drag to resize"
        />

        <section className="dashboard-area">
          {connections.map(conn => (
            <div
              key={conn.id}
              style={{
                display: selectedConnection?.id === conn.id ? 'flex' : 'none',
                flexDirection: 'column',
                flex: 1,
                minHeight: 0,
                overflow: 'hidden',
              }}
            >
              <Dashboard connection={conn} onRefreshHealth={refetchHealth} onChangeDb={changeDb} onKeyCountUpdate={updateKeyCount} />
            </div>
          ))}
          {!selectedConnection && (
            <div className="placeholder">
              <p>Add a connection and select it to view data</p>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

export default App
