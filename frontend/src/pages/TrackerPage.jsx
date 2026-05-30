import { useEffect, useMemo, useState } from 'react'
import { FileText, Trash2 } from 'lucide-react'

import { apiFetch, getApiBaseUrl } from '../auth.js'

const COLUMNS = [
  { id: 'saved', title: 'Saved' },
  { id: 'applied', title: 'Applied' },
  { id: 'interviewing', title: 'Interviewing' },
  { id: 'offer', title: 'Offer' },
  { id: 'rejected', title: 'Rejected' },
]

function getMaxRankScore(list) {
  const arr = Array.isArray(list) ? list : []
  let max = 0
  for (const r of arr) {
    const v = Number(r?.rank_score)
    if (Number.isFinite(v) && v > max) max = v
  }
  return max
}

function toMatchPercentile(rankScore, maxRankScore) {
  const raw = Number(rankScore)
  const max = Number(maxRankScore)
  if (!Number.isFinite(raw) || !Number.isFinite(max) || max <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((raw / max) * 100)))
}

function matchTone(pct) {
  if (pct >= 95) return { bg: 'bg-amber-50', border: 'border-amber-200', icon: 'text-amber-500' }
  if (pct >= 80) return { bg: 'bg-emerald-50', border: 'border-emerald-200', icon: 'text-emerald-600' }
  if (pct >= 65) return { bg: 'bg-yellow-50', border: 'border-yellow-200', icon: 'text-yellow-600' }
  return { bg: 'bg-red-50', border: 'border-red-200', icon: 'text-red-600' }
}

function JobTile({ job, maxRankScore, onDragStart, onClick, onPreviewResume }) {
  const pct = toMatchPercentile(job.rank_score, maxRankScore)
  const tone = matchTone(pct)
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, job)}
      onClick={() => onClick(job)}
      className={`relative cursor-grab active:cursor-grabbing border rounded-2xl shadow-subtle px-3 py-2.5 hover:bg-white transition-colors ${tone.bg} ${tone.border}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-semibold text-charcoal-dark line-clamp-2 leading-5">{job.title}</div>
        <div className="shrink-0 text-[11px] font-semibold tabular-nums text-charcoal-dark">{pct}%</div>
      </div>
      <div className="mt-1 text-[11px] text-gray-600 line-clamp-1">{job.company || 'Unknown company'}</div>
      <div className="mt-0.5 text-[11px] text-gray-500 line-clamp-1">{job.location || ''}</div>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          if (job.resume_id) onPreviewResume(job.resume_id)
        }}
        disabled={!job.resume_id}
        className={`absolute right-2 bottom-2 p-1 rounded-md border transition-colors ${
          job.resume_id ? 'bg-white/70 border-gray-200 hover:bg-white' : 'bg-white/40 border-gray-100 cursor-not-allowed'
        }`}
        aria-label="Preview resume used for scoring"
        title={job.resume_id ? 'Preview resume used for scoring' : 'No resume is linked to this role'}
      >
        <FileText className={`w-3.5 h-3.5 ${job.resume_id ? tone.icon : 'text-gray-300'}`} />
      </button>
    </div>
  )
}

function JobDetailPanel({ job, onClose }) {
  if (!job) return null
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="absolute right-6 top-6 w-[min(560px,calc(100vw-48px))] max-h-[calc(100vh-48px)] bg-white border border-gray-200 rounded-2xl shadow-subtle overflow-hidden flex flex-col">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-charcoal-dark">Role details</div>
          <button type="button" onClick={onClose} className="text-xs text-gray-400 hover:text-charcoal transition-colors">
            Close
          </button>
        </div>
        <div className="px-5 py-4 space-y-3 overflow-auto min-h-0">
          <div>
            <div className="text-lg font-semibold text-charcoal-dark">{job.title}</div>
            <div className="text-sm text-gray-600">{job.company || 'Unknown company'}</div>
            <div className="text-sm text-gray-500">{job.location || ''}</div>
          </div>
          {job.url ? (
            <div className="text-sm text-gray-600 break-all">
              URL: <span className="text-gray-500">{job.url}</span>
            </div>
          ) : null}
          {job.description ? (
            <div className="text-sm text-gray-700 leading-6 whitespace-pre-wrap">{job.description}</div>
          ) : (
            <div className="text-sm text-gray-500">No description available.</div>
          )}
        </div>
      </div>
    </div>
  )
}

export function TrackerPage() {
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), [])
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(false)
  const [dragging, setDragging] = useState(null)
  const [detailJob, setDetailJob] = useState(null)
  const [showTrash, setShowTrash] = useState(false)
  const [resumeMap, setResumeMap] = useState({})
  const [resumePreview, setResumePreview] = useState({ open: false, resumeId: null, url: '', fileName: '' })

  async function loadTracked() {
    setLoading(true)
    try {
      const res = await apiFetch(`${apiBaseUrl}/jobs`)
      const data = res.ok ? await res.json() : []
      const list = Array.isArray(data) ? data : []
      setJobs(list.filter((j) => j.is_tracked))
    } finally {
      setLoading(false)
    }
  }

  async function updateJob(jobId, patch) {
    const res = await apiFetch(`${apiBaseUrl}/jobs/${jobId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!res.ok) return null
    return await res.json()
  }

  async function deleteJob(jobId) {
    await apiFetch(`${apiBaseUrl}/jobs/${jobId}`, { method: 'DELETE' })
    setJobs((prev) => prev.filter((j) => j.id !== jobId))
  }

  useEffect(() => {
    loadTracked().catch(() => {})
  }, [apiBaseUrl])

  useEffect(() => {
    let ignore = false
    apiFetch(`${apiBaseUrl}/me/resumes`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (ignore) return
        const arr = Array.isArray(data) ? data : []
        const next = {}
        for (const r of arr) next[r.id] = r
        setResumeMap(next)
      })
      .catch(() => {})
    return () => {
      ignore = true
    }
  }, [apiBaseUrl])

  async function previewResume(resumeId) {
    try {
      const res = await apiFetch(`${apiBaseUrl}/me/resumes/${resumeId}/file`)
      if (!res.ok) return
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const fileName = resumeMap[resumeId]?.file_name || `Resume ${resumeId}`
      setResumePreview({ open: true, resumeId, url, fileName })
    } catch {}
  }

  function onDragStart(e, job) {
    setDragging(job)
    setShowTrash(true)
    e.dataTransfer.setData('text/plain', String(job.id))
  }

  function onDragEnd() {
    setDragging(null)
    setShowTrash(false)
  }

  async function onDropToColumn(e, status) {
    e.preventDefault()
    const jobId = Number(e.dataTransfer.getData('text/plain'))
    if (!jobId) return
    const updated = await updateJob(jobId, { status })
    if (updated) setJobs((prev) => prev.map((j) => (j.id === updated.id ? updated : j)))
    onDragEnd()
  }

  async function onDropToTrash(e) {
    e.preventDefault()
    const jobId = Number(e.dataTransfer.getData('text/plain'))
    if (!jobId) return
    await deleteJob(jobId)
    onDragEnd()
  }

  const grouped = useMemo(() => {
    const map = {}
    for (const c of COLUMNS) map[c.id] = []
    for (const j of jobs) {
      const key = j.status || 'saved'
      if (!map[key]) map[key] = []
      map[key].push(j)
    }
    return map
  }, [jobs])

  const maxRankScore = useMemo(() => getMaxRankScore(jobs), [jobs])

  return (
    <div className="max-w-7xl mx-auto py-12 px-6 space-y-6">
      <header className="mb-2">
        <h1 className="text-3xl font-bold text-charcoal-dark tracking-tight mb-2">Job Tracker</h1>
        <p className="text-gray-500">Drag roles across columns as you apply.</p>
      </header>

      {loading ? <div className="text-sm text-gray-500">Loading tracked roles...</div> : null}

      <div className="flex gap-3">
        {COLUMNS.map((c) => (
          <section
            key={c.id}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => onDropToColumn(e, c.id)}
            className="bg-white border border-gray-100 rounded-2xl shadow-subtle overflow-hidden flex-1 min-w-0 flex flex-col"
          >
            <div className="px-3 py-3 border-b border-gray-50 flex items-center justify-between gap-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{c.title}</div>
              <div className="text-[11px] text-gray-400 tabular-nums">{(grouped[c.id] || []).length}</div>
            </div>
            <div className="p-3 space-y-2 flex-1">
              {(grouped[c.id] || []).map((j) => (
                <JobTile
                  key={j.id}
                  job={j}
                  maxRankScore={maxRankScore}
                  onDragStart={onDragStart}
                  onClick={setDetailJob}
                  onPreviewResume={(resumeId) => previewResume(resumeId)}
                />
              ))}
              {!grouped[c.id]?.length ? <div className="text-[11px] text-gray-400 px-1 py-2">No roles</div> : null}
            </div>
          </section>
        ))}
      </div>

      {showTrash && dragging ? (
        <div
          className="fixed inset-x-0 bottom-6 z-40 flex justify-center pointer-events-none"
          onDragOver={(e) => e.preventDefault()}
        >
          <div
            className="pointer-events-auto w-[min(520px,calc(100vw-48px))] bg-white/70 backdrop-blur border border-gray-200 rounded-2xl shadow-subtle px-6 py-4 flex items-center justify-center"
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDropToTrash}
          >
            <Trash2 className="w-5 h-5 text-gray-500 mr-2" />
            <div className="text-sm text-gray-600">Drop here to delete</div>
          </div>
        </div>
      ) : null}

      <div onDragEnd={onDragEnd} />
      <JobDetailPanel job={detailJob} onClose={() => setDetailJob(null)} />

      {resumePreview.open ? (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/20"
            onClick={() => {
              if (resumePreview.url) URL.revokeObjectURL(resumePreview.url)
              setResumePreview({ open: false, resumeId: null, url: '', fileName: '' })
            }}
          />
          <div className="absolute inset-x-0 top-6 px-6 flex justify-center">
            <div className="w-[min(900px,calc(100vw-48px))] max-h-[calc(100vh-48px)] bg-white border border-gray-200 rounded-2xl shadow-subtle overflow-hidden flex flex-col">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-charcoal-dark">{resumePreview.fileName}</div>
                <button
                  type="button"
                  onClick={() => {
                    if (resumePreview.url) URL.revokeObjectURL(resumePreview.url)
                    setResumePreview({ open: false, resumeId: null, url: '', fileName: '' })
                  }}
                  className="text-xs text-gray-400 hover:text-charcoal transition-colors"
                >
                  Close
                </button>
              </div>
              <div className="p-0 overflow-auto min-h-0">
                <iframe title="Resume preview" src={resumePreview.url} className="w-full h-[78vh]" />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

