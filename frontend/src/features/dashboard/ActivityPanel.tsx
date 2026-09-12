import { useState } from 'react'

function UndoBtn({ entry, onMarkUndone }: { entry: any; onMarkUndone: (id: number) => void }) {
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const handle = async () => {
    setLoading(true); setErr('')
    try {
      await entry.undo()
      onMarkUndone(entry.id)
    } catch (e) {
      setErr((e as Error).message || 'Undo failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="activity-undo-row">
      {err && <span className="activity-undo-err" title={err}>⚠ {err}</span>}
      <button className="activity-undo-btn" onClick={handle} disabled={loading}>
        {loading ? '…' : '↩ Undo'}
      </button>
    </div>
  )
}

export function ActivityPanel({ log, onMarkUndone, onClear }: { log: any[]; onMarkUndone: (id: number) => void; onClear: () => void }) {
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const selectedEntry = selectedId ? log.find(e => e.id === selectedId) : null

  const fmtTime = (d: Date) => {
    const diff = (Date.now() - d.getTime()) / 1000
    if (diff < 60) return `${Math.floor(diff)}s ago`
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  if (selectedEntry) {
    return (
      <div className="activity-panel">
        <div className="activity-panel-hdr">
          <button className="activity-back-btn" onClick={() => setSelectedId(null)}>← Back</button>
          <span>Detail</span>
        </div>
        <div className="activity-detail-view">
          <div className="activity-entry-time">{fmtTime(selectedEntry.ts)}</div>
          <div className="activity-entry-label" style={{ marginBottom: 10 }}>{selectedEntry.label}</div>
          {selectedEntry.detail && (
            <div className="activity-entry-detail" style={{ marginBottom: 14 }}>{selectedEntry.detail}</div>
          )}
          {selectedEntry.oldValue !== undefined && (
            <div className="activity-diff-block">
              <div className="activity-diff-label activity-diff-label-old">Before</div>
              <pre className="activity-diff-value activity-diff-old">
                {selectedEntry.oldValue === '' ? '(empty)' : selectedEntry.oldValue}
              </pre>
            </div>
          )}
          {selectedEntry.newValue !== undefined && (
            <div className="activity-diff-block">
              <div className="activity-diff-label activity-diff-label-new">After</div>
              <pre className="activity-diff-value activity-diff-new">
                {selectedEntry.newValue === '' ? '(empty)' : selectedEntry.newValue}
              </pre>
            </div>
          )}
          {!selectedEntry.undone && selectedEntry.undo && (
            <UndoBtn entry={selectedEntry} onMarkUndone={onMarkUndone} />
          )}
          {selectedEntry.undone && <span className="activity-undone-tag">↩ Undone</span>}
        </div>
      </div>
    )
  }

  return (
    <div className="activity-panel">
      <div className="activity-panel-hdr">
        <span>Activity Log</span>
        <button className="activity-clear-btn" onClick={onClear} disabled={log.length === 0}>Clear</button>
      </div>
      <div className="activity-list">
        {log.length === 0
          ? <p className="activity-empty">No recent activity</p>
          : log.map(entry => {
            const hasExpandedDetail = entry.oldValue !== undefined || entry.newValue !== undefined
            return (
              <div
                key={entry.id}
                className={`activity-entry${entry.undone ? ' activity-undone' : ''}${hasExpandedDetail ? ' activity-entry-clickable' : ''}`}
                onClick={() => hasExpandedDetail && setSelectedId(entry.id)}
              >
                <div className="activity-entry-time">{fmtTime(entry.ts)}</div>
                <div className="activity-entry-label">{entry.label}</div>
                {entry.detail && <div className="activity-entry-detail">{entry.detail}</div>}
                {hasExpandedDetail && (
                  <div className="activity-expand-hint">Click to view old / new value →</div>
                )}
                {!hasExpandedDetail && !entry.undone && entry.undo && (
                  <UndoBtn entry={entry} onMarkUndone={onMarkUndone} />
                )}
                {!hasExpandedDetail && entry.undone && <span className="activity-undone-tag">↩ Undone</span>}
              </div>
            )
          })
        }
      </div>
    </div>
  )
}
