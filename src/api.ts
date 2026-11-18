import type { AggregationJob, AggregationNode } from './types/molecular'

// Keep API calls pointed at the local FastAPI service by default; override with
// VITE_API_BASE_URL when the backend runs elsewhere.
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '')

const aggregationEndpoint = import.meta.env.VITE_AGGREGATION_ENDPOINT?.trim() || `${API_BASE_URL}/api/aggregation-jobs`

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseAggregationJob(payload: unknown): AggregationJob {
  if (!isRecord(payload) || typeof payload.job_id !== 'string' || payload.job_id.length === 0) {
    throw new Error('The aggregation service response is missing a job ID.')
  }
  if (!['queued', 'running', 'completed', 'failed'].includes(String(payload.status))) {
    throw new Error('The aggregation service returned an unsupported job status.')
  }
  if (!Array.isArray(payload.nodes)) {
    throw new Error('The aggregation service response is missing workflow nodes.')
  }

  const nodes = payload.nodes.map((value, index): AggregationNode => {
    if (!isRecord(value) || typeof value.id !== 'string' || value.id.length === 0) {
      throw new Error(`Aggregation node ${index + 1} is missing a structure ID.`)
    }

    const node: AggregationNode = { id: value.id }
    for (const field of ['stage_label', 'formula', 'optimization_status', 'candidate', 'output_file', 'status', 'xyz', 'xyz_url'] as const) {
      const fieldValue = value[field]
      if (fieldValue !== undefined && fieldValue !== null) {
        if (typeof fieldValue !== 'string') throw new Error(`Aggregation node "${node.id}" has an invalid ${field}.`)
        node[field] = fieldValue
      }
    }
    if (value.parent_id === null || typeof value.parent_id === 'string') node.parent_id = value.parent_id
    else if (value.parent_id !== undefined) throw new Error(`Aggregation node "${node.id}" has an invalid parent ID.`)
    if (value.atom_count !== undefined && value.atom_count !== null) {
      if (typeof value.atom_count !== 'number' || !Number.isInteger(value.atom_count) || value.atom_count < 0) {
        throw new Error(`Aggregation node "${node.id}" has an invalid atom count.`)
      }
      node.atom_count = value.atom_count
    }
    if (value.energy_hartree !== undefined && value.energy_hartree !== null) {
      if (typeof value.energy_hartree !== 'number' || !Number.isFinite(value.energy_hartree)) {
        throw new Error(`Aggregation node "${node.id}" has an invalid energy.`)
      }
      node.energy_hartree = value.energy_hartree
    }
    return node
  })

  if (new Set(nodes.map((node) => node.id)).size !== nodes.length) {
    throw new Error('The aggregation service returned duplicate structure IDs.')
  }

  const job: AggregationJob = {
    job_id: payload.job_id,
    status: payload.status as AggregationJob['status'],
    nodes,
  }
  if (payload.logs !== undefined && payload.logs !== null) {
    if (!Array.isArray(payload.logs) || payload.logs.some((line) => typeof line !== 'string')) {
      throw new Error('The aggregation service returned invalid log messages.')
    }
    job.logs = payload.logs as string[]
  }
  if (typeof payload.message === 'string') job.message = payload.message
  if (payload.progress !== undefined && payload.progress !== null) {
    if (typeof payload.progress !== 'number' || !Number.isFinite(payload.progress) || payload.progress < 0 || payload.progress > 100) {
      throw new Error('The aggregation service returned invalid progress.')
    }
    job.progress = payload.progress
  }
  return job
}

export async function runAggregation(file: File, aggregateSize: number, orientations: number): Promise<AggregationJob> {
  const form = new FormData()
  form.append('file', file)
  form.append('aggregate_size', String(aggregateSize))
  form.append('orientations', String(orientations))

  let response: Response
  try {
    response = await fetch(aggregationEndpoint, { method: 'POST', body: form })
  } catch (reason) {
    throw new Error(reason instanceof Error ? `Could not connect to the aggregation service: ${reason.message}` : 'Could not connect to the aggregation service.', { cause: reason })
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch (reason) {
    throw new Error('The aggregation service returned an unreadable response.', { cause: reason })
  }
  if (!response.ok) {
    const detail = isRecord(payload) && typeof payload.detail === 'string' ? payload.detail : undefined
    throw new Error(detail || `Aggregation failed with HTTP ${response.status}.`)
  }
  return parseAggregationJob(payload)
}

export async function getAggregationJob(jobId: string): Promise<AggregationJob> {
  let response: Response
  try {
    response = await fetch(`${aggregationEndpoint}/${encodeURIComponent(jobId)}`)
  } catch (reason) {
    throw new Error(reason instanceof Error ? `Could not connect to the aggregation service: ${reason.message}` : 'Could not connect to the aggregation service.', { cause: reason })
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch (reason) {
    throw new Error('The aggregation service returned an unreadable response.', { cause: reason })
  }
  if (!response.ok) {
    const detail = isRecord(payload) && typeof payload.detail === 'string' ? payload.detail : undefined
    throw new Error(detail || `Could not retrieve aggregation job (HTTP ${response.status}).`)
  }
  return parseAggregationJob(payload)
}

export async function loadAggregationXyz(node: AggregationNode): Promise<string> {
  if (node.xyz?.trim()) return node.xyz
  if (!node.xyz_url) throw new Error('XYZ coordinates are not available for this structure.')

  const serviceUrl = new URL(aggregationEndpoint, window.location.origin)
  const structureUrl = new URL(node.xyz_url, serviceUrl)
  if (structureUrl.origin !== serviceUrl.origin) {
    throw new Error('The structure file must be served from the aggregation service origin.')
  }

  let response: Response
  try {
    response = await fetch(structureUrl)
  } catch (reason) {
    throw new Error(reason instanceof Error ? `Could not load structure XYZ: ${reason.message}` : 'Could not load structure XYZ.', { cause: reason })
  }
  if (!response.ok) throw new Error(`Could not load structure XYZ (HTTP ${response.status}).`)
  return response.text()
}
