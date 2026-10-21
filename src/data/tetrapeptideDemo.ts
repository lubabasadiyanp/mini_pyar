import type { Atom, Conformer } from '../types/molecular'

// The repository did not include the experimental tetrapeptide XYZ or result files.
// These coordinates are only a visibly labeled stand-in for demonstrating the viewer.
const demoElements = [
  'N', 'C', 'C', 'O', 'C', 'C', 'N', 'C', 'C', 'O', 'C', 'C', 'N', 'C', 'C', 'O',
  'C', 'C', 'N', 'C', 'C', 'O', 'C', 'C', 'C', 'C', 'C', 'C', 'C', 'C', 'C', 'C',
  'C', 'C', 'C', 'C', 'C', 'C', 'C', 'C', 'C', 'C', 'O',
]

const illustrativeAtoms: Atom[] = demoElements.map((element, index) => {
  const angle = index * 1.15
  const backbone = index < 24
  const step = backbone ? index * 0.72 : (index - 24) * 0.38
  return {
    element,
    x: Math.cos(angle) * (backbone ? 1.2 : 2.8) + step * 0.3,
    y: Math.sin(angle) * (backbone ? 1.2 : 2.4),
    z: (index % 5) * 0.55 + Math.sin(angle * 0.5) * 0.7,
  }
})

export const tetrapeptideDemo = {
  filename: 'tetrapeptide.xyz',
  atomCount: 43,
  geometrySource: 'illustrative-demo' as const,
  atoms: illustrativeAtoms,
  method: 'PyAR conformer workflow · illustrative result set',
  resultLabel: 'Illustrative demo data',
  conformers: [
    { id: 'Conf 0001', rank: 1, energy: 0, label: 'Lowest in demo set' },
    { id: 'Conf 0002', rank: 2, energy: 0.84, label: 'Demo result' },
    { id: 'Conf 0003', rank: 3, energy: 1.72, label: 'Demo result' },
    { id: 'Conf 0004', rank: 4, energy: 2.46, label: 'Demo result' },
    { id: 'Conf 0005', rank: 5, energy: 3.21, label: 'Demo result' },
  ] satisfies Conformer[],
}

export function parseXyz(text: string): Atom[] {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 3) throw new Error('The file does not contain a complete XYZ structure.')

  const atomCount = Number.parseInt(lines[0].trim(), 10)
  if (!Number.isInteger(atomCount) || atomCount < 1) {
    throw new Error('The first line must contain the atom count.')
  }

  const coordinateLines = lines.slice(2, 2 + atomCount)
  if (coordinateLines.length !== atomCount) throw new Error('The file has fewer coordinates than its atom count.')

  const atoms = coordinateLines.map((line) => {
    const [element, x, y, z] = line.trim().split(/\s+/)
    const coordinates = [Number(x), Number(y), Number(z)]
    if (!element || coordinates.some((value) => !Number.isFinite(value))) {
      throw new Error('One or more XYZ coordinate rows are invalid.')
    }
    return { element: element[0].toUpperCase() + element.slice(1).toLowerCase(), x: coordinates[0], y: coordinates[1], z: coordinates[2] }
  })

  return atoms
}
