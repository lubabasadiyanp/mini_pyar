// Keep API calls pointed at the local FastAPI service by default; override with
// VITE_API_BASE_URL when the backend runs elsewhere.
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '')
