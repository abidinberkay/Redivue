import { useState, useCallback, useEffect, useRef } from 'react'
import './KeysBrowser.css'
import { KeyDetail } from './KeyDetail'
import { AddKeyModal } from './modals/AddKeyModal'
import { BulkDeleteModal } from './modals/BulkDeleteModal'
import { BulkTtlModal } from './modals/BulkTtlModal'
import { CopyToModal } from './modals/CopyToModal'
import { FlushDbModal } from './modals/FlushDbModal'
import { PatternDeleteModal } from './modals/PatternDeleteModal'
import { TYPE_COLORS } from './constants'
import { formatTtl } from './hooks/useLiveTtl'
import type { Connection, ConnBody, KeyItem } from '../../types'
import { connBody as buildConnBody } from '../../types'

export default function KeysBrowser({ connection, onLog, onRefreshHealth }: {
  connection: Connection
  onLog?: (entry: any) => void
  onRefreshHealth?: (conn: Connection) => void
}) {
  const [pattern, setPattern] = useState('*')
  const [inputPattern, setInputPattern] = useState('*')
  const [keys, setKeys] = useState<KeyItem[]>([])
  const [cursor, setCursor] = useState('0')
  const [done, setDone] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [keyValue, setKeyValue] = useState<any>(null)
  const [scanning, setScanning] = useState(false)
  const [loadingValue, setLoadingValue] = useState(false)
  const [error, setError] = useState('')
  const [showAddKey, setShowAddKey] = useState(false)
  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(new Set())
  const [showBulkTtl, setShowBulkTtl] = useState(false)
  const [showBulkDelete, setShowBulkDelete] = useState(false)
  const [deletingBulk, setDeletingBulk] = useState(false)
  const [bulkDeleteError, setBulkDeleteError] = useState('')
  const [showPatternDelete, setShowPatternDelete] = useState(false)
  const [showFlushDb, setShowFlushDb] = useState(false)
  const [showCopyTo, setShowCopyTo] = useState(false)
  const [pendingScanPattern, setPendingScanPattern] = useState<string | null>(null)
  const [exportLoading, setExportLoading] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  const [exportTotal, setExportTotal] = useState(0)
  const [history, setHistory] = useState<string[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [favorites, setFavorites] = useState<Set<string>>(new Set())
  const [showFavoritesDropdown, setShowFavoritesDropdown] = useState(false)
  const [viewMode, setViewMode] = useState<'list' | 'tree'>('list')
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())
  const scanAbortRef = useRef<AbortController | null>(null)
  const historyDropdownRef = useRef<HTMLDivElement>(null)
  const favDropdownRef = useRef<HTMLDivElement>(null)
  const importFileRef = useRef<HTMLInputElement>(null)

  const connBody: ConnBody = buildConnBody(connection)

  const formatSize = (bytes?: number): string => {
    if (bytes == null) return '—'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  // --- Tree View ---
  interface TreeNode {
    name: string
    fullPath: string
    fullKey?: string
    type?: string
    ttl?: number
    memoryBytes?: number
    isLeaf: boolean
    children: Map<string, TreeNode>
  }

  const buildTree = (keyList: KeyItem[]): TreeNode => {
    const root: TreeNode = { name: '', fullPath: '', isLeaf: false, children: new Map() }
    for (const k of keyList) {
      const parts = k.key.split(':')
      let node = root
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]
        const path = parts.slice(0, i + 1).join(':')
        if (!node.children.has(part)) {
          node.children.set(part, { name: part, fullPath: path, isLeaf: false, children: new Map() })
        }
        node = node.children.get(part)!
      }
      node.isLeaf = true
      node.fullKey = k.key
      node.type = k.type
      node.ttl = k.ttl
      node.memoryBytes = k.memoryBytes
    }
    return root
  }

  const countLeaves = (node: TreeNode): number => {
    if (node.isLeaf && node.children.size === 0) return 1
    let total = node.isLeaf ? 1 : 0
    for (const child of node.children.values()) total += countLeaves(child)
    return total
  }

  const toggleNode = (path: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev)
      next.has(path) ? next.delete(path) : next.add(path)
      return next
    })
  }

  const renderTreeNode = (node: TreeNode, depth: number): JSX.Element => {
    const hasChildren = node.children.size > 0
    const isExpanded = expandedNodes.has(node.fullPath)
    const isSelected = node.fullKey === selectedKey

    if (!hasChildren && node.isLeaf) {
      // Leaf node
      return (
        <div key={node.fullPath} className={`tree-leaf${isSelected ? ' selected' : ''}`} style={{ paddingLeft: depth * 14 + 8 }}
          onClick={() => node.fullKey && handleSelectKey({ key: node.fullKey })}>
          <span className="tree-leaf-icon">◆</span>
          <span className="tree-leaf-name" title={node.fullKey}>{node.name}</span>
          {node.type && <span className={`type-badge tree-type-badge ${TYPE_COLORS[node.type] || ''}`}>{node.type}</span>}
          <span className="tree-leaf-size">{formatSize(node.memoryBytes)}</span>
          <span className="tree-leaf-star" onClick={e => { e.stopPropagation(); node.fullKey && toggleFavorite(node.fullKey) }}>
            {node.fullKey && favorites.has(node.fullKey) ? '★' : '☆'}
          </span>
        </div>
      )
    }

    return (
      <div key={node.fullPath} className="tree-folder-wrap">
        <div className={`tree-folder${node.isLeaf && isSelected ? ' selected' : ''}`} style={{ paddingLeft: depth * 14 + 8 }}
          onClick={() => { toggleNode(node.fullPath); if (node.isLeaf && node.fullKey) handleSelectKey({ key: node.fullKey }) }}>
          <span className="tree-arrow">{isExpanded ? '▾' : '▸'}</span>
          <span className="tree-folder-name">{node.name}</span>
          {node.isLeaf && node.type && <span className={`type-badge tree-type-badge ${TYPE_COLORS[node.type] || ''}`}>{node.type}</span>}
          <span className="tree-count">{countLeaves(node)}</span>
        </div>
        {isExpanded && (
          <div className="tree-children">
            {[...node.children.values()].map(child => renderTreeNode(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  const expandAll = () => {
    const paths = new Set<string>()
    const collect = (node: TreeNode) => {
      if (node.children.size > 0) { paths.add(node.fullPath); node.children.forEach(collect) }
    }
    buildTree(keys).children.forEach(collect)
    setExpandedNodes(paths)
  }

  const collapseAll = () => setExpandedNodes(new Set())
  // --- End Tree View ---

  const scan = useCallback(async (resetCursor: boolean, resetPattern?: string) => {
    if (scanAbortRef.current) scanAbortRef.current.abort()
    scanAbortRef.current = new AbortController()
    setScanning(true); setError('')
    const currentPattern = resetPattern ?? pattern
    const currentCursor = resetCursor ? '0' : cursor
    try {
      const res = await fetch(`/api/redis/${connection.id}/keys/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...connBody, pattern: currentPattern, cursor: currentCursor, count: 100 }),
        signal: scanAbortRef.current.signal,
      })
      if (!res.ok) throw new Error('Scan failed')
      const data = await res.json()
      setKeys(prev => resetCursor ? data.keys : [...prev, ...data.keys])
      setCursor(data.nextCursor)
      setDone(data.done)
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setError((err as Error).message)
    } finally { setScanning(false) }
  }, [connection, pattern, cursor])

  const historyKey = `redivue_history_${connection.id}`
  const favKey = `redivue_favorites_${connection.id}`

  useEffect(() => {
    if (scanAbortRef.current) scanAbortRef.current.abort()
    setKeys([]); setCursor('0'); setPattern('*'); setInputPattern('*')
    setSelectedKey(null); setKeyValue(null); setCheckedKeys(new Set()); setScanning(false)
    setShowHistory(false); setShowFavoritesDropdown(false)
    try { setHistory(JSON.parse(localStorage.getItem(`redivue_history_${connection.id}`) ?? '[]')) } catch { setHistory([]) }
    try { setFavorites(new Set(JSON.parse(localStorage.getItem(`redivue_favorites_${connection.id}`) ?? '[]'))) } catch { setFavorites(new Set()) }
  }, [connection.id, connection.db])

  // Close dropdowns on outside click
  useEffect(() => {
    if (!showHistory && !showFavoritesDropdown) return
    const handler = (e: MouseEvent) => {
      if (showHistory && historyDropdownRef.current && !historyDropdownRef.current.contains(e.target as Node))
        setShowHistory(false)
      if (showFavoritesDropdown && favDropdownRef.current && !favDropdownRef.current.contains(e.target as Node))
        setShowFavoritesDropdown(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showHistory, showFavoritesDropdown])

  const addToHistory = (p: string) => {
    if (!p || p === '*') return
    setHistory(prev => {
      const next = [p, ...prev.filter(x => x !== p)].slice(0, 10)
      localStorage.setItem(historyKey, JSON.stringify(next))
      return next
    })
  }

  const removeFromHistory = (e: React.MouseEvent, p: string) => {
    e.stopPropagation()
    setHistory(prev => {
      const next = prev.filter(x => x !== p)
      localStorage.setItem(historyKey, JSON.stringify(next))
      return next
    })
  }

  const clearHistory = (e: React.MouseEvent) => {
    e.stopPropagation()
    setHistory([])
    localStorage.removeItem(historyKey)
    setShowHistory(false)
  }

  const toggleFavorite = (keyName: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    setFavorites(prev => {
      const next = new Set(prev)
      next.has(keyName) ? next.delete(keyName) : next.add(keyName)
      localStorage.setItem(favKey, JSON.stringify([...next]))
      return next
    })
  }

  const exportBookmarks = () => {
    const data = {
      exportedAt: new Date().toISOString(),
      connection: `${connection.host}:${connection.port}`,
      db: connection.db ?? 0,
      bookmarks: [...favorites],
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `bookmarks-${connection.host}-${connection.port}-db${connection.db ?? 0}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const importBookmarks = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const content = evt.target?.result as string
        const data = JSON.parse(content)
        const imported: Set<string> = Array.isArray(data.bookmarks) ? new Set(data.bookmarks as string[]) : new Set()
        if (imported.size === 0) {
          alert('No bookmarks found in file.')
          return
        }
        const merged = new Set([...favorites, ...imported])
        setFavorites(merged)
        localStorage.setItem(favKey, JSON.stringify([...merged]))
        alert(`✓ Imported ${imported.size} bookmark${imported.size !== 1 ? 's' : ''}. Total: ${merged.size}`)
      } catch (err) {
        alert(`❌ Failed to import bookmarks: ${(err as Error).message}`)
      }
    }
    reader.readAsText(file)
    if (importFileRef.current) importFileRef.current.value = ''
  }

  const isWildcard = (p: string) => !p || p.trim() === '*'

  const doSearch = (p: string) => {
    addToHistory(p)
    setPattern(p); setKeys([]); setSelectedKey(null); setKeyValue(null)
    setCursor('0'); setDone(false); setCheckedKeys(new Set()); scan(true, p)
  }

  const handleSearch = () => {
    if (isWildcard(inputPattern)) { setPendingScanPattern(inputPattern || '*'); return }
    doSearch(inputPattern)
  }

  const handleSelectKey = async (keyInfo: { key: string }) => {
    setSelectedKey(keyInfo.key); setLoadingValue(true); setKeyValue(null)
    try {
      const res = await fetch(`/api/redis/${connection.id}/keys/value`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...connBody, key: keyInfo.key }),
      })
      if (!res.ok) throw new Error('Failed to get value')
      setKeyValue(await res.json())
    } catch (err) { setError((err as Error).message) }
    finally { setLoadingValue(false) }
  }

  const handleKeyDeleted = (deletedKey: string) => {
    setKeys(prev => prev.filter(k => k.key !== deletedKey))
    setCheckedKeys(prev => { const s = new Set(prev); s.delete(deletedKey); return s })
    setSelectedKey(null); setKeyValue(null)
  }

  const toggleCheck = (e: React.MouseEvent, keyName: string) => {
    e.stopPropagation()
    setCheckedKeys(prev => { const s = new Set(prev); s.has(keyName) ? s.delete(keyName) : s.add(keyName); return s })
  }

  const toggleCheckAll = () => {
    if (checkedKeys.size === keys.length) setCheckedKeys(new Set())
    else setCheckedKeys(new Set(keys.map(k => k.key)))
  }

  const handleBulkExport = async (format: 'json' | 'csv') => {
    const keysToExport = [...checkedKeys]
    setExportTotal(keysToExport.length); setExportProgress(0); setExportLoading(true)
    let results: any[] = []
    try {
      const res = await fetch(`/api/redis/${connection.id}/keys/values-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...connBody, keys: keysToExport }),
      })
      if (res.ok) results = await res.json()
    } catch { /* ignore */ }
    setExportProgress(keysToExport.length); setExportLoading(false)
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    if (format === 'json') {
      const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `redis-export-${ts}.json`; a.click(); URL.revokeObjectURL(url)
    } else {
      const esc = (s: any) => `"${String(s).replace(/"/g, '""')}"`
      const header = 'key,type,ttl,value\n'
      const rows = results.map(r => [esc(r.key), esc(r.type), r.ttl, esc(typeof r.value === 'string' ? r.value : JSON.stringify(r.value))].join(',')).join('\n')
      const blob = new Blob([header + rows], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `redis-export-${ts}.csv`; a.click(); URL.revokeObjectURL(url)
    }
  }

  const handleBulkDelete = async () => {
    setDeletingBulk(true); setBulkDeleteError('')
    try {
      const res = await fetch(`/api/redis/${connection.id}/keys/delete-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...connBody, keys: [...checkedKeys] }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Delete failed') }
      const data = await res.json()
      if (onLog) onLog({ label: 'Bulk deleted', detail: `${data.deleted} key${data.deleted !== 1 ? 's' : ''} deleted` })
      setShowBulkDelete(false); setCheckedKeys(new Set()); handleSearch()
      onRefreshHealth?.(connection)
    } catch (e) { setBulkDeleteError((e as Error).message) }
    finally { setDeletingBulk(false) }
  }

  const resetAll = () => {
    setKeys([]); setCursor('0'); setDone(false); setSelectedKey(null); setKeyValue(null)
    setPendingScanPattern(null); setCheckedKeys(new Set()); setInputPattern('*'); setPattern('*')
  }

  return (
    <div className="keys-browser">
      <div className="keys-search-bar">
        <div className="pattern-input-wrap" ref={historyDropdownRef}>
          <input type="text" className="pattern-input" value={inputPattern}
            onChange={e => { setInputPattern(e.target.value); setShowHistory(false) }}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            onFocus={() => { if (history.length > 0) setShowHistory(true) }}
            placeholder="Pattern (e.g. user:* or *)" />
          {showHistory && history.length > 0 && (
            <div className="search-history-dropdown">
              <div className="search-history-header">
                <span>Recent searches</span>
                <button className="search-history-clear-all" onClick={clearHistory}>Clear all</button>
              </div>
              {history.map(p => (
                <div key={p} className="search-history-item"
                  onMouseDown={e => { e.preventDefault(); setInputPattern(p); doSearch(p); setShowHistory(false) }}>
                  <span className="search-history-pattern">{p}</span>
                  <button className="search-history-remove" onMouseDown={e => removeFromHistory(e, p)}>×</button>
                </div>
              ))}
            </div>
          )}
        </div>
        {inputPattern && inputPattern !== '*' && (
          <button className="pattern-clear-btn"
            onClick={() => { setInputPattern('*'); setKeys([]); setSelectedKey(null); setKeyValue(null); setDone(false); setCheckedKeys(new Set()) }}
            title="Clear filter">Clear</button>
        )}
        <button className="search-btn" onClick={handleSearch} disabled={scanning}>{scanning ? 'Scanning...' : 'Search'}</button>
        <div className="favorites-dropdown-wrap" ref={favDropdownRef}>
          <button
            className={`btn-favorites-toggle${showFavoritesDropdown ? ' active' : ''}`}
            onClick={() => setShowFavoritesDropdown(p => !p)}
            title="View favorited keys"
          >★ Favorites{favorites.size > 0 ? ` (${favorites.size})` : ''}</button>
          {showFavoritesDropdown && (
            <div className="favorites-dropdown">
              <div className="favorites-dropdown-header">
                <span>Favorited Keys</span>
                <div className="favorites-header-actions">
                  <button
                    className="favorites-btn-export"
                    onClick={exportBookmarks}
                    disabled={favorites.size === 0}
                    title="Export bookmarks as JSON"
                  >⬇</button>
                  <button
                    className="favorites-btn-import"
                    onClick={() => importFileRef.current?.click()}
                    title="Import bookmarks from JSON"
                  >⬆</button>
                </div>
              </div>
              <input
                ref={importFileRef}
                type="file"
                accept=".json"
                onChange={importBookmarks}
                style={{ display: 'none' }}
              />
              {favorites.size === 0 ? (
                <div className="favorites-dropdown-empty">
                  No favorites yet — click ★ on a key to save it here.
                </div>
              ) : (
                [...favorites].map(fKey => (
                  <div key={fKey} className="favorites-dropdown-item"
                    onClick={() => { setInputPattern(fKey); doSearch(fKey); handleSelectKey({ key: fKey }); setShowFavoritesDropdown(false) }}>
                    <span className="favorites-dropdown-key" title={fKey}>{fKey}</span>
                    <button
                      className="favorites-dropdown-remove"
                      title="Remove from favorites"
                      onMouseDown={e => { e.stopPropagation(); toggleFavorite(fKey) }}
                    >☆</button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
        <button className="add-key-btn" onClick={() => setShowAddKey(true)} title="Add new key">+ Add Key</button>
        <button className="btn-danger btn-sm pattern-delete-btn" onClick={() => { setPendingScanPattern(null); setShowPatternDelete(true) }} title="Delete keys matching a pattern">🗑 Delete by Pattern</button>
        <button className="btn-danger btn-sm btn-flush-db" onClick={() => setShowFlushDb(true)} title={`Delete all keys in DB ${connection.db ?? 0}`}>🔥 Flush DB {connection.db ?? 0}</button>
      </div>

      {error && <div className="keys-error">{error}</div>}

      <div className="keys-layout">
        <div className="keys-list-panel">
          {keys.length === 0 && !scanning && <div className="keys-empty">No keys found. Click Search to scan.</div>}
          {keys.length > 0 && (
            <>
              <div className="keys-count-bar">
                <span className="keys-count">{keys.length} keys{!done ? '+' : ''}</span>
                <div className="view-mode-toggle">
                  <button className={`view-mode-btn${viewMode === 'list' ? ' active' : ''}`} onClick={() => setViewMode('list')} title="List view">☰ List</button>
                  <button className={`view-mode-btn${viewMode === 'tree' ? ' active' : ''}`} onClick={() => setViewMode('tree')} title="Tree view">⊞ Tree</button>
                  {viewMode === 'tree' && (
                    <>
                      <button className="view-mode-btn" onClick={expandAll} title="Expand all">⊞</button>
                      <button className="view-mode-btn" onClick={collapseAll} title="Collapse all">⊟</button>
                    </>
                  )}
                </div>
                {checkedKeys.size > 0 && (
                  <div className="bulk-action-bar">
                    <span>{checkedKeys.size} selected</span>
                    <button className="btn-ttl-edit btn-sm" onClick={() => setShowBulkTtl(true)} disabled={exportLoading}>⏱ Set TTL</button>
                    <button className="btn-export-sm" onClick={() => handleBulkExport('json')} disabled={exportLoading} title="Export as JSON">⬇ JSON</button>
                    <button className="btn-export-sm" onClick={() => handleBulkExport('csv')} disabled={exportLoading} title="Export as CSV">⬇ CSV</button>
                    <button className="btn-secondary btn-sm" onClick={() => setShowCopyTo(true)} disabled={exportLoading} title="Copy to another connection">⇢ Copy to</button>
                    <button className="btn-danger btn-sm" onClick={() => setShowBulkDelete(true)} disabled={exportLoading} title="Delete selected keys">🗑 Delete</button>
                    <button className="btn-secondary btn-sm" onClick={() => setCheckedKeys(new Set())} disabled={exportLoading}>Clear</button>
                    {exportLoading && <span className="bulk-export-progress">Fetching {exportProgress}/{exportTotal}…</span>}
                  </div>
                )}
              </div>
              {viewMode === 'tree' ? (
                <div className="tree-view">
                  {[...buildTree(keys).children.values()].map(child => renderTreeNode(child, 0))}
                </div>
              ) : (
                <table className="keys-table">
                  <thead>
                    <tr>
                      <th style={{ width: 32 }}>
                        <input type="checkbox" checked={keys.length > 0 && checkedKeys.size === keys.length} onChange={toggleCheckAll} title="Select all" />
                      </th>
                      <th style={{ width: 28 }}></th>
                      <th>Key</th><th>Type</th><th>TTL</th><th className="key-size-header">Size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {keys.map(k => (
                      <tr key={k.key} className={`key-row ${selectedKey === k.key ? 'selected' : ''}`} onClick={() => handleSelectKey(k)}>
                        <td onClick={e => toggleCheck(e, k.key)}>
                          <input type="checkbox" checked={checkedKeys.has(k.key)} onChange={() => {}} />
                        </td>
                        <td className="key-star-cell" onClick={e => toggleFavorite(k.key, e)}>
                          <span className={`star-btn${favorites.has(k.key) ? ' starred' : ''}`}>
                            {favorites.has(k.key) ? '★' : '☆'}
                          </span>
                        </td>
                        <td className="key-name" title={k.key}>{k.key}</td>
                        <td><span className={`type-badge ${TYPE_COLORS[k.type] || ''}`}>{k.type}</span></td>
                        <td className="key-ttl">{formatTtl(k.ttl)}</td>
                        <td className="key-size">{formatSize(k.memoryBytes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {!done && (
                <button className="load-more-btn" onClick={() => scan(false, undefined)} disabled={scanning}>
                  {scanning ? 'Loading...' : 'Load More'}
                </button>
              )}
              {done && <div className="keys-done">All keys loaded</div>}
            </>
          )}
        </div>

        <div className="keys-value-panel">
          {loadingValue && <div className="value-loading">Loading value...</div>}
          {!loadingValue && keyValue && (
            <KeyDetail result={keyValue} connBody={connBody} connectionId={String(connection.id)}
              onRefresh={() => selectedKey && handleSelectKey({ key: selectedKey })}
              onKeyDeleted={handleKeyDeleted} onLog={onLog}
              isFavorite={selectedKey ? favorites.has(selectedKey) : false}
              onToggleFavorite={() => { if (selectedKey) toggleFavorite(selectedKey) }} />
          )}
          {!loadingValue && !keyValue && <div className="value-placeholder">Select a key to view its value</div>}
        </div>
      </div>

      {pendingScanPattern !== null && (
        <div className="modal-overlay">
          <div className="modal-box">
            <p className="modal-message" style={{ marginBottom: 8 }}><strong style={{ color: '#e3b341' }}>⚠ Warning</strong></p>
            <p className="modal-message">The <code style={{ color: '#58a6ff' }}>*</code> pattern scans all keys. On large databases this may be slow.</p>
            <div className="modal-actions" style={{ marginTop: 20 }}>
              <button className="btn-danger" onClick={() => { doSearch(pendingScanPattern); setPendingScanPattern(null) }}>Yes, scan all</button>
              <button className="btn-secondary" onClick={() => setPendingScanPattern(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {showAddKey && (
        <AddKeyModal connBody={connBody} connectionId={String(connection.id)} onClose={() => setShowAddKey(false)}
          onSuccess={(keyName, keyType) => { setShowAddKey(false); if (onLog) onLog({ label: 'Created key', detail: `"${keyName}" (${keyType})` }) }} />
      )}
      {showBulkTtl && (
        <BulkTtlModal keys={[...checkedKeys]} connBody={connBody} connectionId={String(connection.id)} onClose={() => setShowBulkTtl(false)}
          onSuccess={() => { const count = checkedKeys.size; setShowBulkTtl(false); setCheckedKeys(new Set()); if (onLog) onLog({ label: 'Bulk TTL set', detail: `${count} key${count !== 1 ? 's' : ''} updated` }); handleSearch(); onRefreshHealth?.(connection) }} />
      )}
      {showBulkDelete && (
        <BulkDeleteModal keys={[...checkedKeys]} connectionId={String(connection.id)} connBody={connBody}
          onClose={() => { setShowBulkDelete(false); setBulkDeleteError('') }} onConfirm={handleBulkDelete} loading={deletingBulk} error={bulkDeleteError} />
      )}
      {showPatternDelete && (
        <PatternDeleteModal connectionId={String(connection.id)} connBody={connBody} onClose={() => setShowPatternDelete(false)}
          onLog={onLog} onRefresh={resetAll} onRefreshHealth={onRefreshHealth} />
      )}
      {showCopyTo && (
        <CopyToModal keys={[...checkedKeys]} connectionId={String(connection.id)} connBody={connBody} onClose={() => setShowCopyTo(false)} onLog={onLog} />
      )}
      {showFlushDb && (
        <FlushDbModal connectionId={String(connection.id)} connBody={connBody} onClose={() => setShowFlushDb(false)}
          onSuccess={() => { setShowFlushDb(false); resetAll(); if (onLog) onLog({ label: 'Flush DB', detail: `All keys deleted from DB ${connection.db ?? 0}` }); if (onRefreshHealth) onRefreshHealth(connection) }} />
      )}
    </div>
  )
}
