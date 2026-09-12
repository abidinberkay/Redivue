import { useState, useCallback } from 'react'
import CliConsole from './CliConsole'
import type { Connection } from '../../types'

export function MultiCliConsole({ connection, onLog }: { connection: Connection; onLog?: (entry: any) => void }) {
  const [panes, setPanes] = useState([1])

  const addPane = useCallback(() => {
    if (panes.length >= 4) return
    setPanes(prev => [...prev, Date.now()])
  }, [panes.length])

  const removePane = useCallback((id: number) => {
    if (panes.length <= 1) return
    setPanes(prev => prev.filter(p => p !== id))
  }, [panes.length])

  const compact = panes.length > 1

  return (
    <div className={`cli-multi-wrap cli-multi-${panes.length}`}>
      {panes.map(id => (
        <div key={id} className="cli-pane-wrapper">
          <CliConsole
            connection={connection}
            onLog={onLog}
            compact={compact}
            onAdd={panes.length < 4 ? addPane : null}
            onClose={panes.length > 1 ? () => removePane(id) : null}
          />
        </div>
      ))}
    </div>
  )
}
