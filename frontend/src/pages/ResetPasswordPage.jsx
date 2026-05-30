import { useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import { getApiBaseUrl } from '../auth.js'

export function ResetPasswordPage() {
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), [])
  const navigate = useNavigate()
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  const initialToken = params.get('token') || ''

  const [resetToken, setResetToken] = useState(initialToken)
  const [password, setPassword] = useState('')
  const [statusText, setStatusText] = useState('')

  async function submit() {
    setStatusText('')
    const payload = { reset_token: resetToken.trim(), new_password: password }
    if (!payload.reset_token || !payload.new_password) {
      setStatusText('Enter token and new password')
      return
    }
    const res = await fetch(`${apiBaseUrl}/auth/reset_password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      setStatusText('Reset failed')
      return
    }
    setStatusText('Password updated')
    window.setTimeout(() => navigate('/login'), 900)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FAFAFA] p-6 font-sans">
      <div className="w-full max-w-md bg-white border border-gray-100 rounded-2xl shadow-subtle overflow-hidden">
        <div className="px-8 py-7 border-b border-gray-50">
          <div className="text-2xl font-bold text-charcoal-dark tracking-tight">Reset password</div>
          <div className="text-sm text-gray-500 mt-2">Use the token to set a new password</div>
        </div>

        <div className="p-8 space-y-5">
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-gray-400">Reset token</label>
            <textarea
              value={resetToken}
              onChange={(e) => setResetToken(e.target.value)}
              className="w-full bg-gray-50/50 border border-gray-200 rounded-lg px-4 py-3 text-sm focus:bg-white focus:ring-2 focus:ring-gray-200 focus:border-gray-400 outline-none resize-none transition-all h-24"
              placeholder="Paste token"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-gray-400">New password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-gray-50/50 border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:bg-white focus:ring-2 focus:ring-gray-200 focus:border-gray-400 outline-none transition-all"
              placeholder="New password"
            />
          </div>

          {statusText ? <div className="text-sm text-gray-600">{statusText}</div> : null}

          <button
            type="button"
            onClick={() => submit().catch(() => setStatusText('Reset failed'))}
            className="w-full bg-charcoal text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-black transition-colors shadow-sm"
          >
            Update password
          </button>

          <div className="text-sm">
            <Link to="/login" className="text-gray-500 hover:text-charcoal transition-colors">
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

