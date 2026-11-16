import { useEffect, useRef, useState } from 'react'
import type { Atom } from '../types/molecular'

const atomColors: Record<string, string> = { C: '#53635d', N: '#667e91', O: '#a65f4c', H: '#d7d4cb', S: '#9c8b50', P: '#a66b45' }

interface Props { atoms: Atom[]; geometrySource: 'uploaded-xyz' | 'illustrative-demo' }

export default function MoleculeViewer({ atoms, geometrySource }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rotation = useRef({ x: -0.32, y: 0.38 })
  const zoom = useRef(1)
  const drag = useRef<{ x: number; y: number } | null>(null)
  const [hoveredAtom, setHoveredAtom] = useState<string | null>(null)
  const [, redraw] = useState(0)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context || atoms.length === 0) return
    const bounds = canvas.getBoundingClientRect()
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.round(bounds.width * ratio)
    canvas.height = Math.round(bounds.height * ratio)
    context.scale(ratio, ratio)
    const width = bounds.width
    const height = bounds.height
    context.clearRect(0, 0, width, height)

    const mean = atoms.reduce((sum, atom) => ({ x: sum.x + atom.x, y: sum.y + atom.y, z: sum.z + atom.z }), { x: 0, y: 0, z: 0 })
    mean.x /= atoms.length; mean.y /= atoms.length; mean.z /= atoms.length
    const maxRadius = Math.max(...atoms.map((atom) => Math.hypot(atom.x - mean.x, atom.y - mean.y, atom.z - mean.z)), 1)
    const scale = Math.min(width, height) * 0.38 * zoom.current / maxRadius
    const projected = atoms.map((atom, index) => {
      const x = atom.x - mean.x, y = atom.y - mean.y, z = atom.z - mean.z
      const cosY = Math.cos(rotation.current.y), sinY = Math.sin(rotation.current.y)
      const rotatedX = x * cosY + z * sinY
      const rotatedZ = -x * sinY + z * cosY
      const cosX = Math.cos(rotation.current.x), sinX = Math.sin(rotation.current.x)
      const rotatedY = y * cosX - rotatedZ * sinX
      const depth = y * sinX + rotatedZ * cosX
      return { x: width / 2 + rotatedX * scale, y: height / 2 - rotatedY * scale, depth, element: atom.element, index }
    })

    context.lineWidth = 1.4
    context.strokeStyle = '#a8aaa0'
    for (let i = 0; i < atoms.length; i++) for (let j = i + 1; j < atoms.length; j++) {
      const a = atoms[i], b = atoms[j]
      if (a.element === 'H' && b.element === 'H') continue
      const distance = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
      if (distance > 1.85 || distance < 0.2) continue
      context.beginPath(); context.moveTo(projected[i].x, projected[i].y); context.lineTo(projected[j].x, projected[j].y); context.stroke()
    }
    projected.sort((a, b) => a.depth - b.depth).forEach((atom) => {
      const radius = atom.element === 'H' ? 3.1 : 5.4
      context.beginPath(); context.arc(atom.x, atom.y, radius, 0, Math.PI * 2)
      context.fillStyle = atomColors[atom.element] ?? '#85887f'; context.fill()
      context.strokeStyle = '#fffdf8'; context.lineWidth = 1; context.stroke()
    })
  }, [atoms, hoveredAtom])

  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drag.current) return
    const dx = event.clientX - drag.current.x, dy = event.clientY - drag.current.y
    rotation.current.y += dx * 0.008
    rotation.current.x += dy * 0.008
    drag.current = { x: event.clientX, y: event.clientY }
    redraw((value) => value + 1)
  }

  return <div className="molecule-viewer-shell">
    {geometrySource === 'illustrative-demo' && <div className="viewer-notice">Illustrative geometry · not the experimental XYZ structure</div>}
    <canvas ref={canvasRef} aria-label="Interactive molecular structure; drag to rotate, scroll to zoom"
      onPointerDown={(event) => { drag.current = { x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId) }}
      onPointerMove={move} onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}
      onPointerLeave={() => setHoveredAtom(null)} onPointerEnter={() => setHoveredAtom('Atom inspection active')}
      onWheel={(event) => { event.preventDefault(); zoom.current = Math.max(0.45, Math.min(2.6, zoom.current * (event.deltaY < 0 ? 1.08 : 0.92))); redraw((value) => value + 1) }} />
    <div className="viewer-controls">Drag to rotate <span>·</span> Scroll to zoom</div>
  </div>
}
