import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { getApiBaseUrl, setAuthToken } from '../auth.js'
import { AlertBubble } from '../components/AlertBubble.jsx'

export function LoginPage() {
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), [])
  const navigate = useNavigate()

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState('login')
  const [statusText, setStatusText] = useState('')

  async function submit() {
    setStatusText('')
    const payload = { email: email.trim(), password, full_name: fullName.trim() || null }
    if (!payload.email || !payload.password) {
      setStatusText('Enter email and password')
      return
    }
    if (mode === 'register' && !payload.full_name) {
      setStatusText('Enter full name')
      return
    }

    const endpoint = mode === 'register' ? '/auth/register' : '/auth/login'
    const res = await fetch(`${apiBaseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mode === 'register' ? payload : { email: payload.email, password: payload.password }),
    })

    if (!res.ok) {
      setStatusText('Login failed')
      return
    }

    if (mode === 'register') {
      const loginRes = await fetch(`${apiBaseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!loginRes.ok) {
        setStatusText('Login failed')
        return
      }
      const tokenData = await loginRes.json()
      setAuthToken(String(tokenData.access_token || ''))
    } else {
      const tokenData = await res.json()
      setAuthToken(String(tokenData.access_token || ''))
    }

    navigate('/config')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FAFAFA] p-6 font-sans">
      <div className="w-full max-w-md bg-white border border-gray-100 rounded-2xl shadow-subtle overflow-hidden">
        <div className="px-8 py-7 border-b border-gray-50">
          <div className="text-2xl font-bold text-charcoal-dark tracking-tight">
            {mode === 'register' ? 'Create account' : 'Sign in'}
          </div>
          <div className="text-sm text-gray-500 mt-2">
            {mode === 'register' ? 'Create an account to store your data' : 'Sign in to continue'}
          </div>
        </div>

        <div className="p-8 space-y-5">
          {mode === 'register' ? (
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-gray-400">Full name</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full bg-gray-50/50 border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:bg-white focus:ring-2 focus:ring-gray-200 focus:border-gray-400 outline-none transition-all"
                placeholder="Dinesh Singh"
              />
            </div>
          ) : null}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-gray-400">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-gray-50/50 border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:bg-white focus:ring-2 focus:ring-gray-200 focus:border-gray-400 outline-none transition-all"
              placeholder="you@example.com"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-gray-400">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-gray-50/50 border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:bg-white focus:ring-2 focus:ring-gray-200 focus:border-gray-400 outline-none transition-all"
              placeholder="Password"
            />
          </div>

          {statusText ? <AlertBubble message={statusText} /> : null}

          <button
            type="button"
            onClick={() => submit().catch(() => setStatusText('Login failed'))}
            className="w-full bg-charcoal text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-black transition-colors shadow-sm"
          >
            {mode === 'register' ? 'Create account' : 'Sign in'}
          </button>

          <div className="flex items-center justify-between text-sm">
            <button
              type="button"
              className="text-charcoal hover:text-black transition-colors"
              onClick={() => setMode(mode === 'register' ? 'login' : 'register')}
            >
              {mode === 'register' ? 'I already have an account' : 'I need an account'}
            </button>
            <Link to="/forgot" className="text-gray-500 hover:text-charcoal transition-colors">
              Forgot password
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

