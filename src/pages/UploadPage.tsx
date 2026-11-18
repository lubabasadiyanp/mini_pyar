import { useRef } from 'react'
import '../App.css'

interface UploadPageProps {
  filename?: string
  atomCount?: number
  fileSize?: number
  error?: string
  onFileSelect: (file?: File) => void
  onContinue: () => void
  onRemove: () => void
}

function formatFileSize(size: number): string {
  return size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`
}

export default function UploadPage({
  filename,
  atomCount,
  fileSize,
  error,
  onFileSelect,
  onContinue,
  onRemove,
}: UploadPageProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const chooseFile = (file?: File) => {
    onFileSelect(file)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <main className="entry-page">
      <nav className="nav shell">
        <a className="wordmark" href="#top" aria-label="PyAR Molecular">
          <span>PY</span>AR<span className="wordmark-dot">·</span>MOLECULAR
        </a>
      </nav>
      <section className="workspace-empty entry-upload">
        <div className="workspace-kicker">MOLECULAR ANALYSIS</div>
        <h1>Start with a structure.</h1>
        <p>Upload an XYZ molecular structure to continue to the analysis workflows.</p>
        <input
          ref={inputRef}
          className="visually-hidden"
          type="file"
          accept=".xyz,chemical/x-xyz,text/plain"
          onChange={(event) => chooseFile(event.target.files?.[0])}
        />
        <button className="large-upload" type="button" onClick={() => inputRef.current?.click()}>
          <span>＋</span>
          <strong>{filename ? 'Choose a different XYZ file' : 'Browse for an XYZ file'}</strong>
          <small>Select a molecular structure from your computer</small>
        </button>
        {filename && (
          <>
            <div className="input-file entry-file">
              <span className="file-mark">XYZ</span>
              <span>
                <strong>{filename}</strong>
                <small>{atomCount} atoms · {fileSize === undefined ? 'File size unavailable' : formatFileSize(fileSize)}</small>
              </span>
              <span className="file-check" aria-label="Valid XYZ file">✓</span>
            </div>
            <div className="entry-file-actions">
              <button className="replace-file" type="button" onClick={() => inputRef.current?.click()}>Replace file</button>
              <button className="replace-file" type="button" onClick={onRemove}>Remove file</button>
            </div>
          </>
        )}
        {error && <div className="upload-error entry-error" role="alert">{error}</div>}
        <button className="aggregation-submit entry-continue" type="button" disabled={!filename || Boolean(error)} onClick={onContinue}>
          Continue <span>→</span>
        </button>
        <div className="format-note">SUPPORTED FORMAT <b>XYZ</b></div>
      </section>
    </main>
  )
}
