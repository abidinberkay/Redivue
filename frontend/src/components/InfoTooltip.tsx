import { useState, useRef } from 'react'

export function Tooltip({ text, children }: { text: string; children: React.ReactNode }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const wrapRef = useRef<HTMLSpanElement | null>(null)

  const show = () => {
    if (!wrapRef.current) return
    const r = wrapRef.current.getBoundingClientRect()
    setPos({ top: r.top - 8, left: r.left + r.width / 2 })
  }

  const hide = () => setPos(null)

  return (
    <>
      <span ref={wrapRef} className="tooltip-wrapper" onMouseEnter={show} onMouseLeave={hide}>
        {children}
        <span className="tooltip-icon">ℹ</span>
      </span>
      {pos && (
        <div className="tooltip-fixed" style={{ top: pos.top, left: pos.left }}>
          {text}
        </div>
      )}
    </>
  )
}
