import { useEffect, useRef, useState } from 'react'
import ConformerWorkspace from './components/ConformerWorkspace'
import LandingPage from './pages/LandingPage'
import UploadPage from './pages/UploadPage'
import { parseXyz } from './data/tetrapeptideDemo'
import type { AggregationJob, Conformer, MoleculeInput } from './types/molecular'
import { API_BASE_URL, getAggregationJob, runAggregation } from './api'

type Screen = 'landing' | 'upload' | 'workspace' | 'aggregation-setup' | 'analysis' | 'aggregation'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('landing')
  const [molecule, setMolecule] = useState<MoleculeInput | null>(null)
  const [conformers, setConformers] = useState<Conformer[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [tab, setTab] = useState<'3d' | 'analytics'>('3d')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [inputFile, setInputFile] = useState<File | null>(null)
  const [aggregateSize, setAggregateSize] = useState('2')
  const [orientations, setOrientations] = useState('4')
  const [aggregationJob, setAggregationJob] = useState<AggregationJob | null>(null)
  const [aggregationSelectedId, setAggregationSelectedId] = useState('')
  const [aggregationError, setAggregationError] = useState('')
  const [isAggregationLoading, setIsAggregationLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const jobId = aggregationJob?.job_id
    if (screen !== 'aggregation' || !jobId || aggregationJob.status === 'completed' || aggregationJob.status === 'failed') return

    let active = true
    let timer = 0
    const poll = async () => {
      try {
        const updatedJob = await getAggregationJob(jobId)
        if (!active) return
        setAggregationJob(updatedJob)
        const preferredNode = updatedJob.nodes.find((node) => node.id !== 'input')
          ?? (updatedJob.status === 'completed' || updatedJob.status === 'failed' ? updatedJob.nodes[0] : undefined)
        setAggregationSelectedId((current) => {
          const currentExists = updatedJob.nodes.some((node) => node.id === current)
          const candidateLoaded = updatedJob.nodes.some((node) => node.id !== 'input')
          return currentExists && !(current === 'input' && candidateLoaded)
            ? current
            : preferredNode?.id ?? ''
        })
      } catch (reason) {
        if (active) {
          setAggregationJob((current) => current && current.job_id === jobId
            ? {
              ...current,
              status: 'failed',
              message: reason instanceof Error ? reason.message : 'Could not retrieve aggregation job status.',
            }
            : current)
        }
      }
      if (active) timer = window.setTimeout(() => { void poll() }, 1200)
    }

    timer = window.setTimeout(() => { void poll() }, 500)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [screen, aggregationJob?.job_id, aggregationJob?.status])

  const loadFile = async (file?: File) => {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.xyz')) { setError('Please choose a molecular file in XYZ format.'); return }
    try {
      const atoms = parseXyz(await file.text())
      setMolecule({ filename: file.name, atomCount: atoms.length, atoms, geometrySource: 'uploaded-xyz' })
      setInputFile(file)
      setConformers([])
      setSelectedId('')
      setAggregationJob(null)
      setAggregationSelectedId('')
      setAggregationError('')
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not read this XYZ file.')
    }
  }

  const runConformerAnalysis = async (targetTab: '3d' | 'analytics' = '3d') => {
    if (!inputFile || isLoading) return
    setError('')
    setIsLoading(true)
    try {
      const form = new FormData()
      form.append('file', inputFile)
      const response = await fetch(`${API_BASE_URL}/api/run-conformer-analysis`, { method: 'POST', body: form })
      let payload: unknown
      try {
        payload = await response.json()
      } catch (reason) {
        throw new Error('The conformer service returned an unreadable response.', { cause: reason })
      }
      if (!isRecord(payload)) throw new Error('PyAR returned an invalid conformer result.')
      if (!response.ok) {
        const detail = payload.detail
        const reason = typeof detail === 'string'
          ? detail
          : isRecord(detail)
            ? [detail.message, detail.stderr, detail.stdout].filter((value): value is string => typeof value === 'string').join('\n')
            : ''
        throw new Error(reason || 'PyAR conformer analysis failed.')
      }
      const conformerPayload = payload.conformers
      if (!Array.isArray(conformerPayload)) throw new Error('PyAR returned an invalid conformer result.')
      const actual: Conformer[] = conformerPayload.map((item: { id: string; rank: number; energy: number | null; backend_status: string; xyz: string }) => ({
        id: item.id, rank: item.rank, energy: item.energy ?? Number.NaN, label: `xTB ${item.backend_status}`, backendStatus: item.backend_status, xyz: item.xyz,
      }))
      if (actual.some((item) => item.energy === null || !Number.isFinite(item.energy))) throw new Error('PyAR returned conformers without valid xTB energies.')
      if (actual.length === 0) {
        setError('PyAR completed, but no successful conformers were available to analyze.')
        return
      }
      setConformers(actual)
      setSelectedId(actual[0]?.id ?? '')
      setTab(targetTab)
      if (actual.length) setScreen('analysis')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not read this XYZ file.')
    } finally {
      setIsLoading(false)
    }
  }

  const openConformerPage = (targetTab: '3d' | 'analytics') => {
    setError('')
    setTab(targetTab)
    if (conformers.length > 0) {
      setScreen('analysis')
      return
    }
    void runConformerAnalysis(targetTab)
  }

  const openAggregationPage = () => {
    setAggregationError('')
    setScreen(aggregationJob ? 'aggregation' : 'aggregation-setup')
  }

  const removeFile = () => {
    setMolecule(null)
    setInputFile(null)
    setConformers([])
    setSelectedId('')
    setAggregationJob(null)
    setAggregationSelectedId('')
    setAggregationError('')
    setError('')
  }

  const submitAggregation = async () => {
    const size = Number(aggregateSize)
    const orientationCount = Number(orientations)
    if (!inputFile || !Number.isSafeInteger(size) || size < 1 || !Number.isSafeInteger(orientationCount) || orientationCount < 1 || isAggregationLoading) return
    setAggregationError('')
    setIsAggregationLoading(true)
    try {
      const result = await runAggregation(inputFile, size, orientationCount)
      setAggregationJob(result)
      setAggregationSelectedId(result.nodes.find((node) => node.id !== 'input')?.id ?? result.nodes[0]?.id ?? '')
      setScreen('aggregation')
    } catch (reason) {
      setAggregationError(reason instanceof Error ? reason.message : 'Aggregation could not be started.')
    } finally {
      setIsAggregationLoading(false)
    }
  }

  const aggregationParametersValid = Number.isSafeInteger(Number(aggregateSize))
    && Number(aggregateSize) > 0
    && Number.isSafeInteger(Number(orientations))
    && Number(orientations) > 0

  const aggregationParameters = (
    <div className="aggregation-parameters">
      <label>Aggregate size
        <input type="number" min="1" step="1" value={aggregateSize} onChange={(event) => setAggregateSize(event.target.value)} />
      </label>
      <label>Orientations
        <input type="number" min="1" step="1" value={orientations} onChange={(event) => setOrientations(event.target.value)} />
      </label>
    </div>
  )

  if (screen === 'landing') return <LandingPage onLaunch={() => setScreen('upload')} />

  if (screen === 'upload') return <UploadPage
    filename={molecule?.filename}
    atomCount={molecule?.atomCount}
    fileSize={inputFile?.size}
    error={error}
    onFileSelect={(file) => { void loadFile(file) }}
    onContinue={() => setScreen('workspace')}
    onRemove={removeFile}
  />

  if (screen === 'aggregation' && aggregationJob && molecule) return <ConformerWorkspace
    molecule={molecule} conformers={[]} isDemo={false} selectedId={aggregationSelectedId} onSelect={setAggregationSelectedId}
    tab="3d" onTabChange={() => {}} onBack={() => setScreen('workspace')}
    aggregationJob={aggregationJob} inputFilename={inputFile?.name ?? molecule?.filename ?? ''}
  />

  if (screen === 'analysis' && molecule && conformers.length > 0) return <ConformerWorkspace
    molecule={molecule} conformers={conformers} isDemo={false} selectedId={selectedId} onSelect={setSelectedId}
    tab={tab} onTabChange={setTab} onBack={() => setScreen('workspace')} />

  return <div className="app-shell">
    <aside className="app-sidebar">
      <button className="app-brand" onClick={() => setScreen('landing')} aria-label="Back to PyAR Molecular home"><span className="brand-symbol">PY<span>·</span>AR</span><span className="brand-name">MOLECULAR</span></button>
      <div className="workspace-label"><span>APPLICATION</span><strong>Analysis workspace</strong></div>
      <div className="sidebar-section"><div className="sidebar-section-title">INPUT</div>
        <button className="upload-trigger" onClick={() => inputRef.current?.click()}><span className="upload-icon">＋</span><span>Upload molecular file<small>XYZ structure</small></span></button>
        <input ref={inputRef} className="visually-hidden" type="file" accept=".xyz,chemical/x-xyz,text/plain" onChange={(event) => { void loadFile(event.target.files?.[0]); event.currentTarget.value = '' }} />
        {molecule && <div className="input-file"><span className="file-mark">XYZ</span><span><strong>{molecule.filename}</strong><small>{molecule.atomCount} atoms · XYZ structure</small></span><span className="file-check">✓</span></div>}
      </div>
      <div className="sidebar-section workflow-nav"><div className="sidebar-section-title">WORKFLOW</div>
        <button className={`workflow-link ${screen === 'aggregation' || screen === 'aggregation-setup' ? 'active' : ''}`} onClick={openAggregationPage}><span className="workflow-glyph">◇</span><span>Aggregation</span>{aggregationJob && <b>›</b>}</button>
        <button className={`workflow-link ${screen === 'analysis' && tab === '3d' ? 'active' : ''}`} onClick={() => openConformerPage('3d')}><span className="workflow-glyph">⌁</span><span>Conformers</span>{conformers.length > 0 && <b>›</b>}</button>
        <button className={`workflow-link ${screen === 'analysis' && tab === 'analytics' ? 'active' : ''}`} onClick={() => openConformerPage('analytics')}><span className="workflow-glyph">▥</span><span>Data Analytics</span>{conformers.length > 0 && <b>›</b>}</button>
      </div>
      <div className="sidebar-bottom"><span className="status-mark"></span> {isLoading ? 'PyAR + xTB running' : 'Local PyAR connection'}</div>
    </aside>

    <main className="workspace-main">
      <header className="workspace-topbar"><span>PyAR Molecular <span className="crumb-separator">/</span> {screen === 'aggregation-setup' ? 'Aggregation' : 'Analysis options'}</span><button onClick={() => setScreen('upload')}>← Back to upload</button></header>
      {error && <div className="upload-error" role="alert">{error}</div>}
      {molecule && screen === 'workspace' && <section className="molecule-home">
        <div className="molecule-home-head">
          <div><div className="workspace-kicker">MOLECULAR ANALYSIS</div><h1>{molecule.filename}</h1><p>{molecule.atomCount} atoms <span>·</span> XYZ structure loaded{inputFile ? ` · ${(inputFile.size / 1024).toFixed(1)} KB` : ''}</p></div>
          <button className="replace-file" onClick={() => inputRef.current?.click()}>Replace file</button>
        </div>
        <div className="workflow-feature">
          <div className="workflow-feature-head"><div><span className="workspace-kicker">AVAILABLE WORKFLOWS</span><h2>Choose an analysis</h2><p>Your uploaded structure will remain available as you switch between workflows.</p></div></div>
          <button className="workflow-launch" onClick={openAggregationPage}>
            <span className="workflow-launch-icon">◇</span><span><strong>Aggregation</strong><small>{aggregationJob ? 'Open the existing PyAR aggregation results' : 'Configure and run a PyAR aggregation job'}</small></span><b>Open workflow <span>→</span></b>
          </button>
          <button className="workflow-launch" onClick={() => openConformerPage('3d')}>
            <span className="workflow-launch-icon">⌁</span><span><strong>Conformers</strong><small>{conformers.length ? `${conformers.length} PyAR conformers available` : 'Run PyAR and xTB conformer analysis'}</small></span><b>Open workflow <span>→</span></b>
          </button>
          <button className="workflow-launch" onClick={() => openConformerPage('analytics')}>
            <span className="workflow-launch-icon">▥</span><span><strong>Data Analytics</strong><small>View energy charts and metrics from conformer results</small></span><b>Open analytics <span>→</span></b>
          </button>
        </div>
      </section>}
      {molecule && screen === 'aggregation-setup' && <section className="molecule-home">
        <div className="molecule-home-head">
          <div><div className="workspace-kicker">AGGREGATION INPUT</div><h1>{molecule.filename}</h1><p>{molecule.atomCount} atoms <span>·</span> XYZ structure loaded</p></div>
          <button className="replace-file" onClick={() => setScreen('workspace')}>Back to options</button>
        </div>
        <div className="workflow-feature aggregation-input-feature">
          <div className="workflow-feature-head"><div><span className="workspace-kicker">PYAR WORKFLOW</span><h2>Molecular Aggregation</h2><p>Choose the aggregate size and orientation count, then run PyAR on the uploaded structure.</p></div><span className="workflow-index">01</span></div>
          {aggregationParameters}
          {aggregationError && <div className="upload-error" role="alert">{aggregationError}</div>}
          <button className="aggregation-submit" onClick={() => { void submitAggregation() }} disabled={!inputFile || !aggregationParametersValid || isAggregationLoading}>
            {isAggregationLoading ? <><span className="aggregation-spinner" /> Starting aggregation…</> : <>Run Aggregation <span>→</span></>}
          </button>
        </div>
      </section>}
      <footer className="workspace-footer"><span>PyAR Molecular</span><span>Computational chemistry workspace</span></footer>
    </main>
  </div>
}
