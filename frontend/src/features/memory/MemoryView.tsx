import { useState, useMemo, useEffect, useCallback } from 'react'
import type { MemoryAnalyzeResult } from '../../types'
import { connBody as buildConnBody } from '../../types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'

// Categorical data-viz palette — one hue per Redis type / TTL bucket, kept
// distinct on purpose (not part of the red theme).
const TYPE_COLORS = {
  string: '#3fb950',
  hash: '#d2a8ff',
  list: '#ffa657',
  set: '#79c0ff',
  zset: '#f78166',
}

const TTL_BUCKETS = [
  { key: 'no_ttl', label: 'No TTL',  color: '#3fb950' },
  { key: 'soon',   label: '< 1h',    color: '#f85149' },
  { key: 'today',  label: '1h – 24h', color: '#e3b341' },
  { key: 'week',   label: '1d – 7d', color: '#8b949e' },
  { key: 'later',  label: '> 7d',    color: '#58a6ff' },
]

function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return <span className={`inline-block shrink-0 rounded-full border-2 border-muted border-t-primary animate-spin ${className}`} />
}

function fmtBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function fmtTtl(ttl) {
  if (ttl === -1) return '∞'
  if (ttl < 0) return '—'
  if (ttl < 60) return `${ttl}s`
  if (ttl < 3600) return `${Math.floor(ttl / 60)}m`
  if (ttl < 86400) return `${Math.floor(ttl / 3600)}h`
  return `${Math.floor(ttl / 86400)}d`
}

const ttlClass = (ttl) =>
  ttl === -1 ? 'text-[var(--color-success)]'
  : ttl < 0 ? 'text-muted-foreground/60'
  : ttl < 300 ? 'text-[var(--color-warning)]'
  : 'text-muted-foreground'

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/* ── Analysis History (snapshots persisted per-connection in localStorage) ── */
const HISTORY_LIMIT = 30
const historyKey = (connId) => `redivue_analysis_history_${connId}`

function loadHistory(connId) {
  try {
    const raw = localStorage.getItem(historyKey(connId))
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveHistory(connId, list) {
  try { localStorage.setItem(historyKey(connId), JSON.stringify(list.slice(0, HISTORY_LIMIT))) } catch { /* ignore */ }
}

/** Signed delta as "+1.2 MB (+15.3%)" — null base means "no prior value to compare". */
function fmtDelta(current, base) {
  if (base == null) return null
  const diff = current - base
  if (diff === 0) return { text: '± 0 B', sign: 0 }
  const pct = base > 0 ? (diff / base) * 100 : 0
  const sign = diff > 0 ? 1 : -1
  return { text: `${sign > 0 ? '+' : '-'}${fmtBytes(Math.abs(diff))} (${sign > 0 ? '+' : '-'}${Math.abs(pct).toFixed(1)}%)`, sign }
}

/* ── Key Detail Modal ── */
function KeyDetailModal({ keyInfo, connection, connBody, onClose, onDeleted, onRenamed, onLog }) {
  const [kv, setKv] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showRename, setShowRename] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [saving, setSaving] = useState(false)

  const [editingString, setEditingString] = useState(false)
  const [stringVal, setStringVal] = useState('')

  const [hashField, setHashField] = useState('')
  const [hashValue, setHashValue] = useState('')

  const [listValue, setListValue] = useState('')
  const [listOp, setListOp] = useState('rpush')

  const [setMember, setSetMember] = useState('')

  const [zsetMember, setZsetMember] = useState('')
  const [zsetScore, setZsetScore] = useState('0')

  const [newKeyName, setNewKeyName] = useState(keyInfo.key)
  const [renameError, setRenameError] = useState('')

  const fetchValue = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/redis/${connection.id}/keys/value`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...connBody, key: keyInfo.key }),
      })
      if (!res.ok) throw new Error('Failed to load value')
      const data = await res.json()
      setKv(data)
      setStringVal(data.value || '')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [keyInfo.key, connection.id])

  useEffect(() => { fetchValue() }, [fetchValue])

  const apiPost = async (endpoint, body) => {
    const res = await fetch(`/api/redis/${connection.id}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...connBody, ...body }),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      throw new Error(d.error || 'Request failed')
    }
    return res.json()
  }

  const handleDelete = async () => {
    try {
      await apiPost('key/delete', { key: keyInfo.key })
      onDeleted(keyInfo.key)
      onLog?.({ label: 'Key deleted', detail: `${keyInfo.key} (${keyInfo.type})` })
    } catch (e) { alert(e.message) }
  }

  const handleSaveString = async () => {
    setSaving(true)
    try {
      const oldVal = kv.value
      await apiPost('key/set-string', { key: kv.key, value: stringVal, ttl: kv.ttl > 0 ? kv.ttl : -1 })
      setEditingString(false)
      fetchValue()
      onLog?.({ label: 'String value updated', detail: `${keyInfo.key}`, oldValue: oldVal, newValue: stringVal })
    } catch (e) { alert(e.message) }
    finally { setSaving(false) }
  }

  const handleRename = async () => {
    const trimmed = newKeyName.trim()
    if (!trimmed || trimmed === keyInfo.key) { setRenameError('Enter a different key name'); return }
    setSaving(true); setRenameError('')
    try {
      await apiPost('key/rename', { key: keyInfo.key, newKey: trimmed })
      onRenamed(keyInfo.key, trimmed)
      onLog?.({ label: 'Key renamed', detail: `${keyInfo.key} → ${trimmed}`, oldValue: keyInfo.key, newValue: trimmed })
    } catch (e) { setRenameError(e.message) }
    finally { setSaving(false) }
  }

  const hashOp = async (field, value, operation) => {
    try {
      await apiPost('key/hash-field', { key: kv.key, field, value, operation })
      const opName = operation === 'set' ? 'added' : operation === 'delete' ? 'deleted' : operation
      onLog?.({ label: `Hash field ${opName}`, detail: `${keyInfo.key}:${field}` })
      fetchValue()
    } catch (e) { alert(e.message) }
  }

  const listOp_ = async (value, operation) => {
    try {
      await apiPost('key/list-op', { key: kv.key, value, operation })
      const opName = operation === 'rpush' ? 'appended' : operation === 'lpush' ? 'prepended' : operation === 'lrem' ? 'removed' : operation
      onLog?.({ label: `List item ${opName}`, detail: `${keyInfo.key}` })
      fetchValue()
    } catch (e) { alert(e.message) }
  }

  const setOp = async (value, operation) => {
    try {
      await apiPost('key/set-op', { key: kv.key, value, operation })
      const opName = operation === 'add' ? 'added' : operation === 'remove' ? 'removed' : operation
      onLog?.({ label: `Set member ${opName}`, detail: `${keyInfo.key}` })
      fetchValue()
    } catch (e) { alert(e.message) }
  }

  const zsetOp = async (member, score, operation) => {
    try {
      await apiPost('key/zset-op', { key: kv.key, member, score: parseFloat(score) || 0, operation })
      const opName = operation === 'add' ? 'added' : operation === 'remove' ? 'removed' : operation
      onLog?.({ label: `Sorted set member ${opName}`, detail: `${keyInfo.key}` })
      fetchValue()
    } catch (e) { alert(e.message) }
  }

  const badgeStyle = (type) => ({
    color: TYPE_COLORS[type] || 'var(--color-text-primary)',
    borderColor: (TYPE_COLORS[type] || 'var(--color-border)') + '55',
  })

  const renderValue = () => {
    if (!kv?.value && kv?.value !== '') return <span className="italic text-muted-foreground">null</span>
    const { type, value } = kv

    if (type === 'string') {
      if (editingString) {
        return (
          <div className="flex flex-col gap-2.5">
            <Textarea className="font-mono text-sm" value={stringVal} onChange={e => setStringVal(e.target.value)} rows={8} />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSaveString} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
              <Button size="sm" variant="secondary" onClick={() => { setEditingString(false); setStringVal(value) }}>Cancel</Button>
            </div>
          </div>
        )
      }
      return (
        <div>
          <pre className="m-0 max-h-[340px] overflow-y-auto whitespace-pre-wrap break-all rounded-md border bg-muted/40 p-3.5 text-sm font-mono">{value}</pre>
          <Button size="sm" variant="secondary" className="mt-2.5" onClick={() => { setStringVal(value); setEditingString(true) }}>Edit value</Button>
        </div>
      )
    }

    if (type === 'hash') {
      return (
        <div>
          <Table className="mb-2.5">
            <TableHeader><TableRow><TableHead>Field</TableHead><TableHead>Value</TableHead><TableHead className="w-11" /></TableRow></TableHeader>
            <TableBody>
              {Object.entries(value || {}).map(([f, v]) => (
                <TableRow key={f}>
                  <TableCell className="font-mono text-xs text-primary">{f}</TableCell>
                  <TableCell className="break-all">{String(v)}</TableCell>
                  <TableCell><Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive" onClick={() => hashOp(f, '', 'delete')}>✕</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Input className="h-8 flex-1 font-mono text-xs" placeholder="field" value={hashField} onChange={e => setHashField(e.target.value)} />
            <Input className="h-8 flex-1 font-mono text-xs" placeholder="value" value={hashValue} onChange={e => setHashValue(e.target.value)} />
            <Button size="sm" onClick={() => { if (!hashField.trim()) return; hashOp(hashField, hashValue, 'set'); setHashField(''); setHashValue('') }}>Add Field</Button>
          </div>
        </div>
      )
    }

    if (type === 'list') {
      return (
        <div>
          <Table className="mb-2.5">
            <TableHeader><TableRow><TableHead className="w-14">#</TableHead><TableHead>Value</TableHead><TableHead className="w-11" /></TableRow></TableHeader>
            <TableBody>
              {(value || []).map((v, i) => (
                <TableRow key={i}>
                  <TableCell className="font-mono text-xs text-primary">{i}</TableCell>
                  <TableCell className="break-all">{v}</TableCell>
                  <TableCell><Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive" onClick={() => listOp_(v, 'lrem')}>✕</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Select value={listOp} onValueChange={setListOp}>
              <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="rpush">RPUSH (tail)</SelectItem>
                <SelectItem value="lpush">LPUSH (head)</SelectItem>
              </SelectContent>
            </Select>
            <Input className="h-8 flex-1 font-mono text-xs" placeholder="value" value={listValue} onChange={e => setListValue(e.target.value)} />
            <Button size="sm" onClick={() => { if (!listValue.trim()) return; listOp_(listValue, listOp); setListValue('') }}>Add</Button>
          </div>
        </div>
      )
    }

    if (type === 'set') {
      return (
        <div>
          <Table className="mb-2.5">
            <TableHeader><TableRow><TableHead>Member</TableHead><TableHead className="w-11" /></TableRow></TableHeader>
            <TableBody>
              {[...(value || [])].map((v, i) => (
                <TableRow key={i}>
                  <TableCell className="break-all">{v}</TableCell>
                  <TableCell><Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive" onClick={() => setOp(v, 'remove')}>✕</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Input className="h-8 flex-1 font-mono text-xs" placeholder="member" value={setMember} onChange={e => setSetMember(e.target.value)} />
            <Button size="sm" onClick={() => { if (!setMember.trim()) return; setOp(setMember, 'add'); setSetMember('') }}>Add Member</Button>
          </div>
        </div>
      )
    }

    if (type === 'zset') {
      return (
        <div>
          <Table className="mb-2.5">
            <TableHeader><TableRow><TableHead>Score</TableHead><TableHead>Member</TableHead><TableHead className="w-11" /></TableRow></TableHeader>
            <TableBody>
              {(value || []).map((entry, i) => (
                <TableRow key={i}>
                  <TableCell className="font-mono text-xs text-primary">{entry.score}</TableCell>
                  <TableCell className="break-all">{entry.member}</TableCell>
                  <TableCell><Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive" onClick={() => zsetOp(entry.member, 0, 'remove')}>✕</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Input className="h-8 flex-1 font-mono text-xs" placeholder="member" value={zsetMember} onChange={e => setZsetMember(e.target.value)} />
            <Input className="h-8 w-20 font-mono text-xs" placeholder="score" type="number" value={zsetScore} onChange={e => setZsetScore(e.target.value)} />
            <Button size="sm" onClick={() => { if (!zsetMember.trim()) return; zsetOp(zsetMember, zsetScore, 'add'); setZsetMember(''); setZsetScore('0') }}>Add</Button>
          </div>
        </div>
      )
    }

    return <pre className="m-0 whitespace-pre-wrap break-all rounded-md border bg-muted/40 p-3.5 text-sm font-mono">{JSON.stringify(value, null, 2)}</pre>
  }

  return (
    <>
      <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
        <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="space-y-3 border-b p-4 text-left">
            <div className="flex flex-wrap items-center gap-2.5 pr-6">
              <DialogTitle className="min-w-0 flex-1 break-all font-mono text-sm font-semibold" title={keyInfo.key}>{keyInfo.key}</DialogTitle>
              <Badge variant="outline" style={badgeStyle(keyInfo.type)}>{keyInfo.type}</Badge>
              <span className="shrink-0 rounded border border-primary/25 bg-primary/10 px-2 py-0.5 font-mono text-xs text-primary">{fmtBytes(keyInfo.memoryBytes)}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => { setShowRename(true); setNewKeyName(keyInfo.key); setRenameError('') }}>✏ Rename</Button>
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setShowDeleteConfirm(true)}>🗑 Delete</Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={fetchValue} title="Refresh">↻</Button>
            </div>
          </DialogHeader>

          {kv && (
            <div className="border-b px-4 py-1.5 text-xs text-muted-foreground">
              TTL: <span className={ttlClass(kv.ttl)}>{fmtTtl(kv.ttl)}</span>
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-4">
            {loading && <div className="flex items-center gap-2.5 py-5 text-sm text-muted-foreground"><Spinner /><span>Loading value...</span></div>}
            {error && <div className="mb-2.5 rounded-md border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">{error}</div>}
            {!loading && !error && kv && renderValue()}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete key?</AlertDialogTitle>
            <AlertDialogDescription>
              Delete key <strong className="font-mono text-foreground">{keyInfo.key}</strong>? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showRename} onOpenChange={setShowRename}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Rename key</DialogTitle></DialogHeader>
          {renameError && <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">{renameError}</div>}
          <Input
            className="font-mono"
            value={newKeyName}
            onChange={e => setNewKeyName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleRename()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setShowRename(false)}>Cancel</Button>
            <Button onClick={handleRename} disabled={saving}>{saving ? 'Renaming...' : 'Rename'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/* ── Main Component ── */
const PAGE_SIZE = 100

export default function MemoryView({ connection, onLog }) {
  const [pattern, setPattern] = useState('*')
  const [limit, setLimit] = useState(10000)
  const [limitText, setLimitText] = useState('10000')
  const [data, setData] = useState<MemoryAnalyzeResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [ttlFilter, setTtlFilter] = useState('all')
  const [nsFilter, setNsFilter] = useState('')     // prefix filter from namespace drill-down
  const [viewMode, setViewMode] = useState('keys') // 'keys' | 'namespaces'
  const [sortCol, setSortCol] = useState('memoryBytes')
  const [sortDir, setSortDir] = useState('desc')
  const [page, setPage] = useState(0)
  const [selectedKey, setSelectedKey] = useState(null)
  const [history, setHistory] = useState<any[]>([])
  const [showHistory, setShowHistory] = useState(false)

  const connBody = buildConnBody(connection)

  useEffect(() => {
    setData(null)
    setError('')
    setSearch('')
    setTypeFilter('all')
    setTtlFilter('all')
    setNsFilter('')
    setPage(0)
    setSelectedKey(null)
    setShowHistory(false)
    setHistory(loadHistory(connection.id))
  }, [connection.id, connection.db])

  const saveSnapshot = () => {
    if (!data) return
    const snapshot = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      pattern: pattern.trim() || '*',
      totalBytes: data.totalBytes,
      totalScanned: data.totalScanned,
      byType: data.byType || {},
    }
    const updated = [snapshot, ...history]
    setHistory(updated)
    saveHistory(connection.id, updated)
    onLog?.({ label: 'Analysis snapshot saved', detail: `${fmtBytes(data.totalBytes)} · ${data.totalScanned.toLocaleString()} keys` })
  }

  const deleteSnapshot = (id) => {
    const updated = history.filter(h => h.id !== id)
    setHistory(updated)
    saveHistory(connection.id, updated)
  }

  const clearHistory = () => {
    setHistory([])
    saveHistory(connection.id, [])
  }

  const analyze = async () => {
    setLoading(true)
    setError('')
    setData(null)
    setPage(0)
    setSelectedKey(null)
    setViewMode('keys')
    setTtlFilter('all')
    setNsFilter('')
    try {
      const res = await fetch(`/api/redis/${connection.id}/memory/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...connBody, pattern: pattern.trim() || '*', limit }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Analysis failed')
      }
      const result = await res.json()
      setData(result)
      onLog?.({ label: 'Memory Analysis', detail: `Pattern: ${pattern.trim() || '*'} · ${result.totalScanned} keys analyzed (${fmtBytes(result.totalBytes)})` })
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const toggleSort = (col) => {
    if (sortCol === col) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    } else {
      setSortCol(col)
      setSortDir(col === 'memoryBytes' ? 'desc' : 'asc')
    }
    setPage(0)
  }

  /* TTL distribution — computed from all keys (ignores current filters) */
  const ttlDist = useMemo(() => {
    if (!data?.keys) return null
    const dist = { no_ttl: 0, soon: 0, today: 0, week: 0, later: 0 }
    data.keys.forEach(k => {
      if (k.ttl === -1)                          dist.no_ttl++
      else if (k.ttl >= 0 && k.ttl < 3600)      dist.soon++
      else if (k.ttl >= 3600 && k.ttl < 86400)  dist.today++
      else if (k.ttl >= 86400 && k.ttl < 604800) dist.week++
      else if (k.ttl >= 604800)                  dist.later++
    })
    return dist
  }, [data])

  /* Recommendations */
  const recommendations = useMemo(() => {
    if (!data?.keys) return []
    const recs = []

    // Large key recommendation
    const largeKeys = data.keys.filter(k => k.memoryBytes > 1024 * 1024)
    if (largeKeys.length > 0) {
      recs.push({
        icon: '⚠️',
        title: `${largeKeys.length} Large Key${largeKeys.length > 1 ? 's' : ''}`,
        msg: 'Consider compressing values > 1 MB'
      })
    }

    // TTL recommendation
    const noTtl = data.keys.filter(k => k.ttl === -1).length
    const ttlPct = data.keys.length > 0 ? (noTtl / data.keys.length) * 100 : 0
    if (ttlPct > 80) {
      const isAll = noTtl === data.keys.length
      const ttlPctStr = isAll ? '100' : `${Math.floor(noTtl / data.keys.length * 1000) / 10}`
      recs.push({
        icon: '⏱️',
        title: `${ttlPctStr}% Keys without TTL`,
        msg: 'Consider setting TTLs to avoid memory bloat'
      })
    }

    // Top key dominance
    if (data.keys.length > 0) {
      const topKey = data.keys[0]
      const dominancePct = data.totalBytes > 0 ? (topKey.memoryBytes / data.totalBytes) * 100 : 0
      if (dominancePct > 10) {
        recs.push({
          icon: '📊',
          title: `"${topKey.key}" is ${dominancePct.toFixed(1)}% of total`,
          msg: 'Single key dominates memory usage'
        })
      }
    }

    return recs
  }, [data])

  /* Namespace grouping — computed from all keys */
  const namespaces = useMemo(() => {
    if (!data?.keys) return []
    const map: Record<string, { namespace: string; count: number; bytes: number }> = {}
    data.keys.forEach(k => {
      const colon = k.key.indexOf(':')
      const ns = colon >= 0 ? k.key.slice(0, colon + 1) : '(no prefix)'
      if (!map[ns]) map[ns] = { namespace: ns, count: 0, bytes: 0 }
      map[ns].count++
      map[ns].bytes += k.memoryBytes || 0
    })
    return Object.values(map).sort((a, b) => b.bytes - a.bytes)
  }, [data])

  const filtered = useMemo(() => {
    if (!data?.keys) return []
    let rows = data.keys
    if (nsFilter) {
      if (nsFilter === '(no prefix)') rows = rows.filter(k => !k.key.includes(':'))
      else rows = rows.filter(k => k.key.startsWith(nsFilter))
    }
    if (typeFilter !== 'all') rows = rows.filter(k => k.type === typeFilter)
    if (ttlFilter !== 'all') {
      rows = rows.filter(k => {
        if (ttlFilter === 'no_ttl') return k.ttl === -1
        if (ttlFilter === 'soon')   return k.ttl >= 0 && k.ttl < 3600
        if (ttlFilter === 'today')  return k.ttl >= 3600 && k.ttl < 86400
        if (ttlFilter === 'week')   return k.ttl >= 86400 && k.ttl < 604800
        if (ttlFilter === 'later')  return k.ttl >= 604800
        return true
      })
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      rows = rows.filter(k => k.key.toLowerCase().includes(q))
    }
    return [...rows].sort((a, b) => {
      let va = a[sortCol], vb = b[sortCol]
      if (typeof va === 'string') { va = va.toLowerCase(); vb = vb.toLowerCase() }
      if (va < vb) return sortDir === 'asc' ? -1 : 1
      if (va > vb) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }, [data, nsFilter, typeFilter, ttlFilter, search, sortCol, sortDir])

  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const types = data ? [...new Set(data.keys.map(k => k.type))].filter(Boolean).sort() : []

  const handleDeleted = (key) => {
    setSelectedKey(null)
    setData(prev => prev ? { ...prev, keys: prev.keys.filter(k => k.key !== key) } : prev)
  }

  const handleRenamed = (oldKey, newKey) => {
    setSelectedKey(null)
    setData(prev => prev ? {
      ...prev,
      keys: prev.keys.map(k => k.key === oldKey ? { ...k, key: newKey } : k)
    } : prev)
  }

  const exportCsv = () => {
    const header = 'key,type,memory_bytes,ttl\n'
    const rows = data.keys.map(k => `"${k.key.replace(/"/g, '""')}",${k.type},${k.memoryBytes},${k.ttl}`)
    downloadFile(header + rows.join('\n'), 'memory-analysis.csv', 'text/csv')
  }

  const exportJson = () => {
    downloadFile(JSON.stringify(data.keys, null, 2), 'memory-analysis.json', 'application/json')
  }

  const SortIcon = ({ col }) => (
    <span className={sortCol === col ? 'ml-1 text-xs text-primary' : 'ml-1 text-xs text-muted-foreground/50'}>
      {sortCol === col ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
    </span>
  )

  const badgeStyle = (type) => ({
    color: TYPE_COLORS[type] || 'var(--color-text-primary)',
    borderColor: (TYPE_COLORS[type] || 'var(--color-border)') + '55',
  })

  const drillIntoNamespace = (ns) => {
    setViewMode('keys')
    setNsFilter(ns)
    setPage(0)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-6">
      <div>
        <h3 className="mb-1.5 text-lg font-semibold">Memory Analysis</h3>
        <p className="text-sm text-muted-foreground">Identify which keys consume the most memory. Click any row to view or edit its value.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <Input
          className="max-w-[360px] flex-1 font-mono"
          type="text"
          placeholder="Pattern (e.g. user:* or *)"
          value={pattern}
          onChange={e => setPattern(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !loading && analyze()}
          disabled={loading}
        />
        <div className="flex items-center gap-1.5">
          <Label className="whitespace-nowrap text-xs text-muted-foreground">Max keys</Label>
          <Input
            className="w-20 text-center"
            value={limitText}
            onChange={e => setLimitText(e.target.value)}
            onBlur={() => {
              const v = parseInt(limitText)
              const valid = isNaN(v) || v < 100 ? 1000 : Math.min(v, 200000)
              setLimit(valid)
              setLimitText(String(valid))
            }}
          />
        </div>
        <Button onClick={analyze} disabled={loading}>
          {loading ? 'Analyzing...' : 'Analyze'}
        </Button>
        <Button variant="outline" size="sm" onClick={saveSnapshot} disabled={!data} title="Save this analysis as a snapshot for later comparison">
          📌 Save Snapshot
        </Button>
        <Button variant={showHistory ? 'secondary' : 'outline'} size="sm" onClick={() => setShowHistory(v => !v)} title="View saved analysis history">
          🕐 History{history.length > 0 ? ` (${history.length})` : ''}
        </Button>
      </div>

      {error && <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">{error}</div>}

      {showHistory && (
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Analysis History</span>
            {history.length > 0 && (
              <button className="text-[11px] text-muted-foreground hover:text-destructive" onClick={clearHistory}>Clear history</button>
            )}
          </div>
          {history.length === 0 ? (
            <div className="px-3 py-4 text-xs text-muted-foreground">No snapshots saved yet for this connection/DB. Run an analysis and click &quot;Save Snapshot&quot;.</div>
          ) : (
            <div className="flex max-h-[280px] flex-col overflow-y-auto">
              {history.map((snap, idx) => {
                const prev = history[idx + 1] // next-older snapshot, chronologically
                const deltaVsPrev = fmtDelta(snap.totalBytes, prev ? prev.totalBytes : null)
                const deltaVsCurrent = data ? fmtDelta(data.totalBytes, snap.totalBytes) : null
                return (
                  <div key={snap.id} className="border-b px-3 py-2 last:border-b-0">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="min-w-[140px] text-xs">{new Date(snap.timestamp).toLocaleString()}</span>
                      <code className="rounded border bg-muted/60 px-1.5 py-px text-[11px] text-muted-foreground">{snap.pattern}</code>
                      <span className="text-xs font-semibold tabular-nums">{fmtBytes(snap.totalBytes)}</span>
                      <span className="text-[11px] text-muted-foreground">{snap.totalScanned.toLocaleString()} keys</span>
                      {deltaVsPrev && (
                        <span
                          className={`rounded px-1.5 py-px text-[11px] font-semibold ${deltaVsPrev.sign > 0 ? 'bg-destructive/10 text-destructive' : deltaVsPrev.sign < 0 ? 'bg-[var(--color-success)]/15 text-[var(--color-success)]' : 'text-muted-foreground'}`}
                          title="Change vs previous snapshot"
                        >
                          {deltaVsPrev.text}
                        </span>
                      )}
                      <button className="ml-auto text-xs text-muted-foreground hover:text-destructive" onClick={() => deleteSnapshot(snap.id)} title="Delete snapshot">✕</button>
                    </div>
                    {deltaVsCurrent && (
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        vs current analysis: <span className={deltaVsCurrent.sign > 0 ? 'font-semibold text-destructive' : deltaVsCurrent.sign < 0 ? 'font-semibold text-[var(--color-success)]' : ''}>{deltaVsCurrent.text}</span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {(data as any)?.sampled && (
        <div className="rounded-md border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-3.5 py-2.5 text-sm text-[var(--color-warning)]">
          ⚡ Sampled — showing {data.totalScanned.toLocaleString()} of {(data as any).totalKeyCount?.toLocaleString()} keys.
          Increase <strong>Max keys</strong> or use a pattern to narrow the scan.
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-3 py-5 text-sm text-muted-foreground">
          <Spinner className="h-[18px] w-[18px]" />
          <span>Scanning keys and measuring memory usage — this may take a moment for large datasets...</span>
        </div>
      )}

      {data && !loading && (
        <>
          {/* Memory by type cards */}
          <div className="flex flex-wrap gap-3">
            <div className="min-w-[130px] rounded-lg border border-primary/30 bg-card p-4">
              <div className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">Total Memory</div>
              <div className="font-mono text-xl font-bold leading-tight">{fmtBytes(data.totalBytes)}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">{data.totalScanned.toLocaleString()} keys analyzed</div>
            </div>
            {Object.entries(data.byType || {})
              .sort(([, a], [, b]) => b - a)
              .map(([type, bytes]) => {
                const count = data.keys.filter(k => k.type === type).length
                const pct = data.totalBytes > 0 ? Math.round((bytes / data.totalBytes) * 100) : 0
                return (
                  <div key={type} className="min-w-[130px] rounded-lg border bg-card p-4">
                    <div className="mb-1.5 flex items-center gap-2">
                      <div className="flex-1 text-[11px] uppercase tracking-wide" style={{ color: TYPE_COLORS[type] || 'var(--color-text-primary)' }}>{type}</div>
                      <span className="text-xs font-semibold text-muted-foreground">{pct}%</span>
                    </div>
                    <div className="h-1.5 rounded" style={{ backgroundColor: TYPE_COLORS[type] || 'var(--color-text-primary)', width: `${pct}%`, minWidth: '3%', opacity: 0.8 }} />
                    <div className="mt-1.5 font-mono text-xl font-bold leading-tight">{fmtBytes(bytes)}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">{count.toLocaleString()} keys</div>
                  </div>
                )
              })}
          </div>

          {/* TTL Distribution */}
          {ttlDist && (
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="mr-0.5 whitespace-nowrap text-[11px] uppercase tracking-wide text-muted-foreground">TTL Distribution</span>
              <div className="flex flex-wrap items-center gap-1.5">
                {TTL_BUCKETS.map(b => {
                  const count = ttlDist[b.key]
                  const pct = data.keys.length > 0 ? ((count / data.keys.length) * 100).toFixed(1) : '0'
                  const isActive = ttlFilter === b.key
                  return (
                    <button
                      key={b.key}
                      className="flex min-w-[62px] flex-col items-center gap-0.5 rounded-md border bg-card px-3.5 py-1.5 transition-colors hover:bg-accent"
                      style={isActive ? { borderColor: b.color + '88', background: b.color + '18' } : {}}
                      onClick={() => { setTtlFilter(f => f === b.key ? 'all' : b.key); setPage(0); setViewMode('keys') }}
                      title={`${pct}% — ${count.toLocaleString()} keys`}
                    >
                      <span className="font-mono text-base font-bold leading-tight" style={{ color: b.color }}>{count.toLocaleString()}</span>
                      <span className="whitespace-nowrap text-[10px] text-muted-foreground">{b.label} ({pct}%)</span>
                    </button>
                  )
                })}
                {ttlFilter !== 'all' && (
                  <Button variant="ghost" size="sm" onClick={() => setTtlFilter('all')}>Clear filter ✕</Button>
                )}
              </div>
            </div>
          )}

          {/* Recommendations */}
          {recommendations.length > 0 && (
            <div className="overflow-hidden rounded-lg border bg-card">
              <div className="border-b bg-muted/40 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">💡 Recommendations</div>
              <div className="flex flex-col">
                {recommendations.map((rec, idx) => (
                  <div key={idx} className="flex items-start gap-2.5 border-b px-3 py-2.5 last:border-b-0">
                    <span className="mt-px shrink-0 text-base">{rec.icon}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium">{rec.title}</div>
                      <div className="text-[11px] text-muted-foreground">{rec.msg}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Filters + view toggle + export */}
          <div className="flex flex-wrap items-center gap-2.5">
            <Input
              className="min-w-[160px] max-w-[280px] flex-1"
              type="text"
              placeholder="Search keys..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(0) }}
              disabled={viewMode === 'namespaces'}
            />
            <Select
              value={typeFilter}
              onValueChange={(v) => { setTypeFilter(v); setPage(0) }}
              disabled={viewMode === 'namespaces'}
            >
              <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {types.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>

            <Tabs value={viewMode} onValueChange={(v) => { setViewMode(v); if (v === 'namespaces') setNsFilter('') }}>
              <TabsList>
                <TabsTrigger value="keys">Keys</TabsTrigger>
                <TabsTrigger value="namespaces">Namespaces</TabsTrigger>
              </TabsList>
            </Tabs>

            <span className="ml-auto text-xs text-muted-foreground">
              {viewMode === 'namespaces'
                ? `${namespaces.length} namespace${namespaces.length !== 1 ? 's' : ''}`
                : `${filtered.length.toLocaleString()} result${filtered.length !== 1 ? 's' : ''}`
              }
            </span>

            <Button variant="outline" size="sm" onClick={exportCsv} title="Export as CSV">CSV</Button>
            <Button variant="outline" size="sm" onClick={exportJson} title="Export as JSON">JSON</Button>
          </div>

          {/* Scrollable table area — controls above stay fixed, only this scrolls */}
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-2">

          {/* Namespace view */}
          {viewMode === 'namespaces' && (
            <div className="shrink-0 overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Namespace</TableHead>
                    <TableHead className="w-20">Keys</TableHead>
                    <TableHead className="w-[200px]">Memory</TableHead>
                    <TableHead className="w-16">Share</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {namespaces.map((ns, idx) => {
                    const pct = data.totalBytes > 0 ? (ns.bytes / data.totalBytes) * 100 : 0
                    return (
                      <TableRow
                        key={ns.namespace}
                        className="cursor-pointer"
                        onClick={() => drillIntoNamespace(ns.namespace)}
                        title="Click to filter keys by this namespace"
                      >
                        <TableCell className="text-right text-[11px] text-muted-foreground">{idx + 1}</TableCell>
                        <TableCell className="font-mono text-xs text-primary">{ns.namespace}</TableCell>
                        <TableCell className="text-muted-foreground tabular-nums">{ns.count.toLocaleString()}</TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1.5">
                            <span>{fmtBytes(ns.bytes)}</span>
                            <div className="h-[3px] w-full overflow-hidden rounded-sm bg-muted">
                              <div className="h-full rounded-sm" style={{ width: `${Math.min(pct, 100)}%`, background: 'linear-gradient(90deg, var(--color-primary-dark), var(--color-primary))' }} />
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{pct.toFixed(1)}%</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Active namespace filter indicator */}
          {viewMode === 'keys' && nsFilter && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/20 bg-primary/[0.07] px-3.5 py-1.5 text-xs">
              <span className="text-muted-foreground">Namespace filter:</span>
              <code className="rounded bg-primary/10 px-1.5 py-px font-mono text-primary">{nsFilter}</code>
              <span className="text-[11px] text-muted-foreground/70">— keys that start with this prefix</span>
              <Button variant="ghost" size="sm" className="ml-auto h-6" onClick={() => setNsFilter('')}>✕ Clear</Button>
            </div>
          )}

          {/* Keys view */}
          {viewMode === 'keys' && (
            filtered.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">No keys match the current filters.</div>
            ) : (
              <>
                <div className="shrink-0 overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">#</TableHead>
                        <TableHead className="cursor-pointer select-none" onClick={() => toggleSort('key')}>Key <SortIcon col="key" /></TableHead>
                        <TableHead className="w-[90px] cursor-pointer select-none" onClick={() => toggleSort('type')}>Type <SortIcon col="type" /></TableHead>
                        <TableHead className="w-[200px] cursor-pointer select-none" onClick={() => toggleSort('memoryBytes')}>Memory <SortIcon col="memoryBytes" /></TableHead>
                        <TableHead className="w-[70px] cursor-pointer select-none" onClick={() => toggleSort('ttl')}>TTL <SortIcon col="ttl" /></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paged.map((row, idx) => {
                        const rank = page * PAGE_SIZE + idx + 1
                        const pct = data.totalBytes > 0 ? (row.memoryBytes / data.totalBytes) * 100 : 0
                        return (
                          <TableRow
                            key={row.key}
                            className="cursor-pointer"
                            onClick={() => setSelectedKey(row)}
                            title="Click to view / edit"
                          >
                            <TableCell className="text-right text-[11px] text-muted-foreground">{rank}</TableCell>
                            <TableCell className="max-w-[320px] overflow-hidden text-ellipsis whitespace-nowrap font-mono text-xs" title={row.key}>{row.key}</TableCell>
                            <TableCell>
                              <Badge variant="outline" style={badgeStyle(row.type)}>{row.type}</Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-1.5">
                                <span>{fmtBytes(row.memoryBytes)}</span>
                                <div className="h-[3px] w-full overflow-hidden rounded-sm bg-muted">
                                  <div className="h-full rounded-sm" style={{ width: `${Math.min(pct * 3, 100)}%`, background: 'linear-gradient(90deg, var(--color-primary-dark), var(--color-primary))' }} />
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <span className={`font-mono text-xs ${ttlClass(row.ttl)}`}>{fmtTtl(row.ttl)}</span>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>

                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-2 py-1">
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setPage(0)} disabled={page === 0}>«</Button>
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setPage(p => p - 1)} disabled={page === 0}>‹</Button>
                    <span className="px-1.5 text-sm text-muted-foreground">Page {page + 1} / {totalPages}</span>
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1}>›</Button>
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1}>»</Button>
                  </div>
                )}
              </>
            )
          )}

          </div>{/* end scroll area */}
        </>
      )}

      {!data && !loading && !error && (
        <div className="flex flex-col items-center justify-center gap-3.5 px-5 py-16">
          <div className="text-5xl text-muted-foreground/40">◈</div>
          <div className="text-center text-sm text-muted-foreground">Click Analyze to see which keys consume the most memory.</div>
        </div>
      )}

      {selectedKey && (
        <KeyDetailModal
          keyInfo={selectedKey}
          connection={connection}
          connBody={connBody}
          onClose={() => setSelectedKey(null)}
          onDeleted={handleDeleted}
          onRenamed={handleRenamed}
          onLog={onLog}
        />
      )}
    </div>
  )
}
