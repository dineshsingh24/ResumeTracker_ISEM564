import { useEffect, useMemo, useState } from 'react'
import { BadgeCheck, Plus, RefreshCcw } from 'lucide-react'

import { apiFetch, getApiBaseUrl } from '../auth.js'
import { AlertBubble } from '../components/AlertBubble.jsx'

export function RolesPage() {
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), [])
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshProgress, setRefreshProgress] = useState(0)
  const [error, setError] = useState('')

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
    if (pct >= 95) return { fg: 'text-amber-500', bg: 'bg-amber-50', label: 'Excellent match' }
    if (pct >= 80) return { fg: 'text-emerald-600', bg: 'bg-emerald-50', label: 'Strong match' }
    if (pct >= 65) return { fg: 'text-yellow-600', bg: 'bg-yellow-50', label: 'Moderate match' }
    return { fg: 'text-red-600', bg: 'bg-red-50', label: 'Low match' }
  }

  async function loadJobs() {
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch(`${apiBaseUrl}/jobs`)
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      const list = Array.isArray(data) ? data : []
      list.sort((a, b) => (Number(b.rank_score) || 0) - (Number(a.rank_score) || 0))
      setRows(list)
    } catch (e) {
      setError('Could not load roles. Start the backend server and try again.')
    } finally {
      setLoading(false)
    }
  }

  async function refreshFromUrls() {
    setRefreshing(true)
    setError('')
    setRefreshProgress(8)
    const t = window.setInterval(() => {
      setRefreshProgress((p) => (p >= 92 ? p : p + 6))
    }, 350)
    try {
      const res = await apiFetch(`${apiBaseUrl}/search_urls/fetch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 20 }),
      })
      if (!res.ok) throw new Error('Failed to refresh')
      let created = []
      try {
        created = await res.json()
      } catch {}
      await loadJobs()
      setRefreshProgress(100)
      await loadJobs()
    } catch (e) {
      setError('Could not refresh roles. Ensure you have saved Search URLs and try again.')
    } finally {
      window.clearInterval(t)
      window.setTimeout(() => setRefreshProgress(0), 600)
      setRefreshing(false)
    }
  }

  async function trackJob(jobId) {
    try {
      const res = await apiFetch(`${apiBaseUrl}/jobs/${jobId}/track`, { method: 'POST' })
      if (!res.ok) throw new Error('track failed')
      const updated = await res.json()
      setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
    } catch (e) {
      setError('Could not add this role to your tracker.')
    }
  }

  useEffect(() => {
    loadJobs().catch(() => {})
  }, [apiBaseUrl])

  return (
    <div className="max-w-3xl mx-auto py-12 px-6 space-y-10">
      <header className="mb-2">
        <h1 className="text-3xl font-bold text-charcoal-dark tracking-tight mb-2">Daily Role Feed</h1>
        <p className="text-gray-500">Review new roles from your saved Search URLs with ranking.</p>
      </header>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => refreshFromUrls().catch(() => {})}
            disabled={refreshing}
            className={`inline-flex items-center px-5 py-2.5 rounded-lg text-sm font-medium transition-colors shadow-sm ${
              refreshing ? 'bg-gray-200 text-gray-500 cursor-not-allowed' : 'bg-charcoal text-white hover:bg-black'
            }`}
          >
            <RefreshCcw className="w-4 h-4 mr-2" />
            {refreshing ? 'Refreshing' : 'Refresh roles'}
          </button>
          {refreshing ? (
            <div className="w-56">
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-charcoal/80 rounded-full transition-all"
                  style={{ width: `${Math.max(6, Math.min(100, refreshProgress || 0))}%` }}
                />
              </div>
            </div>
          ) : null}
        </div>
        <div className="text-xs text-gray-400">Roles are ranked using your rules and the job content we can extract.</div>
      </div>

      {error ? (
        <AlertBubble message={error} />
      ) : null}

      <div className="bg-white border border-gray-100 rounded-2xl shadow-subtle overflow-hidden">
        <div className="px-8 py-5 border-b border-gray-50 flex items-center justify-between">
          <div className="text-sm font-semibold text-charcoal-dark">Ranked roles</div>
          <div className="text-xs text-gray-400">{rows.length} total</div>
        </div>
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50/50">
              <tr className="text-left text-gray-500 text-xs uppercase tracking-wider">
                <th className="px-4 py-3 font-semibold">Match</th>
                <th className="px-4 py-3 font-semibold">Title</th>
                <th className="px-4 py-3 font-semibold">Company</th>
                <th className="px-4 py-3 font-semibold">Location</th>
                <th className="px-4 py-3 font-semibold">Added</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {loading ? (
                <tr>
                  <td className="px-4 py-4 text-gray-500" colSpan={6}>
                    Loading roles...
                  </td>
                </tr>
              ) : rows.length ? (
                (() => {
                  const max = getMaxRankScore(rows)
                  return rows.map((r) => {
                  const pct = toMatchPercentile(r.rank_score, max)
                  const tone = matchTone(pct)
                  return (
                  <tr key={r.id} className="hover:bg-gray-50/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="inline-flex items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-gray-200 ${tone.bg}`}
                          title={tone.label}
                        >
                          <BadgeCheck className={`w-4 h-4 ${tone.fg}`} />
                          <span className="text-xs font-semibold text-charcoal-dark tabular-nums">{pct}%</span>
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-charcoal-dark">{r.title}</td>
                    <td className="px-4 py-3 text-gray-600">{r.company || '-'}</td>
                    <td className="px-4 py-3 text-gray-600">{r.location || '-'}</td>
                    <td className="px-4 py-3 text-gray-600">{r.date_added ? new Date(r.date_added).toLocaleString() : '-'}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => trackJob(r.id)}
                        disabled={Boolean(r.is_tracked)}
                        className={`inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                          r.is_tracked
                            ? 'bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed'
                            : 'bg-white text-charcoal border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <Plus className="w-4 h-4 mr-2" />
                        {r.is_tracked ? 'In tracker' : 'Add to tracker'}
                      </button>
                    </td>
                  </tr>
                  )
                  })
                })()
              ) : (
                <tr>
                  <td className="px-4 py-4 text-gray-500" colSpan={6}>
                    No roles yet. Save a Search URL in Configuration and click Refresh roles.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

