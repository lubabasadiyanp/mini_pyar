import { useState, useMemo } from 'react';
import { MoleculeViewer3D } from './MolecularViewer3D';
import type { Conformer, MoleculeInput } from '../types/molecular';
import { parseXyz } from '../data/tetrapeptideDemo';

interface Props {
  molecule: MoleculeInput;
  conformers: Conformer[];
  isDemo: boolean;
  selectedId: string;
  onSelect: (id: string) => void;
  tab: '3d' | 'analytics';
  onTabChange: (tab: '3d' | 'analytics') => void;
  onBack: () => void;
}

export default function ConformerWorkspace({ molecule, conformers, isDemo, selectedId, onSelect, tab, onTabChange, onBack }: Props) {
  const [limitCount, setLimitCount] = useState<number>(5); // Default to top 5

  // 1. Sort conformers by energy (ascending) and apply limit
  const visibleConformers = useMemo(() => {
    const sorted = [...conformers].sort((a, b) => a.energy - b.energy);
    return sorted.slice(0, limitCount);
  }, [conformers, limitCount]);

  // 2. Select selected or lowest energy item from visible set
  const selected = visibleConformers.find((item) => item.id === selectedId) ?? visibleConformers[0];
  const min = Math.min(...visibleConformers.map((item) => item.energy));
  const max = Math.max(...visibleConformers.map((item) => item.energy));
  const energyRange = max - min || 1;
  const selectedAtoms = selected?.xyz ? parseXyz(selected.xyz) : molecule.atoms;

  return (
    <div className="analysis-page">
      <header className="analysis-header">
        <button className="back-link" onClick={onBack}>← Back to workspace</button>
        <div className="analysis-title">
          <div>
            <h1>Conformer Analysis</h1>
            <p>{molecule.filename} <span>·</span> {molecule.atomCount} atoms</p>
          </div>
          <span className="demo-badge">{isDemo ? 'Illustrative demo results' : 'PyAR + xTB results'}</span>
        </div>
        <div className="analysis-tabs" role="tablist" aria-label="Conformer analysis view">
          <button role="tab" aria-selected={tab === '3d'} className={tab === '3d' ? 'active' : ''} onClick={() => onTabChange('3d')}>3D View</button>
          <button role="tab" aria-selected={tab === 'analytics'} className={tab === 'analytics' ? 'active' : ''} onClick={() => onTabChange('analytics')}>Analytics</button>
        </div>
      </header>

      {tab === '3d' ? (
        <div className="analysis-grid">
          <section className="conformer-rail" aria-label="Conformer selection">
            <div className="panel-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span className="section-label">STRUCTURE SET</span>
                <h2>Conformers</h2>
              </div>
              
              {/* Filter Dropdown */}
              <select
                value={limitCount}
                onChange={(e) => setLimitCount(Number(e.target.value))}
                style={{
                  padding: '4px 8px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '12px',
                  backgroundColor: '#ffffff',
                  color: '#334155',
                  cursor: 'pointer',
                  fontWeight: '500'
                }}
              >
                <option value={3}>Top 3</option>
                <option value={5}>Top 5 {conformers.length < 5 ? `(Only ${conformers.length} available)` : ''}</option>
                <option value={10}>Top 10 {conformers.length < 10 ? `(Only ${conformers.length} available)` : ''}</option>
              </select>
            </div>

            <div className="conformer-items">
              {visibleConformers.map((item) => (
                <button
                  key={item.id}
                  className={`conformer-item ${item.id === selected?.id ? 'selected' : ''}`}
                  onClick={() => onSelect(item.id)}
                >
                  <span className="rank">{String(item.rank + (isDemo ? 0 : 1)).padStart(2, '0')}</span>
                  <span className="conformer-name">
                    {item.id}
                    <small>{item.backendStatus ?? (item.rank === 1 ? 'Lowest in this set' : item.label)}</small>
                  </span>
                  <strong>
                    {item.energy.toFixed(isDemo ? 2 : 6)}
                    <small>{isDemo ? 'kcal/mol' : 'Eh · xTB'}</small>
                  </strong>
                </button>
              ))}
            </div>

            <div className="selected-summary">
              <span>SELECTED</span>
              <strong>{selected?.id}</strong>
              <p>xTB energy <b>{selected?.energy?.toFixed(6)} {isDemo ? 'kcal/mol' : 'Eh'}</b></p>
              <small>{isDemo ? 'Illustrative demo geometry.' : `PyAR backend status: ${selected?.backendStatus ?? 'unknown'}.`}</small>
            </div>
          </section>

          <section className="structure-panel">
            <div className="structure-panel-head">
              <div>
                <span className="section-label">MOLECULAR STRUCTURE</span>
                <h2>{selected?.id}</h2>
              </div>
              <span className="atom-count">{selectedAtoms.length} atoms</span>
            </div>
            <MoleculeViewer3D xyzData={selected?.xyz || ''} style="ballAndStick" />
          </section>
        </div>
      ) : (
        <div className="analytics-layout">
          <section className="analysis-metrics">
            <div className="metric"><span>LOWEST ENERGY</span><strong>{min.toFixed(isDemo ? 2 : 6)} <small>{isDemo ? 'kcal/mol' : 'Eh · xTB'}</small></strong><p>{visibleConformers.find((item) => item.energy === min)?.id}</p></div>
            <div className="metric"><span>HIGHEST ENERGY</span><strong>{max.toFixed(isDemo ? 2 : 6)} <small>{isDemo ? 'kcal/mol' : 'Eh · xTB'}</small></strong><p>{visibleConformers.find((item) => item.energy === max)?.id}</p></div>
            <div className="metric"><span>ENERGY RANGE</span><strong>{(max - min).toFixed(isDemo ? 2 : 6)} <small>{isDemo ? 'kcal/mol' : 'Eh'}</small></strong><p>{visibleConformers.length} conformers shown</p></div>
            <div className="metric metric-selected"><span>SELECTED</span><strong>{selected?.id}</strong><p>{selected?.energy?.toFixed(isDemo ? 2 : 6)} {isDemo ? 'kcal/mol' : 'Eh'}</p></div>
          </section>

          <section className="energy-panel">
            <div className="panel-heading">
              <div><span className="section-label">RELATIVE STABILITY</span><h2>Energy profile</h2></div>
              <span>{isDemo ? 'Relative energy (kcal/mol)' : 'Relative xTB energy (Eh)'}</span>
            </div>
            <div className="energy-chart-wrap">
              <div className="chart-y-title">{isDemo ? 'Relative energy · kcal/mol' : 'Relative xTB energy · Eh'}</div>
              <svg className="energy-chart" viewBox="0 0 720 270" role="img" aria-label="Interactive relative energy chart by conformer">
                {[0, 1, 2, 3, 4].map((step) => {
                  const y = 225 - step * 48;
                  return <g key={step}><line x1="56" x2="704" y1={y} y2={y} className="chart-gridline"/><text x="42" y={y + 4} textAnchor="end" className="chart-tick">{(energyRange * step / 4).toFixed(4)}</text></g>;
                })}
                <polyline points={visibleConformers.map((item, index) => `${90 + index * (560 / Math.max(visibleConformers.length - 1, 1))},${225 - ((item.energy - min) / energyRange) * 192}`).join(' ')} className="chart-series" />
                {visibleConformers.map((item, index) => {
                  const x = 90 + index * (560 / Math.max(visibleConformers.length - 1, 1));
                  const y = 225 - ((item.energy - min) / energyRange) * 192;
                  return (
                    <g key={item.id} className="chart-point-group" onClick={() => onSelect(item.id)} role="button" tabIndex={0} aria-label={`Select ${item.id}, xTB energy ${item.energy.toFixed(6)}`}>
                      <circle cx={x} cy={y} r="15" className="chart-hit-area"/>
                      <circle cx={x} cy={y} r={item.id === selected?.id ? 7 : 5} className={`chart-dot ${item.id === selected?.id ? 'current' : ''}`}/>
                      <text x={x} y="249" textAnchor="middle" className="chart-x-tick">{String(item.rank + (isDemo ? 0 : 1)).padStart(2, '0')}</text>
                      <text x={x} y={y - 13} textAnchor="middle" className="chart-value">{(item.energy - min).toFixed(4)}</text>
                    </g>
                  );
                })}
                <text x="380" y="268" textAnchor="middle" className="chart-axis-title">Conformer</text>
              </svg>
            </div>
          </section>

          <section className="ranked-panel">
            <div className="panel-heading"><div><span className="section-label">RANKING</span><h2>Conformer results</h2></div><span>{selected?.id} selected</span></div>
            <div className="result-table-scroll">
              <table className="result-table">
                <thead><tr><th>Rank</th><th>Conformer</th><th>xTB energy</th><th>Status</th></tr></thead>
                <tbody>
                  {visibleConformers.map((item) => (
                    <tr key={item.id} className={item.id === selected?.id ? 'current-row' : ''} onClick={() => onSelect(item.id)} tabIndex={0}>
                      <td>{String(item.rank + (isDemo ? 0 : 1)).padStart(2, '0')}</td>
                      <td><strong>{item.id}</strong></td>
                      <td>{item.energy.toFixed(isDemo ? 2 : 6)} <small>{isDemo ? 'kcal/mol' : 'Eh'}</small></td>
                      <td>{item.backendStatus ?? (item.rank === 1 ? 'Lowest in set' : 'Demo result')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
