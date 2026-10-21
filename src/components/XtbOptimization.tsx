import { useState } from 'react'
import { API_BASE_URL } from '../api'

type Result = { filename: string; energy: number; xyz: string }

function safeBackendMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object' || !('detail' in payload)) return
  const detail = (payload as { detail?: unknown }).detail
  if (typeof detail !== 'string') return
  return detail.replace(/(?:\/(?:home|tmp|var|usr|opt|workspace)\/|[A-Za-z]:\\)[^\s,;]+/g, '[path]')
}

function isValidXyz(content: string): boolean {
  const lines = content.trim().split(/\r?\n/)
  const count = Number(lines[0]?.trim())
  if (!Number.isInteger(count) || count < 1 || lines.length < count + 2) return false
  return lines.slice(2, count + 2).every((line) => {
    const parts = line.trim().split(/\s+/)
    return parts.length >= 4 && /^[A-Za-z]{1,3}$/.test(parts[0]) && parts.slice(1, 4).every((value) => value !== '' && Number.isFinite(Number(value)))
  })
}

export default function XtbOptimization() {
  const [file, setFile] = useState<File | null>(null)
  const [charge, setCharge] = useState('0')
  const [uhf, setUhf] = useState('0')
  const [gfn, setGfn] = useState('2')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<Result | null>(null)

  const optimize = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (loading) return
    setError('')
    setResult(null)
    if (!file || !file.name.toLowerCase().endsWith('.xyz')) {
      setError('Choose a file with the .xyz extension.')
      return
    }
    try {
      if (!isValidXyz(await file.text())) {
        setError('The selected file does not contain a valid XYZ atom count and coordinate rows.')
        return
      }
    } catch {
      setError('Could not read the selected XYZ file.')
      return
    }
    const integer = (value: string) => /^-?\d+$/.test(value) && Number.isSafeInteger(Number(value))
    if (!integer(charge) || !integer(uhf)) {
      setError('Charge and UHF must be valid whole numbers.')
      return
    }
    if (!['0', '1', '2', '3'].includes(gfn)) {
      setError('Choose a supported GFN method (0, 1, 2, or 3).')
      return
    }

    const form = new FormData()
    form.append('file', file)
    form.append('charge', charge)
    form.append('uhf', uhf)
    form.append('gfn', gfn)
    setLoading(true)
    try {
      const response = await fetch(`${API_BASE_URL}/api/run-xtb-optimization`, { method: 'POST', body: form })
      let payload: unknown
      try { payload = await response.json() } catch { throw new Error('The optimization service returned an unreadable response.') }
      if (!response.ok) throw new Error(safeBackendMessage(payload) || `Optimization failed (HTTP ${response.status}).`)
      if (!payload || typeof payload !== 'object') throw new Error('The optimization service returned an invalid response.')
      const data = payload as Partial<Result> & { status?: string }
      if (data.status !== 'success' || typeof data.filename !== 'string' || typeof data.energy !== 'number' || !Number.isFinite(data.energy) || typeof data.xyz !== 'string' || !data.xyz.trim()) {
        throw new Error('The optimization service returned incomplete results.')
      }
      setResult({ filename: data.filename, energy: data.energy, xyz: data.xyz })
    } catch (reason) {
      setError(reason instanceof TypeError ? 'Could not reach the optimization service. Check that the backend is running and try again.' : reason instanceof Error ? reason.message : 'Optimization failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const download = () => {
    if (!result) return
    const base = result.filename.replace(/\.xyz$/i, '') || 'molecule'
    const url = URL.createObjectURL(new Blob([result.xyz], { type: 'chemical/x-xyz;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${base}_optimized.xyz`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return <section className="workflow-feature xtb-feature">
    <div className="workflow-feature-head"><div><span className="workspace-kicker">AVAILABLE WORKFLOW</span><h2>xTB Geometry Optimization</h2><p>Optimize one XYZ structure with the custom xTB service and inspect or download the resulting coordinates.</p></div><span className="workflow-index">02</span></div>
    <form className="xtb-form" onSubmit={(event) => { void optimize(event) }}>
      <label className="xtb-file-field">XYZ structure<input type="file" accept=".xyz,chemical/x-xyz,text/plain" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setResult(null); setError('') }} /></label>
      <div className="xtb-parameters">
        <label>Charge<input inputMode="numeric" value={charge} onChange={(event) => setCharge(event.target.value)} /></label>
        <label>UHF / unpaired electrons<input inputMode="numeric" value={uhf} onChange={(event) => setUhf(event.target.value)} /></label>
        <label>GFN method<select value={gfn} onChange={(event) => setGfn(event.target.value)}><option value="0">GFN0-xTB</option><option value="1">GFN1-xTB</option><option value="2">GFN2-xTB</option><option value="3">GFN-FF</option></select></label>
      </div>
      <button className="xtb-submit" type="submit" disabled={loading}>{loading ? <><span className="xtb-spinner" aria-hidden="true" /> Optimizing geometry…</> : 'Optimize Geometry'}</button>
    </form>
    {error && <div className="xtb-error" role="alert">{error}</div>}
    {result && <div className="xtb-result" aria-live="polite"><div className="xtb-result-head"><div><span className="section-label">OPTIMIZATION COMPLETE</span><h3>{result.filename}</h3></div><button className="replace-file" type="button" onClick={download}>Download Optimized XYZ ↓</button></div><p className="xtb-energy">Calculated energy <strong>{result.energy}</strong></p><label className="xtb-xyz-label" htmlFor="optimized-xyz">Optimized XYZ coordinates</label><textarea id="optimized-xyz" className="xtb-xyz" readOnly value={result.xyz} spellCheck={false} /></div>}
  </section>
}
