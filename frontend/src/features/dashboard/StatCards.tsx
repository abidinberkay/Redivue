import { Tooltip } from '../../components/InfoTooltip'

export const TOOLTIPS: Record<string, string> = {
  'Memory Used': 'Current memory usage by Redis',
  'Peak Memory': 'Highest memory usage since Redis started',
  'Max Memory': 'Memory limit configured (unlimited if not set)',
  'Fragmentation Ratio': 'Memory waste: How much extra memory Redis allocated vs actually using. 1.0=none, >1.5=too much fragmentation. Ideally 1.0-1.2',
  'Total Keys': 'Total number of data entries stored in Redis',
  'Ops / sec': 'Commands Redis processes per second right now. Higher = busier',
  'Hit Rate': 'Cache hit rate: % of key lookups that succeeded. >90% is good. Low = app not using cache well',
  'Redis Version': 'Version of Redis server running',
  'Role': 'master = primary instance, slave/replica = backup copy',
  'Uptime': 'How long Redis has been running continuously. Restart = 0',
  'Connected Clients': 'Apps/users currently connected to Redis',
  'Total Connections': 'Total connections since Redis started. Shows how busy it is over time',
  'Keyspace Hit Rate': 'Cache hit rate: % of key lookups that found data. Shows cache effectiveness',
  'Total Commands': 'Total number of commands processed since startup',
  'RDB Last Save': 'Status of last RDB snapshot save (ok or err)',
  'AOF': 'Write-ahead logging: When enabled, Redis saves every write operation to disk. Enabled = safer but slower.',
}

export function StatCard({ label, value, sub, accent }: { label: any; value: any; sub?: any; accent?: boolean }) {
  const tooltip = typeof label === 'string' ? TOOLTIPS[label] : null
  return (
    <div className={`stat-card${accent ? ' stat-card-accent' : ''}`}>
      <div className="stat-label">
        {typeof label === 'string' ? (tooltip ? <Tooltip text={tooltip}>{label}</Tooltip> : label) : label}
      </div>
      <div className="stat-value">{value ?? '—'}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

export function StatRow({ label, value, highlight }: { label: any; value: any; highlight?: boolean }) {
  const tooltip = TOOLTIPS[label]
  return (
    <div className="stat-row">
      <span className="stat-row-label">
        {tooltip ? <Tooltip text={tooltip}>{label}</Tooltip> : label}
      </span>
      <span className={`stat-row-value${highlight ? ' stat-row-highlight' : ''}`}>{value ?? '—'}</span>
    </div>
  )
}

export function EditableStatRow({ label, value, tooltip, onEdit }: { label: string; value: any; tooltip?: string; onEdit: () => void }) {
  const tooltipEl = tooltip ? <Tooltip text={tooltip}>{label}</Tooltip> : label
  return (
    <div className="stat-row">
      <span className="stat-row-label">{tooltipEl}</span>
      <span className="stat-editable-group">
        <span className="stat-row-value">{value ?? '—'}</span>
        <button className="stat-edit-btn" onClick={onEdit}>Edit</button>
      </span>
    </div>
  )
}

export function ToggleStatRow({ label, value, onEdit, tooltip }: { label: string; value: any; onEdit: () => void; tooltip?: string }) {
  const tooltipEl = tooltip ? <Tooltip text={tooltip}>{label}</Tooltip> : label
  return (
    <div className="stat-row">
      <span className="stat-row-label">{tooltipEl}</span>
      <span className="stat-editable-group">
        <span className={`stat-row-value${value ? ' stat-row-highlight' : ''}`}>{value ? 'Enabled' : 'Disabled'}</span>
        <button className="stat-edit-btn" onClick={onEdit}>Edit</button>
      </span>
    </div>
  )
}
