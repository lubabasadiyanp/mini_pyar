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
