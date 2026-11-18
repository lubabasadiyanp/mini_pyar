export interface Atom {
  element: string
  x: number
  y: number
  z: number
}

export interface Conformer {
  id: string
  rank: number
  energy: number
  label: string
  backendStatus?: string
  xyz?: string
}

export interface MoleculeInput {
  filename: string
  atomCount: number
  atoms: Atom[]
  geometrySource: 'uploaded-xyz' | 'illustrative-demo'
}

export type AggregationStatus = 'queued' | 'running' | 'completed' | 'failed'

export interface AggregationNode {
  id: string
  stage_label?: string
  parent_id?: string | null
  formula?: string
  atom_count?: number
  energy_hartree?: number
  optimization_status?: string
  candidate?: string
  output_file?: string
  status?: string
  xyz?: string
  xyz_url?: string
}

export interface AggregationJob {
  job_id: string
  status: AggregationStatus
  nodes: AggregationNode[]
  progress?: number
  message?: string
  logs?: string[]
}
