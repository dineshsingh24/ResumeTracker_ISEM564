import { useEffect, useMemo, useState } from 'react'
import { BarChart3, Download, FileText } from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { apiFetch, getApiBaseUrl } from '../auth.js'
import { AlertBubble } from '../components/AlertBubble.jsx'

const CHART_COLORS = ['#111827', '#4B5563', '#6B7280', '#9CA3AF', '#D1D5DB', '#E5E7EB']

function DrilldownModal({ open, title, rows, onClose, onDownload }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="absolute inset-x-0 top-8 px-6 flex justify-center">
        <div className="w-[min(1100px,calc(100vw-48px))] max-h-[calc(100vh-64px)] bg-white border border-gray-200 rounded-2xl shadow-subtle overflow-hidden flex flex-col">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-charcoal-dark">{title}</div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onDownload}
                className="inline-flex items-center px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
              >
                <Download className="w-4 h-4 mr-2" />
                Download
              </button>
              <button type="button" onClick={onClose} className="text-xs text-gray-400 hover:text-charcoal transition-colors">
                Close
              </button>
            </div>
          </div>
          <div className="p-0 overflow-auto min-h-0">
            <table className="w-full text-sm">
              <thead className="bg-gray-50/50 sticky top-0">
                <tr className="text-left text-gray-500 text-xs uppercase tracking-wider">
                  {rows && rows.length ? Object.keys(rows[0]).map((k) => <th key={k} className="px-4 py-3 font-semibold">{k}</th>) : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {rows && rows.length ? (
                  rows.map((r, idx) => (
                    <tr key={idx} className="hover:bg-gray-50/30 transition-colors">
                      {Object.keys(rows[0]).map((k) => (
                        <td key={k} className="px-4 py-3 text-gray-700 align-top">
                          {typeof r[k] === 'object' ? JSON.stringify(r[k]) : String(r[k] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-4 py-4 text-gray-500">No data</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

export function AnalyticsPage() {
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), [])
  const [summary, setSummary] = useState(null)
  const [series, setSeries] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [drill, setDrill] = useState({ open: false, title: '', kind: '', value: '', rows: [] })
  const [reportOpen, setReportOpen] = useState(false)
  const [reportData, setReportData] = useState(null)

  async function loadSummary() {
    setLoading(true)
    setError('')
    try {
      const [sumRes, tsRes] = await Promise.all([
        apiFetch(`${apiBaseUrl}/me/analytics/summary`),
        apiFetch(`${apiBaseUrl}/me/analytics/timeseries?days=21`),
      ])
      if (!sumRes.ok) throw new Error('failed')
      const sum = await sumRes.json()
      setSummary(sum)
      const ts = tsRes.ok ? await tsRes.json() : { series: [] }
      setSeries(Array.isArray(ts.series) ? ts.series : [])
    } catch {
      setError('Could not load analytics.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSummary().catch(() => {})
  }, [apiBaseUrl])

  async function openDrill(kind, value, title) {
    try {
      const url = new URL(`${apiBaseUrl}/me/analytics/drilldown`)
      url.searchParams.set('kind', kind)
      if (value) url.searchParams.set('value', String(value))
      const res = await apiFetch(url.toString())
      const data = res.ok ? await res.json() : { rows: [] }
      setDrill({ open: true, title, kind, value: value || '', rows: Array.isArray(data.rows) ? data.rows : [] })
    } catch {
      setDrill({ open: true, title, kind, value: value || '', rows: [] })
    }
  }

  async function downloadAllReport() {
    const useAi = summary && summary.analytics_ai_enabled ? 'true' : 'false'
    const res = await apiFetch(`${apiBaseUrl}/me/analytics/report?use_ai=${useAi}`)
    if (!res.ok) return
    const data = await res.json()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'analytics-report.json'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  async function openReportPopup() {
    const useAi = summary && summary.analytics_ai_enabled ? 'true' : 'false'
    const res = await apiFetch(`${apiBaseUrl}/me/analytics/report?use_ai=${useAi}`)
    if (!res.ok) return
    const data = await res.json()
    setReportData(data)
    setReportOpen(true)
  }

  const companies = summary?.companies || []
  const sources = summary?.sources || []
  const resumes = summary?.resumes || []
  const aiUsage = summary?.ai_usage || []
  const pieCompanies = companies.slice(0, 6).map((c) => ({ name: c.company, value: Number(c.count) || 0 }))
  const pieResumes = resumes.slice(0, 6).map((r) => ({ name: r.file_name, value: Number(r.count) || 0 }))
  const barSources = sources.slice(0, 10).map((s) => ({ name: s.name, count: Number(s.count) || 0, id: s.rss_source_id }))
  const barAgents = aiUsage.slice(0, 8).map((a) => ({ name: a.provider, count: Number(a.count) || 0 }))

  return (
    <div className="max-w-7xl mx-auto py-12 px-6 space-y-8">
      <header className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-3xl font-bold text-charcoal-dark tracking-tight mb-2">Analytics</h1>
          <p className="text-gray-500">Telemetry for role extraction, matching, and AI usage.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => loadSummary().catch(() => {})}
            className="inline-flex items-center px-4 py-2.5 rounded-lg text-sm font-medium border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
          >
            <BarChart3 className="w-4 h-4 mr-2" />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => openReportPopup().catch(() => {})}
            className="inline-flex items-center px-4 py-2.5 rounded-lg text-sm font-medium bg-charcoal text-white hover:bg-black transition-colors shadow-sm"
          >
            <FileText className="w-4 h-4 mr-2" />
            View report
          </button>
        </div>
      </header>

      {error ? <AlertBubble message={error} /> : null}
      {loading ? <div className="text-sm text-gray-500">Loading analytics...</div> : null}

      {summary ? (
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12 md:col-span-7 bg-white border border-gray-100 rounded-2xl shadow-subtle overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-charcoal-dark">Extraction over time</div>
                <div className="text-xs text-gray-400">Extracted and duplicate rows by day</div>
              </div>
              <button
                type="button"
                onClick={() => openDrill('url_fetch', '', 'URL fetch events').catch(() => {})}
                className="text-xs text-gray-400 hover:text-charcoal transition-colors"
              >
                View events
              </button>
            </div>
            <div className="p-4 h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series}>
                  <defs>
                    <linearGradient id="gExtracted" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#111827" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#111827" stopOpacity={0.03} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                  <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#6B7280' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} />
                  <Tooltip />
                  <Legend />
                  <Area type="monotone" dataKey="extracted" stroke="#111827" fill="url(#gExtracted)" />
                  <Area type="monotone" dataKey="duplicates" stroke="#6B7280" fill="#E5E7EB" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="col-span-12 md:col-span-5 grid grid-cols-1 gap-4">
            <div className="bg-white border border-gray-100 rounded-2xl shadow-subtle p-6">
              <div className="text-xs uppercase tracking-wider text-gray-400 font-semibold">Total roles</div>
              <div className="mt-2 text-4xl font-bold text-charcoal-dark tabular-nums">{summary.total_jobs}</div>
              <div className="mt-1 text-xs text-gray-400">All extracted roles in your account</div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white border border-gray-100 rounded-2xl shadow-subtle p-6">
                <div className="text-xs uppercase tracking-wider text-gray-400 font-semibold">Tracked</div>
                <div className="mt-2 text-3xl font-bold text-charcoal-dark tabular-nums">{summary.tracked_jobs}</div>
              </div>
              <div className="bg-white border border-gray-100 rounded-2xl shadow-subtle p-6">
                <div className="text-xs uppercase tracking-wider text-gray-400 font-semibold">AI calls</div>
                <div className="mt-2 text-3xl font-bold text-charcoal-dark tabular-nums">
                  {aiUsage.reduce((a, b) => a + (Number(b.count) || 0), 0)}
                </div>
              </div>
            </div>
          </div>

          <div className="col-span-12 md:col-span-4 bg-white border border-gray-100 rounded-2xl shadow-subtle overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
              <div className="text-sm font-semibold text-charcoal-dark">Companies</div>
              <button
                type="button"
                onClick={() => openDrill('company', '', 'Company breakdown').catch(() => {})}
                className="text-xs text-gray-400 hover:text-charcoal transition-colors"
              >
                Drill down
              </button>
            </div>
            <div className="p-4 h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Tooltip />
                  <Pie data={pieCompanies} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90}>
                    {pieCompanies.map((_, idx) => (
                      <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="col-span-12 md:col-span-4 bg-white border border-gray-100 rounded-2xl shadow-subtle overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
              <div className="text-sm font-semibold text-charcoal-dark">Resume usage</div>
              <button
                type="button"
                onClick={() => openDrill('resume', '', 'Resume usage').catch(() => {})}
                className="text-xs text-gray-400 hover:text-charcoal transition-colors"
              >
                Drill down
              </button>
            </div>
            <div className="p-4 h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Tooltip />
                  <Pie data={pieResumes} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90}>
                    {pieResumes.map((_, idx) => (
                      <Cell key={idx} fill={CHART_COLORS[(idx + 2) % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="col-span-12 md:col-span-4 bg-white border border-gray-100 rounded-2xl shadow-subtle overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
              <div className="text-sm font-semibold text-charcoal-dark">AI usage</div>
              <button
                type="button"
                onClick={() => openDrill('ai_calls', '', 'AI calls').catch(() => {})}
                className="text-xs text-gray-400 hover:text-charcoal transition-colors"
              >
                View calls
              </button>
            </div>
            <div className="p-4 h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barAgents}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6B7280' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#111827" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="col-span-12 bg-white border border-gray-100 rounded-2xl shadow-subtle overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
              <div className="text-sm font-semibold text-charcoal-dark">Top URLs by roles</div>
              <div className="text-xs text-gray-400">Click a bar to drill down</div>
            </div>
            <div className="p-4 h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barSources}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6B7280' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} />
                  <Tooltip />
                  <Bar
                    dataKey="count"
                    fill="#111827"
                    radius={[6, 6, 0, 0]}
                    onClick={(data) => {
                      if (data && data.id) openDrill('source', data.id, `URL: ${data.name}`).catch(() => {})
                    }}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex justify-center pt-2">
        <button
          type="button"
          onClick={() => downloadAllReport().catch(() => {})}
          className="inline-flex items-center px-6 py-3 rounded-xl text-sm font-medium bg-white border border-gray-200 hover:bg-gray-50 transition-colors"
        >
          <Download className="w-4 h-4 mr-2" />
          Download report
        </button>
      </div>

      <DrilldownModal
        open={drill.open}
        title={drill.title}
        rows={drill.rows}
        onClose={() => setDrill((d) => ({ ...d, open: false }))}
        onDownload={() => downloadAllReport().catch(() => {})}
      />

      {reportOpen && reportData ? (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/20" onClick={() => setReportOpen(false)} />
          <div className="absolute inset-x-0 top-8 px-6 flex justify-center">
            <div className="w-[min(1100px,calc(100vw-48px))] max-h-[calc(100vh-64px)] bg-white border border-gray-200 rounded-2xl shadow-subtle overflow-hidden flex flex-col">
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-charcoal-dark">Analytics report</div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => downloadAllReport().catch(() => {})}
                    className="inline-flex items-center px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download
                  </button>
                  <button type="button" onClick={() => setReportOpen(false)} className="text-xs text-gray-400 hover:text-charcoal transition-colors">
                    Close
                  </button>
                </div>
              </div>
              <div className="p-6 overflow-auto min-h-0 space-y-4">
                {reportData.ai_report_markdown ? (
                  <div className="prose prose-sm max-w-none">
                    <pre className="whitespace-pre-wrap text-sm text-gray-700">{reportData.ai_report_markdown}</pre>
                  </div>
                ) : (
                  <div className="text-sm text-gray-500">AI report is disabled or not available.</div>
                )}
                <div className="text-xs text-gray-400">Raw report JSON is available via Download.</div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

