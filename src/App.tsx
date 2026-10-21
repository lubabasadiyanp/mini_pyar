import { useRef, useState } from 'react'
import ConformerWorkspace from './components/ConformerWorkspace'
import LandingPage from './pages/LandingPage'
import { parseXyz, tetrapeptideDemo } from './data/tetrapeptideDemo'
import type { Conformer, MoleculeInput } from './types/molecular'
import { API_BASE_URL } from './api'
import XtbOptimization from './components/XtbOptimization'

type Screen = 'landing' | 'workspace' | 'analysis'

export default function App() {
  const [screen, setScreen] = useState<Screen>('landing')
  const [molecule, setMolecule] = useState<MoleculeInput | null>(null)
  const [conformers, setConformers] = useState<Conformer[]>([])
  const [isDemo, setIsDemo] = useState(false)
  const [selectedId, setSelectedId] = useState(tetrapeptideDemo.conformers[0].id)
  const [tab, setTab] = useState<'3d' | 'analytics'>('3d')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const loadDemo = () => {
    setMolecule({ filename: tetrapeptideDemo.filename, atomCount: tetrapeptideDemo.atomCount, atoms: tetrapeptideDemo.atoms, geometrySource: 'illustrative-demo' })
    setConformers(tetrapeptideDemo.conformers)
    setIsDemo(true)
    setSelectedId(tetrapeptideDemo.conformers[0].id)
    setError('')
  }

  const loadFile = async (file?: File) => {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.xyz')) { setError('Please choose a molecular file in XYZ format.'); return }
    try {
      const atoms = parseXyz(await file.text())
      setMolecule({ filename: file.name, atomCount: atoms.length, atoms, geometrySource: 'uploaded-xyz' })
      setConformers([])
      setIsDemo(false)
      setError('')
      setIsLoading(true)
      const form = new FormData()
      form.append('file', file)
      const response = await fetch(`${API_BASE_URL}/api/run-conformer-analysis`, { method: 'POST', body: form })
      const payload = await response.json()
      if (!response.ok) {
        const detail = payload.detail
        const reason = typeof detail === 'string' ? detail : [detail?.message, detail?.stderr, detail?.stdout].filter(Boolean).join('\n')
        throw new Error(reason || 'PyAR conformer analysis failed.')
      }
      const actual: Conformer[] = payload.conformers.map((item: { id: string; rank: number; energy: number | null; backend_status: string; xyz: string }) => ({
        id: item.id, rank: item.rank, energy: item.energy ?? Number.NaN, label: `xTB ${item.backend_status}`, backendStatus: item.backend_status, xyz: item.xyz,
      }))
      if (actual.some((item) => item.energy === null || !Number.isFinite(item.energy))) throw new Error('PyAR returned conformers without valid xTB energies.')
      setConformers(actual)
      setSelectedId(actual[0]?.id ?? '')
      setTab('3d')
      if (actual.length) setScreen('analysis')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not read this XYZ file.')
      setConformers([])
    } finally {
      setIsLoading(false)
    }
  }

  if (screen === 'landing') return <LandingPage onLaunch={() => setScreen('workspace')} />

  if (screen === 'analysis' && molecule && conformers.length > 0) return <ConformerWorkspace
    molecule={molecule} conformers={conformers} isDemo={isDemo} selectedId={selectedId} onSelect={setSelectedId}
    tab={tab} onTabChange={setTab} onBack={() => setScreen('workspace')} />

  return <div className="app-shell">
    <aside className="app-sidebar">
      <button className="app-brand" onClick={() => setScreen('landing')} aria-label="Back to PyAR Molecular home"><span className="brand-symbol">PY<span>·</span>AR</span><span className="brand-name">MOLECULAR</span></button>
      <div className="workspace-label"><span>APPLICATION</span><strong>Demo workspace</strong></div>
      <div className="sidebar-section"><div className="sidebar-section-title">INPUT</div>
        <button className="upload-trigger" onClick={() => inputRef.current?.click()}><span className="upload-icon">＋</span><span>Upload molecular file<small>XYZ structure</small></span></button>
        <input ref={inputRef} className="visually-hidden" type="file" accept=".xyz,chemical/x-xyz,text/plain" onChange={(event) => { void loadFile(event.target.files?.[0]); event.currentTarget.value = '' }} />
        {molecule ? <div className="input-file"><span className="file-mark">XYZ</span><span><strong>{molecule.filename}</strong><small>{molecule.atomCount} atoms · XYZ structure</small></span><span className="file-check">✓</span></div> : <button className="demo-load" onClick={loadDemo}>Load tetrapeptide demo <span>↗</span></button>}
      </div>
      <div className="sidebar-section workflow-nav"><div className="sidebar-section-title">WORKFLOW</div>
        <button className={`workflow-link ${screen === 'analysis' ? 'active' : ''}`} disabled={conformers.length === 0} onClick={() => { setTab('3d'); setScreen('analysis') }}><span className="workflow-glyph">⌁</span><span>Conformer</span>{conformers.length > 0 && <b>›</b>}</button>
        {molecule && conformers.length === 0 && <div className="workflow-unavailable">{isLoading ? 'Running PyAR + xTB…' : 'Upload an XYZ structure to run PyAR + xTB conformer analysis.'}</div>}
        {molecule && conformers.length === 0 && !isLoading && <button className="demo-load demo-load-secondary" onClick={loadDemo}>Load tetrapeptide demo</button>}
      </div>
      <div className="sidebar-bottom"><span className="status-mark"></span> {isLoading ? 'PyAR + xTB running' : 'Local PyAR connection'}</div>
    </aside>

    <main className="workspace-main">
      <header className="workspace-topbar"><span>PyAR Molecular <span className="crumb-separator">/</span> Workspace</span><button onClick={() => setScreen('landing')}>← Back to PyAR Molecular</button></header>
      {error && <div className="upload-error" role="alert">{error}</div>}
      {!molecule ? <section className="workspace-empty">
        <div className="workspace-kicker">MOLECULAR ANALYSIS</div><h1>Start with a structure.</h1><p>Load an XYZ file to begin, or open the tetrapeptide demo to explore the conformer workflow.</p>
        <button className="large-upload" onClick={() => inputRef.current?.click()}><span>＋</span><strong>Upload molecular file</strong><small>Choose an .xyz structure from your computer</small></button>
        <div className="or-rule"><span>OR</span></div><button className="load-demo-button" onClick={loadDemo}>Load tetrapeptide demo <span>→</span></button>
        <div className="format-note">SUPPORTED FORMAT <b>XYZ</b></div>
      </section> : <section className="molecule-home">
        <div className="molecule-home-head"><div><div className="workspace-kicker">MOLECULAR ANALYSIS</div><h1>{molecule.filename === 'tetrapeptide.xyz' ? 'Tetrapeptide' : molecule.filename}</h1><p>{molecule.atomCount} atoms <span>·</span> XYZ structure loaded</p></div><button className="replace-file" onClick={() => inputRef.current?.click()}>Replace file</button></div>
        <div className="workflow-feature"><div className="workflow-feature-head"><div><span className="workspace-kicker">AVAILABLE WORKFLOW</span><h2>Conformer Analysis</h2><p>Explore generated conformations, their relative energies, and structural differences.</p></div><span className="workflow-index">01</span></div>
          {conformers.length > 0 ? <><button className="workflow-launch" onClick={() => setScreen('analysis')}><span className="workflow-launch-icon">⌁</span><span><strong>Conformer</strong><small>{conformers.length} real PyAR conformers · xTB energies</small></span><b>Open analysis <span>→</span></b></button><div className="summary-strip"><div><span>INPUT STRUCTURE</span><strong>{molecule.filename}</strong></div><div><span>ATOM COUNT</span><strong>{molecule.atomCount}</strong></div><div><span>RESULT SET</span><strong>PyAR + xTB</strong></div></div></> : <div className="not-calculated"><span className="not-calculated-icon">i</span><div><strong>{isLoading ? 'Running PyAR + xTB…' : 'Ready for conformer analysis.'}</strong><p>{isLoading ? 'Generating and ranking conformers with the local PyAR installation.' : 'Upload an XYZ structure to run a real PyAR + xTB calculation.'}</p></div>{isLoading && <span aria-live="polite">Please wait</span>}</div>}
        </div>
      </section>}
      <XtbOptimization />
      <footer className="workspace-footer"><span>PyAR Molecular</span><span>Computational chemistry workspace</span></footer>
    </main>
  </div>
}
