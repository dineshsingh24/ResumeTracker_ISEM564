import { useEffect, useMemo, useRef, useState } from 'react'
import { KeyRound, LogOut, User } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { apiFetch, getApiBaseUrl, getAuthToken, setAuthToken } from '../auth.js'

function initialsFromName(name, fallback) {
  const cleaned = String(name || '').trim()
  if (!cleaned) return fallback
  const parts = cleaned.split(/\s+/).filter(Boolean)
  if (!parts.length) return fallback
  const first = parts[0][0] || ''
  const last = (parts.length > 1 ? parts[parts.length - 1][0] : '') || ''
  const out = `${first}${last}`.toUpperCase()
  return out || fallback
}

export function ProfileMenu() {
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), [])
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [me, setMe] = useState(null)
  const [tokenVersion, setTokenVersion] = useState(0)
  const [mode, setMode] = useState('menu')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [statusText, setStatusText] = useState('')

  const rootRef = useRef(null)

  async function fetchMe() {
    if (!getAuthToken()) {
      setMe(null)
      return
    }
    const r = await apiFetch(`${apiBaseUrl}/auth/me`)
    if (!r.ok) return
    const data = await r.json()
    setMe(data)
  }

  useEffect(() => {
    fetchMe().catch(() => {})
  }, [apiBaseUrl, tokenVersion])

  useEffect(() => {
    function onAuthChanged() {
      setTokenVersion((v) => v + 1)
    }
    window.addEventListener('rt-auth-changed', onAuthChanged)
    window.addEventListener('storage', onAuthChanged)
    return () => {
      window.removeEventListener('rt-auth-changed', onAuthChanged)
      window.removeEventListener('storage', onAuthChanged)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    fetchMe().catch(() => {})
  }, [open])

  useEffect(() => {
    function onDocClick(e) {
      if (!rootRef.current) return
      if (rootRef.current.contains(e.target)) return
      setOpen(false)
      setMode('menu')
      setStatusText('')
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const fallback = 'JD'
  const initials = initialsFromName(me && me.full_name, fallback)
  const displayName = (me && me.full_name) || 'John Doe'
  const displayEmail = (me && me.email) || ''

  async function signOut() {
    setAuthToken('')
    setOpen(false)
    setMode('menu')
    navigate('/login')
  }

  async function changePassword() {
    setStatusText('')
    if (!currentPassword || !newPassword) {
      setStatusText('Enter current and new password')
      return
    }
    const res = await apiFetch(`${apiBaseUrl}/auth/change_password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    })
    if (!res.ok) {
      setStatusText('Change failed')
      return
    }
    setStatusText('Password updated')
    setCurrentPassword('')
    setNewPassword('')
    window.setTimeout(() => {
      setOpen(false)
      setMode('menu')
      setStatusText('')
    }, 900)
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-9 h-9 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
        aria-label="Profile menu"
      >
        {initials}
      </button>

      {open ? (
        <div
          className="absolute right-0 top-full mt-3 w-[min(360px,calc(100vw-48px))] origin-top-right"
          style={{ animation: 'rtInflate 350ms ease-out' }}
        >
          <style>{`
@keyframes rtInflate {
  0% { transform: scale(0.92); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}
          `}</style>

          <div className="bg-white border border-gray-200 rounded-2xl shadow-subtle overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center text-sm font-semibold text-gray-600">
                  {initials}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-charcoal-dark truncate">{displayName}</div>
                  <div className="text-xs text-gray-500 truncate">{displayEmail}</div>
                </div>
              </div>
            </div>

            {mode === 'menu' ? (
              <div className="p-2">
                <button
                  type="button"
                  onClick={() => {
                    setMode('password')
                    setStatusText('')
                  }}
                  className="w-full flex items-center px-4 py-3 text-sm text-charcoal-dark hover:bg-gray-50 rounded-xl transition-colors"
                >
                  <KeyRound className="w-4 h-4 mr-3 text-gray-500" />
                  Change password
                </button>
                <button
                  type="button"
                  onClick={() => signOut().catch(() => {})}
                  className="w-full flex items-center px-4 py-3 text-sm text-charcoal-dark hover:bg-gray-50 rounded-xl transition-colors"
                >
                  <LogOut className="w-4 h-4 mr-3 text-gray-500" />
                  Sign out
                </button>
              </div>
            ) : (
              <div className="p-5 space-y-4">
                <div className="text-sm font-semibold text-charcoal-dark flex items-center">
                  <User className="w-4 h-4 mr-2 text-gray-500" />
                  Change password
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-gray-400">Current password</label>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="w-full bg-gray-50/50 border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:bg-white focus:ring-2 focus:ring-gray-200 focus:border-gray-400 outline-none transition-all"
                    placeholder="Current password"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-gray-400">New password</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full bg-gray-50/50 border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:bg-white focus:ring-2 focus:ring-gray-200 focus:border-gray-400 outline-none transition-all"
                    placeholder="New password"
                  />
                </div>

                {statusText ? <div className="text-sm text-gray-600">{statusText}</div> : null}

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('menu')
                      setStatusText('')
                    }}
                    className="bg-white text-charcoal px-4 py-2.5 rounded-lg text-sm font-medium border border-gray-200 hover:bg-gray-50 transition-colors"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => changePassword().catch(() => setStatusText('Change failed'))}
                    className="bg-charcoal text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-black transition-colors shadow-sm"
                  >
                    Update
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

