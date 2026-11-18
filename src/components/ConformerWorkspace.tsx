import { useState, useMemo, useEffect } from 'react';
import { MoleculeViewer3D } from './MolecularViewer3D';
import type { AggregationJob, AggregationNode, Conformer, MoleculeInput } from '../types/molecular';
import { parseXyz } from '../data/tetrapeptideDemo';
import { loadAggregationXyz } from '../api';

interface Props {
  molecule: MoleculeInput;
  conformers: Conformer[];
  isDemo: boolean;
  selectedId: string;
  onSelect: (id: string) => void;
  tab: '3d' | 'analytics';
  onTabChange: (tab: '3d' | 'analytics') => void;
  onBack: () => void;
  aggregationJob?: AggregationJob;
  inputFilename?: string;
}

interface WorkflowItem {
  node: AggregationNode;
  children: WorkflowItem[];
}

function makeWorkflowTree(nodes: AggregationNode[]): WorkflowItem[] {
  const items = nodes.map((node) => ({ node, children: [] as WorkflowItem[] }));
  const byId = new Map(items.map((item) => [item.node.id, item]));
  const roots: WorkflowItem[] = [];

  for (const item of items) {
    const parentId = item.node.parent_id;
    const parent = parentId ? byId.get(parentId) : undefined;
    if (parent && parent !== item) parent.children.push(item);
    else roots.push(item);
  }

  const seen = new Set<string>();
  const mark = (item: WorkflowItem, path: Set<string>) => {
    if (path.has(item.node.id) || seen.has(item.node.id)) return;
    seen.add(item.node.id);
    const nextPath = new Set(path).add(item.node.id);
    item.children.forEach((child) => mark(child, nextPath));
  };
  roots.forEach((root) => mark(root, new Set()));
  for (const item of items) {
    if (!seen.has(item.node.id)) {
      roots.push(item);
      mark(item, new Set());
    }
  }
  return roots;
}

function AggregationWorkflowBranch({ item, selectedId, onSelect, path }: {
  item: WorkflowItem;
  selectedId: string;
  onSelect: (id: string) => void;
  path: Set<string>;
}) {
  if (path.has(item.node.id)) return null;
  const nextPath = new Set(path).add(item.node.id);
  const energy = typeof item.node.energy_hartree === 'number' ? `${item.node.energy_hartree.toFixed(6)} Ha` : '';
  const status = item.node.status || item.node.optimization_status;
  return (
    <li className="aggregation-branch">
      <button type="button" className={`aggregation-candidate ${selectedId === item.node.id ? 'selected' : ''}`} onClick={() => onSelect(item.node.id)}>
        <span className="aggregation-candidate-marker" />
        <span className="aggregation-candidate-label"><strong>{item.node.id}</strong><small>{item.node.stage_label || 'Stage not available'}</small></span>
        <span className="aggregation-candidate-meta">{energy && <small>{energy}</small>}{status && <small>{status}</small>}</span>
      </button>
      {item.children.length > 0 && <ul className="aggregation-children">{item.children.map((child) => (
        <AggregationWorkflowBranch key={child.node.id} item={child} selectedId={selectedId} onSelect={onSelect} path={nextPath} />
      ))}</ul>}
    </li>
  );
}

function displayProperty(value: string | number | null | undefined) {
  return value === undefined || value === null || value === '' ? 'Not available' : String(value);
}

export default function ConformerWorkspace({
  molecule, conformers, isDemo, selectedId, onSelect, tab, onTabChange, onBack,
  aggregationJob, inputFilename = '',
}: Props) {
  const [limitCount, setLimitCount] = useState<number>(5); // Default to top 5
  const [aggregationStructure, setAggregationStructure] = useState<{ id: string; xyz?: string; error?: string } | null>(null);
  const selectedAggregationNode = aggregationJob?.nodes.find((node) => node.id === selectedId);
  const selectedAggregationNodeId = selectedAggregationNode?.id;
  const selectedAggregationXyz = selectedAggregationNode?.xyz;
  const selectedAggregationXyzUrl = selectedAggregationNode?.xyz_url;

  useEffect(() => {
    let active = true;
    if (!selectedAggregationNodeId) return () => { active = false; };
    const node: AggregationNode = {
      id: selectedAggregationNodeId,
      xyz: selectedAggregationXyz,
      xyz_url: selectedAggregationXyzUrl,
    };
    void loadAggregationXyz(node)
      .then((xyz) => {
        parseXyz(xyz);
        if (active) setAggregationStructure({ id: selectedAggregationNodeId, xyz });
      })
      .catch((reason: unknown) => {
        if (active) setAggregationStructure({
          id: selectedAggregationNodeId,
          error: reason instanceof Error ? reason.message : 'Could not load this structure.',
        });
      });
    return () => { active = false; };
  }, [selectedAggregationNodeId, selectedAggregationXyz, selectedAggregationXyzUrl]);

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
  const currentAggregationStructure = aggregationStructure?.id === selectedId ? aggregationStructure : null;

  if (aggregationJob) {
    const tree = makeWorkflowTree(aggregationJob.nodes);
    const candidateCount = aggregationJob.nodes.filter((node) => node.id !== 'input').length;
    const downloadSelected = async () => {
      if (!selectedAggregationNode) return;
      try {
        const xyz = currentAggregationStructure?.xyz || await loadAggregationXyz(selectedAggregationNode);
        const url = URL.createObjectURL(new Blob([xyz], { type: 'chemical/x-xyz' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `${selectedAggregationNode.id.replace(/[^a-zA-Z0-9._-]/g, '_')}.xyz`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (reason) {
        setAggregationStructure({
          id: selectedAggregationNode.id,
          error: reason instanceof Error ? reason.message : 'Could not download this structure.',
        });
      }
    };

    return (
      <div className="analysis-page aggregation-analysis-page">
        <header className="analysis-header">
          <button className="back-link" onClick={onBack}>← Back to workspace</button>
          <div className="analysis-title">
            <div><h1>Molecular Aggregation</h1><p>{inputFilename || molecule.filename} <span>·</span> Job {aggregationJob.job_id}</p></div>
            <span className={`demo-badge aggregation-status aggregation-status-${aggregationJob.status}`}>{aggregationJob.status}</span>
          </div>
          <div className="aggregation-job-note">
            {aggregationJob.message || (aggregationJob.status === 'failed' ? 'Aggregation job failed.' : aggregationJob.status === 'running' ? 'Aggregation is still running.' : `${aggregationJob.nodes.length} structure${aggregationJob.nodes.length === 1 ? '' : 's'} returned by the service.`)}
            {typeof aggregationJob.progress === 'number' && <strong>{aggregationJob.progress}%</strong>}
          </div>
        </header>

        <div className="aggregation-grid">
          <section className="conformer-rail aggregation-workflow-panel" aria-label="Aggregation workflow">
            <div className="panel-heading"><div><span className="section-label">PYAR WORKFLOW</span><h2>Aggregation stages</h2></div><span>{candidateCount} candidates</span></div>
            <div className="aggregation-tree-scroll">
              {tree.length ? <ul className="aggregation-tree">{tree.map((item) => (
                <AggregationWorkflowBranch key={item.node.id} item={item} selectedId={selectedId} onSelect={onSelect} path={new Set()} />
              ))}</ul> : <div className="aggregation-empty"><strong>No workflow structures returned</strong><p>The aggregation service has not provided any candidate structures.</p></div>}
            </div>
            {aggregationJob.logs?.length ? <details className="aggregation-job-logs">
              <summary>PyAR job log ({aggregationJob.logs.length} recent lines)</summary>
              <pre>{aggregationJob.logs.slice(-20).join('\n')}</pre>
            </details> : null}
          </section>

          <section className="structure-panel aggregation-results-panel" aria-label="Selected structure results">
            <div className="structure-panel-head">
              <div><span className="section-label">STRUCTURE RESULTS</span><h2>{selectedAggregationNode?.id || 'No structure selected'}</h2></div>
            </div>
            {selectedAggregationNode ? <>
              <dl className="aggregation-properties">
                <div><dt>Structure ID</dt><dd>{selectedAggregationNode.id}</dd></div>
                <div><dt>Aggregation stage</dt><dd>{displayProperty(selectedAggregationNode.stage_label)}</dd></div>
                <div><dt>Parent ID</dt><dd>{displayProperty(selectedAggregationNode.parent_id)}</dd></div>
                <div><dt>Formula</dt><dd>{displayProperty(selectedAggregationNode.formula)}</dd></div>
                <div><dt>Atom count</dt><dd>{displayProperty(selectedAggregationNode.atom_count)}</dd></div>
                <div><dt>Energy</dt><dd>{typeof selectedAggregationNode.energy_hartree === 'number' ? `${selectedAggregationNode.energy_hartree} Ha` : 'Not available'}</dd></div>
                <div><dt>Optimization status</dt><dd>{displayProperty(selectedAggregationNode.optimization_status)}</dd></div>
              </dl>
              <button className="aggregation-download" onClick={() => { void downloadSelected() }} disabled={!selectedAggregationNode.xyz && !selectedAggregationNode.xyz_url}>
                Download selected XYZ
              </button>
              {selectedAggregationNode.output_file && <p className="aggregation-output-file">Output: {selectedAggregationNode.output_file}</p>}
            </> : <div className="aggregation-empty"><strong>Select a workflow structure</strong><p>Properties for the active candidate will appear here.</p></div>}
          </section>

          <section className="structure-panel aggregation-viewer-panel" aria-label="Selected structure molecular view">
            <div className="structure-panel-head">
              <div><span className="section-label">3D MOLECULAR VIEW</span><h2>{selectedAggregationNode?.id || 'No structure selected'}</h2></div>
              {typeof selectedAggregationNode?.atom_count === 'number' && <span className="atom-count">{selectedAggregationNode.atom_count} atoms</span>}
            </div>
            <div className="aggregation-viewer-frame">
              <MoleculeViewer3D key={selectedId} xyzData={currentAggregationStructure?.xyz || ''} style="ballAndStick" />
              {!currentAggregationStructure && selectedAggregationNode && <div className="aggregation-viewer-message">Loading selected structure…</div>}
              {currentAggregationStructure?.error && <div className="aggregation-viewer-message" role="alert">{currentAggregationStructure.error}</div>}
              {!selectedAggregationNode && <div className="aggregation-viewer-message">Select a structure with XYZ coordinates to view it.</div>}
            </div>
          </section>
        </div>
      </div>
    );
  }

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
