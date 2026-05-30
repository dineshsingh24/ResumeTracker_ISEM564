import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BarChart3,
  Bot,
  Brain,
  Cpu,
  Eye,
  Globe,
  KeyRound,
  LogOut,
  RotateCcw,
  Rss,
  Save,
  Trash2,
  UploadCloud,
  User,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { apiFetch, getApiBaseUrl } from '../auth.js'
import { AlertBubble } from '../components/AlertBubble.jsx'

export function ConfigPage() {
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), [])

  const [resumeFile, setResumeFile] = useState(null)
  const [resumeRows, setResumeRows] = useState([])
  const [resumeRowsLoading, setResumeRowsLoading] = useState(false)
  const [resumePreview, setResumePreview] = useState({ open: false, resumeId: null, url: '', fileName: '' })
  const [resumeDeletingId, setResumeDeletingId] = useState(null)
  const [profileSummary, setProfileSummary] = useState('')
  const [customWeightPrompt, setCustomWeightPrompt] = useState('')
  const [weightPrompts, setWeightPrompts] = useState([])
  const [weightPromptsLoading, setWeightPromptsLoading] = useState(false)
  const [weightPromptSaving, setWeightPromptSaving] = useState(false)
  const [weightPromptDeletingId, setWeightPromptDeletingId] = useState(null)
  const [triggerEnabled, setTriggerEnabled] = useState(() => window.localStorage.getItem('rt_trigger_enabled') === '1')
  const [triggerMinutes, setTriggerMinutes] = useState(() => {
    const raw = window.localStorage.getItem('rt_trigger_minutes')
    const n = raw ? Number(raw) : 60
    return Number.isFinite(n) && n > 0 ? n : 60
  })
  const [triggerRunning, setTriggerRunning] = useState(false)
  const [triggerLastRunAt, setTriggerLastRunAt] = useState(() => window.localStorage.getItem('rt_trigger_last_run_at') || '')
  const [rssName, setRssName] = useState('')
  const [rssUrl, setRssUrl] = useState('')
  const [rssSources, setRssSources] = useState([])
  const [rssSourcesLoading, setRssSourcesLoading] = useState(false)
  const [rssSubmitting, setRssSubmitting] = useState(false)
  const [rssTesting, setRssTesting] = useState(false)
  const [rssTestProgress, setRssTestProgress] = useState(0)
  const rssTestProgressTimerRef = useRef(null)
  const [rssDeletingId, setRssDeletingId] = useState(null)
  const [rssPreviewRows, setRssPreviewRows] = useState([])
  const [rssPreviewOpen, setRssPreviewOpen] = useState(false)
  const [rssPreviewTitle, setRssPreviewTitle] = useState('URL Preview')
  const [profileBalloon, setProfileBalloon] = useState({ open: false, mode: 'message', title: '', content: '' })
  const profileBalloonTimerRef = useRef(null)
  const [rssFieldBubbles, setRssFieldBubbles] = useState({ name: '', url: '', add: '' })
  const rssFieldBubbleCloseTimerRef = useRef(null)
  const [rssAttentionFields, setRssAttentionFields] = useState({ name: false, url: false, add: false })
  const [resumeBubble, setResumeBubble] = useState('')
  const [resumeNeedsFocus, setResumeNeedsFocus] = useState(false)
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false)
  const resumeInputRef = useRef(null)

  const [aiAgents, setAiAgents] = useState([])
  const [aiDefaultAgentId, setAiDefaultAgentId] = useState('')
  const [aiSelectedProvider, setAiSelectedProvider] = useState(null)
  const [aiForm, setAiForm] = useState({ name: '', apiKey: '', baseUrl: '', model: '' })
  const [aiBalloon, setAiBalloon] = useState({ open: false, title: '', content: '' })
  const aiBalloonTimerRef = useRef(null)
  const [analyticsAiEnabled, setAnalyticsAiEnabled] = useState(false)

  useEffect(() => {
    window.localStorage.setItem('rt_trigger_enabled', triggerEnabled ? '1' : '0')
  }, [triggerEnabled])

  useEffect(() => {
    window.localStorage.setItem('rt_trigger_minutes', String(triggerMinutes))
  }, [triggerMinutes])

  useEffect(() => {
    if (triggerLastRunAt) window.localStorage.setItem('rt_trigger_last_run_at', String(triggerLastRunAt))
  }, [triggerLastRunAt])

  async function loadAiConnections() {
    try {
      const res = await apiFetch(`${apiBaseUrl}/ai_connections`)
      const data = res.ok ? await res.json() : []
      const rows = Array.isArray(data) ? data : []
      setAiAgents(rows)
      const def = rows.find((r) => Boolean(r.is_default))
      setAiDefaultAgentId(def ? String(def.id) : '')
    } catch {
      setAiAgents([])
      setAiDefaultAgentId('')
    }
  }

  useEffect(() => {
    loadAiConnections().catch(() => {})
  }, [apiBaseUrl])

  useEffect(() => {
    return () => {
      if (aiBalloonTimerRef.current) window.clearTimeout(aiBalloonTimerRef.current)
      if (rssTestProgressTimerRef.current) window.clearInterval(rssTestProgressTimerRef.current)
      if (rssFieldBubbleCloseTimerRef.current) window.clearTimeout(rssFieldBubbleCloseTimerRef.current)
    }
  }, [])

  const trimmedRssName = rssName.trim()
  const trimmedRssUrl = rssUrl.trim()
  const rssNameError = !trimmedRssName ? 'URL name is required.' : ''
  const rssUrlError = !trimmedRssUrl
    ? 'URL is required.'
    : /^https?:\/\/.+/i.test(trimmedRssUrl)
      ? ''
      : 'Enter a valid URL.'
  const canAddFeed = !rssSubmitting
  const canTestFeed = !rssSubmitting && !rssTesting

  function showAiBalloon(title, content, autoCloseMs) {
    if (aiBalloonTimerRef.current) window.clearTimeout(aiBalloonTimerRef.current)
    setAiBalloon({ open: true, title, content })
    if (autoCloseMs) {
      aiBalloonTimerRef.current = window.setTimeout(() => setAiBalloon((b) => ({ ...b, open: false })), autoCloseMs)
    }
  }

  function showRssFieldBubble(field, message) {
    if (rssFieldBubbleCloseTimerRef.current) window.clearTimeout(rssFieldBubbleCloseTimerRef.current)
    setRssFieldBubbles((prev) => ({ ...prev, [field]: message }))
    if (field === 'name' || field === 'url' || field === 'add') {
      setRssAttentionFields((prev) => ({ ...prev, [field]: true }))
    }
  }

  function scheduleCloseRssFieldBubble(field) {
    if (!field) return
    if (rssFieldBubbleCloseTimerRef.current) window.clearTimeout(rssFieldBubbleCloseTimerRef.current)
    setRssFieldBubbles((prev) => ({ ...prev, [field]: '' }))
    setRssAttentionFields((prev) => ({ ...prev, [field]: false }))
  }

  function FieldBubble({ field }) {
    return <AlertBubble message={rssFieldBubbles[field] || ''} />
  }

  const aiProviders = [
    {
      id: 'openai',
      label: 'OpenAI',
      icon: Brain,
      fields: { apiKey: true, baseUrl: false, model: true },
      defaults: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
    },
    {
      id: 'gemini',
      label: 'Gemini',
      icon: Cpu,
      fields: { apiKey: true, baseUrl: false, model: true },
      defaults: { baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-2.0-flash' },
    },
    {
      id: 'anthropic',
      label: 'Anthropic',
      icon: Bot,
      fields: { apiKey: true, baseUrl: false, model: true },
      defaults: { baseUrl: 'https://api.anthropic.com', model: 'claude-3-5-sonnet-latest' },
    },
    {
      id: 'custom',
      label: 'Custom',
      icon: Globe,
      fields: { apiKey: false, baseUrl: true, model: true },
      defaults: { baseUrl: 'http://localhost:8001', model: 'local-model' },
    },
  ]

  function openAiProvider(providerId) {
    const p = aiProviders.find((x) => x.id === providerId) || null
    setAiSelectedProvider(p)
    if (!p) return
    setAiForm({
      name: `${p.label} connection`,
      apiKey: '',
      baseUrl: p.defaults.baseUrl,
      model: p.defaults.model,
    })
  }

  async function saveAiAgent() {
    if (!aiSelectedProvider) return
    const name = (aiForm.name || '').trim()
    const baseUrl = (aiForm.baseUrl || '').trim()
    const model = (aiForm.model || '').trim()
    const apiKey = (aiForm.apiKey || '').trim()

    if (!name) {
      showAiBalloon('Name required', 'Enter a connection name.', 2400)
      return
    }
    if (aiSelectedProvider.fields.baseUrl && !baseUrl) {
      showAiBalloon('Base URL required', 'Enter the server URL for your custom agent.', 2400)
      return
    }
    if (aiSelectedProvider.fields.apiKey && !apiKey) {
      showAiBalloon('API key required', 'Enter your API key.', 2400)
      return
    }
    if (!model) {
      showAiBalloon('Model required', 'Enter a model name.', 2400)
      return
    }

    try {
      const res = await apiFetch(`${apiBaseUrl}/ai_connections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          provider: aiSelectedProvider.id,
          base_url: aiSelectedProvider.fields.baseUrl ? baseUrl : null,
          model,
          api_key: aiSelectedProvider.fields.apiKey ? apiKey : null,
          is_default: !aiDefaultAgentId,
        }),
      })
      if (!res.ok) {
        let detail = 'Could not save connection.'
        try {
          const data = await res.json()
          if (data && typeof data.detail === 'string' && data.detail.trim()) detail = data.detail
        } catch {}
        showAiBalloon('Save failed', detail, 2400)
        return
      }
      setAiSelectedProvider(null)
      setAiForm({ name: '', apiKey: '', baseUrl: '', model: '' })
      await loadAiConnections()
      showAiBalloon('Saved', 'AI connection saved.', 1800)
    } catch {
      showAiBalloon('Save failed', 'Could not save connection.', 2400)
    }
  }

  async function removeAiAgent(agentId) {
    try {
      await apiFetch(`${apiBaseUrl}/ai_connections/${agentId}`, { method: 'DELETE' })
    } catch {}
    await loadAiConnections()
  }

  function AiBalloon() {
    if (!aiBalloon.open) return null
    return (
      <div
        className="absolute right-0 top-full mt-3 w-[min(520px,calc(100vw-48px))] origin-top-right"
        style={{ animation: 'rtInflate 350ms ease-out' }}
      >
        <div className="bg-white border border-gray-200 rounded-2xl shadow-subtle overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-charcoal-dark">{aiBalloon.title}</div>
            <button
              type="button"
              onClick={() => setAiBalloon((b) => ({ ...b, open: false }))}
              className="text-xs text-gray-400 hover:text-charcoal transition-colors"
            >
              Close
            </button>
          </div>
          <div className="px-5 py-4">
            <div className="text-sm text-gray-600 leading-6">{aiBalloon.content}</div>
          </div>
        </div>
      </div>
    )
  }

  async function getCurrentUserId() {
    const res = await apiFetch(`${apiBaseUrl}/auth/me`)
    if (!res.ok) return null
    const data = await res.json()
    if (!data || !data.id) return null
    if (typeof data.analytics_ai_enabled === 'boolean') setAnalyticsAiEnabled(Boolean(data.analytics_ai_enabled))
    return Number(data.id)
  }

  async function loadResumes() {
    setResumeRowsLoading(true)
    try {
      const res = await apiFetch(`${apiBaseUrl}/me/resumes`)
      if (!res.ok) {
        setResumeRows([])
        return
      }
      const data = await res.json()
      setResumeRows(Array.isArray(data) ? data : [])
    } catch {
      setResumeRows([])
    } finally {
      setResumeRowsLoading(false)
    }
  }

  async function loadRssSources() {
    setRssSourcesLoading(true)
    try {
      const userId = await getCurrentUserId()
      if (!userId) {
        setRssSources([])
        return
      }
      const res = await apiFetch(`${apiBaseUrl}/rss_sources`)
      if (!res.ok) {
        setRssSources([])
        return
      }
      const data = await res.json()
      const rows = Array.isArray(data) ? data.filter((row) => Number(row.user_id) === userId) : []
      setRssSources(rows)
    } catch {
      setRssSources([])
    } finally {
      setRssSourcesLoading(false)
    }
  }

  useEffect(() => {
    loadResumes().catch(() => {})
  }, [apiBaseUrl])

  useEffect(() => {
    loadRssSources().catch(() => {})
  }, [apiBaseUrl])

  async function loadWeightPrompts() {
    setWeightPromptsLoading(true)
    try {
      const res = await apiFetch(`${apiBaseUrl}/me/job_weight_prompts`)
      const data = res.ok ? await res.json() : []
      setWeightPrompts(Array.isArray(data) ? data : [])
    } catch {
      setWeightPrompts([])
    } finally {
      setWeightPromptsLoading(false)
    }
  }

  useEffect(() => {
    loadWeightPrompts().catch(() => {})
  }, [apiBaseUrl])

  useEffect(() => {
    return () => {
      if (profileBalloonTimerRef.current) window.clearTimeout(profileBalloonTimerRef.current)
    }
  }, [])

  function closeProfileBalloonSoon(delayMs) {
    if (profileBalloonTimerRef.current) window.clearTimeout(profileBalloonTimerRef.current)
    profileBalloonTimerRef.current = window.setTimeout(() => {
      setProfileBalloon((b) => ({ ...b, open: false }))
    }, delayMs)
  }

  function showProfileBalloon(next) {
    if (profileBalloonTimerRef.current) window.clearTimeout(profileBalloonTimerRef.current)
    setProfileBalloon({ ...next, open: true })
  }

  async function handleAddWeightPrompt() {
    const text = (customWeightPrompt || '').trim()
    if (!text) {
      showProfileBalloon({ mode: 'message', title: 'Prompt required', content: 'Enter a prompt.' })
      closeProfileBalloonSoon(2200)
      return
    }
    if (weightPromptSaving) return
    setWeightPromptSaving(true)
    try {
      const res = await apiFetch(`${apiBaseUrl}/me/job_weight_prompts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text, is_enabled: true }),
      })
      if (!res.ok) {
        let detail = 'Could not save prompt.'
        try {
          const data = await res.json()
          if (data && typeof data.detail === 'string' && data.detail.trim()) detail = data.detail
        } catch {}
        showProfileBalloon({ mode: 'message', title: 'Save failed', content: detail })
        closeProfileBalloonSoon(2400)
        return
      }
      const created = await res.json()
      setWeightPrompts((prev) => [created, ...prev])
      setCustomWeightPrompt('')
      showProfileBalloon({ mode: 'message', title: 'Prompt saved', content: 'Your prompt is now available for scoring.' })
      closeProfileBalloonSoon(1400)
    } catch {
      showProfileBalloon({ mode: 'message', title: 'Save failed', content: 'Could not save prompt.' })
      closeProfileBalloonSoon(2400)
    } finally {
      setWeightPromptSaving(false)
    }
  }

  async function handleToggleWeightPrompt(promptId, nextEnabled) {
    try {
      const res = await apiFetch(`${apiBaseUrl}/me/job_weight_prompts/${promptId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_enabled: Boolean(nextEnabled) }),
      })
      if (!res.ok) return
      const updated = await res.json()
      setWeightPrompts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
    } catch {}
  }

  async function handleDeleteWeightPrompt(promptId) {
    if (weightPromptDeletingId) return
    setWeightPromptDeletingId(promptId)
    try {
      const res = await apiFetch(`${apiBaseUrl}/me/job_weight_prompts/${promptId}`, { method: 'DELETE' })
      if (res.ok) setWeightPrompts((prev) => prev.filter((p) => p.id !== promptId))
    } finally {
      setWeightPromptDeletingId(null)
    }
  }

  async function runTriggerFetch({ silent } = { silent: false }) {
    if (triggerRunning) return
    setTriggerRunning(true)
    try {
      const res = await apiFetch(`${apiBaseUrl}/search_urls/fetch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 20 }),
      })
      if (!res.ok) {
        if (!silent) {
          showProfileBalloon({
            mode: 'message',
            title: 'Refresh failed',
            content: 'Could not refresh roles. Ensure the backend server is running.',
          })
          closeProfileBalloonSoon(2400)
        }
        return
      }
      const data = await res.json()
      const count = Array.isArray(data) ? data.length : 0
      const stamp = new Date().toISOString()
      setTriggerLastRunAt(stamp)
      if (!silent) {
        showProfileBalloon({
          mode: 'message',
          title: 'Refresh complete',
          content: count ? `Added ${count} roles.` : 'No new roles were found.',
        })
        closeProfileBalloonSoon(1600)
      }
    } catch {
      if (!silent) {
        showProfileBalloon({
          mode: 'message',
          title: 'Refresh failed',
          content: 'Could not refresh roles. Ensure the backend server is running.',
        })
        closeProfileBalloonSoon(2400)
      }
    } finally {
      setTriggerRunning(false)
    }
  }

  useEffect(() => {
    if (!triggerEnabled) return
    const ms = Math.max(1, Number(triggerMinutes) || 60) * 60_000
    const id = window.setInterval(() => {
      runTriggerFetch({ silent: true }).catch(() => {})
    }, ms)
    return () => window.clearInterval(id)
  }, [apiBaseUrl, triggerEnabled, triggerMinutes])

  async function handleUpdateProfile() {
    if (isUpdatingProfile) return

    if (!resumeFile || !(resumeFile instanceof File) || !resumeFile.name || resumeFile.size <= 0) {
      setResumeBubble('Resume required.')
      setResumeNeedsFocus(true)
      return
    }

    setIsUpdatingProfile(true)
    showProfileBalloon({ mode: 'message', title: 'Adding resume', content: 'Please wait while we save your resume.' })

    let timeoutId = null
    try {
      setResumeBubble('')
      setResumeNeedsFocus(false)
      const resumeFd = new FormData()
      resumeFd.append('file', resumeFile)
      const resumeRes = await apiFetch(`${apiBaseUrl}/me/resumes`, { method: 'POST', body: resumeFd })
      if (resumeRes.ok) {
        await loadResumes()
      } else if (resumeRes.status !== 409) {
        showProfileBalloon({ mode: 'message', title: 'Resume save failed', content: 'Could not save resume history.' })
        closeProfileBalloonSoon(2200)
      }

      const fd = new FormData()
      fd.append('file', resumeFile)

      const controller = new AbortController()
      timeoutId = window.setTimeout(() => controller.abort(), 60000)

      const res = await apiFetch(`${apiBaseUrl}/me/profile_from_resume`, { method: 'POST', body: fd, signal: controller.signal })

      if (!res.ok) throw new Error('profile update failed')
      const data = await res.json()
      const summary = String(data.profile_summary || '')
      setProfileSummary(summary)
      showProfileBalloon({ mode: 'message', title: 'Resume added', content: 'Your resume is now saved.' })
      closeProfileBalloonSoon(1100)

      setResumeFile(null)
      if (resumeInputRef.current) resumeInputRef.current.value = ''
    } catch (err) {
      const msg = String(err && err.message ? err.message : err || '')
      if (err && err.name === 'AbortError') {
        showProfileBalloon({
          mode: 'message',
          title: 'Add timed out',
          content: 'The upload is taking too long. Please try again.',
        })
        closeProfileBalloonSoon(2600)
        return
      }
      showProfileBalloon({
        mode: 'message',
        title: 'Add failed',
        content: msg ? 'Start the backend server and try again.' : 'Start the backend server and try again.',
      })
      closeProfileBalloonSoon(2600)
    } finally {
      if (timeoutId) window.clearTimeout(timeoutId)
      setIsUpdatingProfile(false)
    }
  }

  async function handleSelectResume(resumeId) {
    try {
      const res = await apiFetch(`${apiBaseUrl}/me/resumes/${resumeId}/select`, { method: 'POST' })
      if (!res.ok) return
      const selected = await res.json()
      setResumeRows((prev) => prev.map((r) => ({ ...r, is_selected: r.id === selected.id })))
    } catch {}
  }

  async function handleDeleteResume(resumeId) {
    if (resumeDeletingId) return
    setResumeDeletingId(resumeId)
    try {
      const res = await apiFetch(`${apiBaseUrl}/me/resumes/${resumeId}`, { method: 'DELETE' })
      if (res.ok) {
        setResumeRows((prev) => prev.filter((r) => r.id !== resumeId))
        if (resumePreview.open && resumePreview.resumeId === resumeId) setResumePreview({ open: false, resumeId: null, url: '', fileName: '' })
      }
    } finally {
      setResumeDeletingId(null)
    }
  }

  async function handleViewResume(resumeId, fileName) {
    try {
      const res = await apiFetch(`${apiBaseUrl}/me/resumes/${resumeId}/file`)
      if (!res.ok) return
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      setResumePreview({ open: true, resumeId, url, fileName })
    } catch {}
  }

  function ProfileBalloon() {
    if (!profileBalloon.open) return null

    const isData = profileBalloon.mode === 'data'
    return (
      <div
        className="absolute right-0 top-full mt-3 w-[min(520px,calc(100vw-48px))] origin-top-right"
        style={{
          animation: 'rtInflate 350ms ease-out',
        }}
      >
        <style>{`
@keyframes rtInflate {
  0% { transform: scale(0.92); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}
        `}</style>
        <div className="bg-white border border-gray-200 rounded-2xl shadow-subtle overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-charcoal-dark">{profileBalloon.title}</div>
            <button
              type="button"
              onClick={() => setProfileBalloon((b) => ({ ...b, open: false }))}
              className="text-xs text-gray-400 hover:text-charcoal transition-colors"
            >
              Close
            </button>
          </div>
          <div className={isData ? 'p-0' : 'px-5 py-4'}>
            {isData ? (
              <div className="max-h-[360px] overflow-auto">
                <pre className="whitespace-pre-wrap text-sm text-charcoal-dark px-5 py-4">{profileBalloon.content}</pre>
              </div>
            ) : (
              <div className="text-sm text-gray-600 leading-6">{profileBalloon.content}</div>
            )}
          </div>
        </div>
      </div>
    )
  }

  async function handleTestFeed() {
    const url = trimmedRssUrl
    if (rssUrlError) {
      showRssFieldBubble('url', 'Enter a valid URL.')
      return
    }
    setRssTesting(true)
    setRssTestProgress(8)
    showRssFieldBubble('add', 'Testing in progress.')
    if (rssTestProgressTimerRef.current) window.clearInterval(rssTestProgressTimerRef.current)
    rssTestProgressTimerRef.current = window.setInterval(() => {
      setRssTestProgress((prev) => (prev >= 92 ? prev : prev + 7))
    }, 450)
    try {
      const res = await apiFetch(`${apiBaseUrl}/rss/preview?url=${encodeURIComponent(url)}&limit=15`)
      if (!res.ok) {
        showProfileBalloon({
          mode: 'message',
          title: 'Test failed',
          content: 'Could not read this URL. Expected input is a valid search URL that the backend can parse.',
        })
        closeProfileBalloonSoon(2400)
        return
      }
      const data = await res.json()
      const rows = Array.isArray(data) ? data : []
      setRssTestProgress(100)
      setRssPreviewRows(rows)
      setRssPreviewTitle(`URL Preview (${rows.length} items)`)
      setRssPreviewOpen(true)
    } catch {
      showProfileBalloon({
        mode: 'message',
        title: 'Test failed',
        content: 'Could not read this URL. Expected input is a valid search URL that the backend can parse.',
      })
      closeProfileBalloonSoon(2400)
    } finally {
      if (rssTestProgressTimerRef.current) window.clearInterval(rssTestProgressTimerRef.current)
      window.setTimeout(() => {
        setRssTesting(false)
        setRssTestProgress(0)
        setRssFieldBubbles((prev) => ({ ...prev, add: '' }))
      }, 250)
    }
  }

  async function handleAddFeed() {
    if (rssTesting) {
      showRssFieldBubble('add', 'Testing URL in progress.')
      return
    }
    if (rssNameError || rssUrlError) {
      if (rssNameError) showRssFieldBubble('name', 'URL name is required.')
      if (rssUrlError) showRssFieldBubble('url', 'URL is required.')
      return
    }

    setRssSubmitting(true)
    try {
      const userId = await getCurrentUserId()
      if (!userId) {
        showProfileBalloon({ mode: 'message', title: 'User not found', content: 'Sign in again and try once more.' })
        closeProfileBalloonSoon(2200)
        return
      }

      const duplicate = rssSources.some(
        (row) =>
          String(row.name || '').trim().toLowerCase() === trimmedRssName.toLowerCase() ||
          String(row.url || '').trim().toLowerCase() === trimmedRssUrl.toLowerCase(),
      )
      if (duplicate) {
        showRssFieldBubble('url', 'URL already added.')
        return
      }

      const res = await apiFetch(`${apiBaseUrl}/rss_sources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          name: trimmedRssName,
          url: trimmedRssUrl,
          is_active: true,
        }),
      })

      if (!res.ok) {
        let detail = 'Could not save this URL.'
        try {
          const data = await res.json()
          if (data && typeof data.detail === 'string' && data.detail.trim()) detail = data.detail
        } catch {}
        showRssFieldBubble('url', detail)
        return
      }

      const created = await res.json()
      setRssSources((prev) => [created, ...prev])
      setRssName('')
      setRssUrl('')
      setRssPreviewOpen(false)
      showProfileBalloon({ mode: 'message', title: 'URL added', content: 'Your URL is now saved.' })
      closeProfileBalloonSoon(1400)
    } catch {
      showRssFieldBubble('url', 'Save failed. Try again.')
    } finally {
      setRssSubmitting(false)
    }
  }

  async function handleDeleteFeed(sourceId) {
    if (rssDeletingId) return
    setRssDeletingId(sourceId)
    try {
      const res = await apiFetch(`${apiBaseUrl}/rss_sources/${sourceId}`, { method: 'DELETE' })
      if (!res.ok) {
        showProfileBalloon({ mode: 'message', title: 'Delete failed', content: 'Could not delete this URL.' })
        closeProfileBalloonSoon(2200)
        return
      }
      setRssSources((prev) => prev.filter((row) => row.id !== sourceId))
      showProfileBalloon({ mode: 'message', title: 'URL deleted', content: 'The URL was removed.' })
      closeProfileBalloonSoon(1400)
    } catch {
      showProfileBalloon({ mode: 'message', title: 'Delete failed', content: 'Could not delete this URL.' })
      closeProfileBalloonSoon(2200)
    } finally {
      setRssDeletingId(null)
    }
  }

  return (
    <main className="max-w-3xl mx-auto py-12 px-6 space-y-10">
        <header className="mb-10">
          <h1 className="text-3xl font-bold text-charcoal-dark tracking-tight mb-2">Configuration</h1>
          <p className="text-gray-500">Manage your profile, adjust ranking weights, and configure search URLs.</p>
        </header>

        <section className="bg-white border border-gray-100 rounded-2xl shadow-subtle overflow-hidden">
          <div className="px-8 py-5 border-b border-gray-50 flex items-center">
            <div className="p-2 bg-gray-50 rounded-lg mr-3">
              <User className="w-5 h-5 text-charcoal-light" />
            </div>
            <h2 className="font-semibold text-charcoal-dark text-lg">User Profile</h2>
          </div>
          <div className="p-8 space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-2 md:col-span-2">
                <div className="text-sm text-gray-500">
                  Upload your resume and we will extract your profile details.
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-gray-400">Resume Upload</label>
              <label
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  const file = e.dataTransfer.files[0]
                  if (file && (file.type === 'application/pdf' || file.name.endsWith('.docx'))) setResumeFile(file)
                }}
                onClick={() => {
                  setResumeBubble('')
                  setResumeNeedsFocus(false)
                }}
                className={`group flex flex-col items-center justify-center w-full border-2 border-dashed rounded-xl p-8 transition-all cursor-pointer ${
                  resumeNeedsFocus ? 'border-red-300 ring-2 ring-red-100 bg-red-50/30' : 'border-gray-200 hover:border-charcoal hover:bg-gray-50'
                }`}
              >
                <input
                  type="file"
                  accept=".pdf,.docx"
                  className="hidden"
                  ref={resumeInputRef}
                  onChange={(e) => {
                    if (e.target.files[0]) {
                      setResumeFile(e.target.files[0])
                      setResumeBubble('')
                      setResumeNeedsFocus(false)
                    }
                  }}
                />
                {resumeFile ? (
                  <>
                    <UploadCloud className="w-8 h-8 text-charcoal mb-3" />
                    <p className="text-sm font-medium text-charcoal-dark mb-1">{resumeFile.name}</p>
                    <p className="text-xs text-gray-400">{(resumeFile.size / 1024).toFixed(1)} KB</p>
                  </>
                ) : (
                  <>
                    <UploadCloud className="w-8 h-8 text-gray-400 group-hover:text-charcoal mb-3 transition-colors" />
                    <p className="text-sm font-medium text-charcoal-dark mb-1">Click to upload or drag and drop</p>
                    <p className="text-xs text-gray-400">PDF, DOCX up to 5MB</p>
                  </>
                )}
              </label>
              <AlertBubble message={resumeBubble} />
            </div>

            <div className="flex justify-center relative">
              <button
                type="button"
                onClick={() => handleUpdateProfile()}
                disabled={isUpdatingProfile}
                className={`bg-charcoal text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors shadow-sm ${
                  isUpdatingProfile ? 'opacity-60 cursor-not-allowed' : 'hover:bg-black'
                }`}
              >
                Add resume
              </button>
              <ProfileBalloon />
            </div>

            <div className="bg-white border border-gray-100 rounded-2xl shadow-subtle overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-gray-50 rounded-lg">
                    <RotateCcw className="w-5 h-5 text-charcoal-light" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-charcoal-dark">Trigger</div>
                    <div className="text-xs text-gray-500">Automatically refresh roles from your saved URLs.</div>
                  </div>
                </div>
                <label className="inline-flex items-center gap-2 text-sm text-gray-600 select-none">
                  <input
                    type="checkbox"
                    checked={Boolean(triggerEnabled)}
                    onChange={(e) => setTriggerEnabled(Boolean(e.target.checked))}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  Enabled
                </label>
              </div>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-wider text-gray-400">Frequency</label>
                    <select
                      value={String(triggerMinutes)}
                      onChange={(e) => setTriggerMinutes(Number(e.target.value) || 60)}
                      className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-charcoal-dark bg-white focus:outline-none focus:ring-2 focus:ring-charcoal/10"
                    >
                      <option value="15">Every 15 minutes</option>
                      <option value="30">Every 30 minutes</option>
                      <option value="60">Every 1 hour</option>
                      <option value="360">Every 6 hours</option>
                      <option value="1440">Every 24 hours</option>
                    </select>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <div className="text-xs font-semibold uppercase tracking-wider text-gray-400">Status</div>
                    <div className="text-sm text-gray-600">
                      Last run {triggerLastRunAt ? new Date(triggerLastRunAt).toLocaleString() : 'not yet'}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => runTriggerFetch({ silent: false }).catch(() => {})}
                    disabled={triggerRunning}
                    className={`inline-flex items-center px-5 py-2.5 rounded-lg text-sm font-medium transition-colors shadow-sm ${
                      triggerRunning ? 'bg-gray-200 text-gray-500 cursor-not-allowed' : 'bg-charcoal text-white hover:bg-black'
                    }`}
                  >
                    <RotateCcw className="w-4 h-4 mr-2" />
                    {triggerRunning ? 'Refreshing' : 'Run now'}
                  </button>
                  <div className="text-xs text-gray-500">
                    Use this if you want to populate the Roles page right away.
                  </div>
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-gray-100">
              <table className="w-full text-sm">
                <thead className="bg-gray-50/50">
                  <tr className="text-left text-gray-500 text-xs uppercase tracking-wider">
                    <th className="px-4 py-3 font-semibold">Use</th>
                    <th className="px-4 py-3 font-semibold">Resume</th>
                    <th className="px-4 py-3 font-semibold">Added</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {resumeRows.map((r) => (
                    <tr key={r.id} className="group hover:bg-gray-50/30 transition-colors">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={Boolean(r.is_selected)}
                          onChange={() => handleSelectResume(r.id)}
                          className="h-4 w-4 rounded border-gray-300"
                        />
                      </td>
                      <td className="px-4 py-3 font-medium text-charcoal-dark">{r.file_name}</td>
                      <td className="px-4 py-3 text-gray-600">
                        {r.created_at ? new Date(r.created_at).toLocaleString() : '-'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleViewResume(r.id, r.file_name)}
                          className="text-gray-300 hover:text-charcoal transition-colors p-1"
                          aria-label="View resume"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteResume(r.id)}
                          disabled={resumeDeletingId === r.id}
                          className={`ml-2 text-gray-300 transition-colors p-1 ${
                            resumeDeletingId === r.id ? 'cursor-not-allowed' : 'hover:text-red-500'
                          }`}
                          aria-label="Delete resume"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!resumeRows.length ? (
                    <tr>
                      <td className="px-4 py-4 text-gray-500" colSpan={4}>
                        {resumeRowsLoading ? 'Loading resumes...' : 'No resumes uploaded yet.'}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

          </div>
        </section>

        {resumePreview.open ? (
          <div className="fixed inset-0 z-50">
            <div className="absolute inset-0 bg-black/20" onClick={() => setResumePreview({ open: false, resumeId: null, url: '', fileName: '' })} />
            <div className="absolute right-6 top-6 w-[min(720px,calc(100vw-48px))] bg-white border border-gray-200 rounded-2xl shadow-subtle overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-charcoal-dark">{resumePreview.fileName || 'Resume preview'}</div>
                <button
                  type="button"
                  onClick={() => setResumePreview({ open: false, resumeId: null, url: '', fileName: '' })}
                  className="text-xs text-gray-400 hover:text-charcoal transition-colors"
                >
                  Close
                </button>
              </div>
              <div className="max-h-[70vh] overflow-auto bg-gray-50/30">
                <embed src={resumePreview.url} type="application/pdf" className="w-full h-[70vh]" />
              </div>
            </div>
          </div>
        ) : null}

        <section className="bg-white border border-gray-100 rounded-2xl shadow-subtle overflow-hidden">
          <div className="px-8 py-5 border-b border-gray-50 flex items-center">
            <div className="p-2 bg-gray-50 rounded-lg mr-3">
              <KeyRound className="w-5 h-5 text-charcoal-light" />
            </div>
            <h2 className="font-semibold text-charcoal-dark text-lg">Connect your AI tool</h2>
          </div>

          <div className="p-8 space-y-8">
            <div>
              <div className="text-sm font-medium text-gray-500 mb-3">Choose a provider</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {aiProviders.map((p) => {
                  const Icon = p.icon
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => openAiProvider(p.id)}
                      className="group flex flex-col items-start p-5 bg-white border border-gray-100 rounded-2xl hover:border-gray-200 hover:bg-gray-50/40 transition-all text-left"
                    >
                      <div className="p-3 bg-gray-50 rounded-xl mb-4 text-charcoal group-hover:bg-white transition-colors">
                        <Icon className="w-6 h-6" />
                      </div>
                      <div className="text-sm font-semibold text-charcoal-dark">{p.label}</div>
                      <div className="text-xs text-gray-500 mt-1">Add connection</div>
                    </button>
                  )
                })}
              </div>
            </div>

            {aiSelectedProvider ? (
              <div className="border border-gray-100 rounded-2xl overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                  <div className="text-sm font-semibold text-charcoal-dark">Connection details</div>
                  <button
                    type="button"
                    onClick={() => setAiSelectedProvider(null)}
                    className="text-xs text-gray-400 hover:text-charcoal transition-colors"
                  >
                    Close
                  </button>
                </div>
                <div className="p-6 space-y-5">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-wider text-gray-400">Name</label>
                    <input
                      type="text"
                      value={aiForm.name}
                      onChange={(e) => setAiForm((f) => ({ ...f, name: e.target.value }))}
                      className="w-full bg-gray-50/50 border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:bg-white focus:ring-2 focus:ring-gray-200 focus:border-gray-400 outline-none transition-all"
                      placeholder="My AI connection"
                    />
                  </div>

                  {aiSelectedProvider.fields.apiKey ? (
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-wider text-gray-400">API Key</label>
                      <input
                        type="password"
                        value={aiForm.apiKey}
                        onChange={(e) => setAiForm((f) => ({ ...f, apiKey: e.target.value }))}
                        className="w-full bg-gray-50/50 border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:bg-white focus:ring-2 focus:ring-gray-200 focus:border-gray-400 outline-none transition-all"
                        placeholder="Paste your key"
                      />
                      <div className="text-xs text-gray-500">
                        This key is saved only in your browser storage for this device.
                      </div>
                    </div>
                  ) : null}

                  {aiSelectedProvider.fields.baseUrl ? (
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-wider text-gray-400">Base URL</label>
                      <input
                        type="text"
                        value={aiForm.baseUrl}
                        onChange={(e) => setAiForm((f) => ({ ...f, baseUrl: e.target.value }))}
                        className="w-full bg-gray-50/50 border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:bg-white focus:ring-2 focus:ring-gray-200 focus:border-gray-400 outline-none transition-all"
                        placeholder="http://localhost:8001"
                      />
                    </div>
                  ) : null}

                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-wider text-gray-400">Model</label>
                    <input
                      type="text"
                      value={aiForm.model}
                      onChange={(e) => setAiForm((f) => ({ ...f, model: e.target.value }))}
                      className="w-full bg-gray-50/50 border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:bg-white focus:ring-2 focus:ring-gray-200 focus:border-gray-400 outline-none transition-all"
                      placeholder="Model name"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={saveAiAgent}
                    className="bg-charcoal text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-black transition-colors shadow-sm inline-flex items-center"
                  >
                    <Save className="w-4 h-4 mr-2" />
                    Save connection
                  </button>
                </div>
              </div>
            ) : null}

            <div className="relative">
              {aiBalloon.open ? <AiBalloon /> : null}
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-medium text-gray-500">Connected agents</div>
                <div className="text-xs text-gray-400">Stored in your account</div>
              </div>

              <div className="overflow-x-auto rounded-lg border border-gray-100">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50/50">
                    <tr className="text-left text-gray-500 text-xs uppercase tracking-wider">
                      <th className="px-4 py-3 font-semibold">Name</th>
                      <th className="px-4 py-3 font-semibold">Provider</th>
                      <th className="px-4 py-3 font-semibold">Model</th>
                      <th className="px-4 py-3 font-semibold">Key</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {aiAgents.length ? (
                      aiAgents.map((a) => (
                        <tr key={a.id} className="hover:bg-gray-50/30 transition-colors group">
                          <td className="px-4 py-3 font-medium text-charcoal-dark">{a.name}</td>
                          <td className="px-4 py-3 text-gray-600">{a.provider}</td>
                          <td className="px-4 py-3 text-gray-600">{a.model}</td>
                          <td className="px-4 py-3 text-gray-600">
                            {a.has_api_key ? (
                              <span className="inline-flex items-center text-green-600">
                                <KeyRound className="w-4 h-4 mr-2" /> Saved
                              </span>
                            ) : (
                              <span className="inline-flex items-center text-gray-400">
                                <KeyRound className="w-4 h-4 mr-2" /> None
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => removeAiAgent(a.id)}
                              className="text-gray-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 p-1"
                              aria-label="Remove agent"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td className="px-4 py-4 text-gray-500" colSpan={5}>
                          No agents connected yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-gray-400">Default AI agent</label>
                <select
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 outline-none focus:border-charcoal focus:bg-white transition-colors"
                  value={aiDefaultAgentId}
                  onChange={(e) => {
                    const nextId = e.target.value
                    setAiDefaultAgentId(nextId)
                    if (!nextId) return
                    apiFetch(`${apiBaseUrl}/ai_connections/${nextId}`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ is_default: true }),
                    })
                      .then(() => loadAiConnections())
                      .catch(() => {})
                  }}
                >
                  <option value="">Select an agent</option>
                  {aiAgents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="rounded-2xl border border-gray-100 bg-gray-50/30 p-5">
                <div className="text-sm font-semibold text-charcoal-dark mb-2">How it will be used</div>
                <div className="text-sm text-gray-600 leading-6">
                  This app will use the default agent for tasks like job summarization, resume based profile extraction,
                  and ranking suggestions. Keys are never sent unless you trigger an AI action.
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-white border border-gray-100 rounded-2xl shadow-subtle overflow-hidden">
          <div className="px-8 py-5 border-b border-gray-50 flex items-center">
            <div className="p-2 bg-gray-50 rounded-lg mr-3">
              <Rss className="w-5 h-5 text-charcoal-light" />
            </div>
            <h2 className="font-semibold text-charcoal-dark text-lg">Search URLs</h2>
          </div>
          <div className="p-8 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-[0.9fr_1.6fr_auto_auto] gap-3 items-start">
              <div className="space-y-2">
                <input
                  type="text"
                  value={rssName}
                  onChange={(e) => setRssName(e.target.value)}
                  onFocus={() => scheduleCloseRssFieldBubble('name')}
                  aria-invalid={Boolean(rssNameError && rssName)}
                  className={`w-full bg-gray-50/50 border rounded-lg px-4 py-2.5 text-sm focus:bg-white focus:ring-2 outline-none transition-all ${
                    rssAttentionFields.name || (rssNameError && rssName)
                      ? 'border-red-300 ring-2 ring-red-100 focus:ring-red-100 focus:border-red-400'
                      : 'border-gray-200 focus:ring-gray-200 focus:border-gray-400'
                  }`}
                  placeholder="URL name"
                />
                <FieldBubble field="name" />
                <div className={`text-xs ${rssNameError && rssName ? 'text-red-400' : 'text-gray-400'}`}>
                  {rssNameError || 'Give this URL a short readable name.'}
                </div>
              </div>
              <div className="space-y-2">
                <input
                  type="text"
                  value={rssUrl}
                  onChange={(e) => setRssUrl(e.target.value)}
                  onFocus={() => scheduleCloseRssFieldBubble('url')}
                  aria-invalid={Boolean(rssUrlError && rssUrl)}
                  className={`w-full bg-gray-50/50 border rounded-lg px-4 py-2.5 text-sm focus:bg-white focus:ring-2 outline-none transition-all ${
                    rssAttentionFields.url || (rssUrlError && rssUrl)
                      ? 'border-red-300 ring-2 ring-red-100 focus:ring-red-100 focus:border-red-400'
                      : 'border-gray-200 focus:ring-gray-200 focus:border-gray-400'
                  }`}
                  placeholder="Enter URL"
                />
                <FieldBubble field="url" />
                <div className={`text-xs ${rssUrlError && rssUrl ? 'text-red-400' : 'text-gray-400'}`}>
                  {rssUrlError || 'Paste a full search URL such as a LinkedIn jobs search page.'}
                </div>
              </div>
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={handleAddFeed}
                  disabled={!canAddFeed || rssTesting}
                  className={`w-full px-6 py-2.5 rounded-lg text-sm font-medium transition-colors shadow-sm ${
                    canAddFeed && !rssTesting ? 'bg-charcoal text-white hover:bg-black' : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                  }`}
                >
                  {rssSubmitting ? 'Saving' : 'Add URL'}
                </button>
                <FieldBubble field="add" />
              </div>
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => handleTestFeed().catch(() => {})}
                  disabled={!canTestFeed}
                  className={`w-full px-6 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
                    canTestFeed ? 'bg-white text-charcoal border-gray-200 hover:bg-gray-50' : 'bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed'
                  }`}
                >
                  {rssTesting ? 'Testing' : 'Test URL'}
                </button>
              </div>
            </div>
            {rssTesting || rssPreviewOpen ? (
              <div className="w-full" style={{ height: 420 }}>
                {rssTesting ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span>Processing URL preview</span>
                      <span>{rssTestProgress}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full bg-charcoal transition-all duration-300"
                        style={{ width: `${rssTestProgress}%` }}
                      />
                    </div>
                    <div className="text-xs text-gray-400">We are fetching the search page and extracting job rows.</div>
                  </div>
                ) : null}
                {rssPreviewOpen ? (
                  <div className="bg-white border border-gray-200 rounded-2xl shadow-subtle overflow-hidden">
                    <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-charcoal-dark">{rssPreviewTitle}</div>
                      <button
                        type="button"
                        onClick={() => setRssPreviewOpen(false)}
                        className="text-xs text-gray-400 hover:text-charcoal transition-colors"
                      >
                        Close
                      </button>
                    </div>
                    <div className="max-h-[360px] overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50/50">
                        <tr className="text-left text-gray-500 text-xs uppercase tracking-wider">
                          <th className="px-4 py-3 font-semibold">Title</th>
                          <th className="px-4 py-3 font-semibold">Source</th>
                          <th className="px-4 py-3 font-semibold">Location</th>
                          <th className="px-4 py-3 font-semibold">Published</th>
                          <th className="px-4 py-3 font-semibold">Salary</th>
                          <th className="px-4 py-3 font-semibold">Recruiter</th>
                          <th className="px-4 py-3 font-semibold">Hiring manager</th>
                          <th className="px-4 py-3 font-semibold">Role details</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 bg-white">
                        {rssPreviewRows.map((row, idx) => (
                          <tr key={`${idx}-${row.title || ''}`} className="hover:bg-gray-50/30 transition-colors">
                            <td className="px-4 py-3 text-charcoal-dark align-top">{row.title || 'Untitled'}</td>
                            <td className="px-4 py-3 text-gray-600 align-top">{row.source || '-'}</td>
                            <td className="px-4 py-3 text-gray-600 align-top">{row.location || '-'}</td>
                            <td className="px-4 py-3 text-gray-600 align-top">{row.published || '-'}</td>
                            <td className="px-4 py-3 text-gray-600 align-top">{row.salary || '-'}</td>
                            <td className="px-4 py-3 text-gray-600 align-top">{row.recruiter || '-'}</td>
                            <td className="px-4 py-3 text-gray-600 align-top">{row.hiring_manager || '-'}</td>
                            <td className="px-4 py-3 text-gray-600 align-top min-w-[24rem]">{row.role_details || '-'}</td>
                          </tr>
                        ))}
                        {!rssPreviewRows.length ? (
                          <tr>
                            <td className="px-4 py-4 text-gray-500" colSpan={8}>
                              No items found for this URL.
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="overflow-hidden rounded-2xl border border-gray-100">
              <table className="w-full text-sm">
                <thead className="bg-gray-50/50">
                  <tr className="text-left text-gray-500 text-xs uppercase tracking-wider">
                    <th className="px-4 py-3 font-semibold">URL name</th>
                    <th className="px-4 py-3 font-semibold">URL</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {rssSources.map((row) => (
                    <tr key={row.id} className="group hover:bg-gray-50/30 transition-colors">
                      <td className="px-4 py-3 font-medium text-charcoal-dark">{row.name || 'Untitled URL'}</td>
                      <td className="px-4 py-3 text-gray-600 break-all">{row.url}</td>
                      <td className="px-4 py-3 text-gray-600">{row.is_active ? 'Active' : 'Inactive'}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleDeleteFeed(row.id)}
                          disabled={rssDeletingId === row.id}
                          className={`p-1 transition-colors ${
                            rssDeletingId === row.id ? 'text-gray-300 cursor-not-allowed' : 'text-gray-300 hover:text-red-500'
                          }`}
                          aria-label={`Delete ${row.name || 'URL'}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!rssSources.length ? (
                    <tr>
                      <td className="px-4 py-4 text-gray-500" colSpan={4}>
                        {rssSourcesLoading ? 'Loading URLs...' : 'No URLs added yet.'}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="bg-white border border-gray-100 rounded-2xl shadow-subtle overflow-hidden">
          <div className="px-8 py-5 border-b border-gray-50 flex items-center">
            <div className="flex items-center">
              <div className="p-2 bg-gray-50 rounded-lg mr-3">
                <KeyRound className="w-5 h-5 text-charcoal-light" />
              </div>
              <h2 className="font-semibold text-charcoal-dark text-lg">Custom Job Weight Prompt</h2>
            </div>
          </div>

          <div className="p-8">
            <div className="space-y-4">
              <label className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                Custom weighting instructions for LLM
              </label>
              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-start">
                <textarea
                  value={customWeightPrompt}
                  onChange={(e) => setCustomWeightPrompt(e.target.value)}
                  className="w-full bg-gray-50/50 border border-gray-200 rounded-lg px-4 py-3 text-sm focus:bg-white focus:ring-2 focus:ring-gray-200 focus:border-gray-400 outline-none resize-none transition-all h-28"
                />
                <button
                  type="button"
                  onClick={() => handleAddWeightPrompt()}
                  disabled={weightPromptSaving}
                  className={`w-full md:w-auto px-6 py-2.5 rounded-lg text-sm font-medium transition-colors shadow-sm ${
                    weightPromptSaving ? 'bg-gray-200 text-gray-500 cursor-not-allowed' : 'bg-charcoal text-white hover:bg-black'
                  }`}
                >
                  {weightPromptSaving ? 'Saving' : 'Add prompt'}
                </button>
              </div>

              <div className="overflow-hidden rounded-2xl border border-gray-100">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50/50">
                    <tr className="text-left text-gray-500 text-xs uppercase tracking-wider">
                      <th className="px-4 py-3 font-semibold">Use</th>
                      <th className="px-4 py-3 font-semibold">Prompt</th>
                      <th className="px-4 py-3 font-semibold">Added</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {weightPrompts.map((p) => (
                      <tr key={p.id} className="group hover:bg-gray-50/30 transition-colors">
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={Boolean(p.is_enabled)}
                            onChange={(e) => handleToggleWeightPrompt(p.id, e.target.checked)}
                            className="h-4 w-4 rounded border-gray-300"
                          />
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          <div className="max-w-[44rem] whitespace-pre-wrap leading-6">{p.prompt}</div>
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {p.created_at ? new Date(p.created_at).toLocaleString() : '-'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => handleDeleteWeightPrompt(p.id)}
                            disabled={weightPromptDeletingId === p.id}
                            className={`text-gray-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 p-1 ${
                              weightPromptDeletingId === p.id ? 'opacity-60 cursor-not-allowed' : ''
                            }`}
                            aria-label="Delete prompt"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!weightPrompts.length ? (
                      <tr>
                        <td className="px-4 py-4 text-gray-500" colSpan={4}>
                          {weightPromptsLoading ? 'Loading prompts...' : 'No prompts saved yet.'}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-white border border-gray-100 rounded-2xl shadow-subtle overflow-hidden">
          <div className="px-8 py-5 border-b border-gray-50 flex items-center">
            <div className="p-2 bg-gray-50 rounded-lg mr-3">
              <BarChart3 className="w-5 h-5 text-charcoal-light" />
            </div>
            <h2 className="font-semibold text-charcoal-dark text-lg">Analytics</h2>
          </div>
          <div className="p-8 space-y-4">
            <div className="flex items-center justify-between gap-6">
              <div>
                <div className="text-sm font-semibold text-charcoal-dark">Use AI for analytics reports</div>
                <div className="text-sm text-gray-500">Optional. Turn off to reduce token usage.</div>
              </div>
              <button
                type="button"
                onClick={() => {
                  const next = !analyticsAiEnabled
                  setAnalyticsAiEnabled(next)
                  apiFetch(`${apiBaseUrl}/me/settings`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ analytics_ai_enabled: next }),
                  }).catch(() => {})
                }}
                className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                  analyticsAiEnabled ? 'bg-charcoal' : 'bg-gray-200'
                }`}
                aria-label="Toggle AI analytics"
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                    analyticsAiEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
            <div className="text-xs text-gray-400">
              Analytics charts always work. This toggle only controls whether an AI generated narrative report is included.
            </div>
          </div>
        </section>

        <footer className="flex justify-between pt-8 pb-12 border-t border-gray-100">
          <button className="flex items-center text-sm text-gray-400 hover:text-charcoal transition-colors font-medium px-4 py-2 rounded-lg hover:bg-gray-50">
            <RotateCcw className="w-4 h-4 mr-2" /> Reset Defaults
          </button>
          <button className="flex items-center text-sm text-gray-400 hover:text-red-600 transition-colors font-medium px-4 py-2 rounded-lg hover:bg-red-50">
            <LogOut className="w-4 h-4 mr-2" /> Sign Out
          </button>
        </footer>
    </main>
  )
}

