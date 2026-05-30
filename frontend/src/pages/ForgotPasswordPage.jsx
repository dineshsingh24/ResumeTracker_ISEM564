import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { getApiBaseUrl } from '../auth.js'

export function ForgotPasswordPage() {
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), [])
  const [email, setEmail] = useState('')
  const [statusText, setStatusText] = useState('')
  const [resetToken, setResetToken] = useState('')

  async function submit() {
    setStatusText('')
    setResetToken('')
    const payload = { email: email.trim() }
    if (!payload.email) {
      setStatusText('Enter your email')
      return
    }

    const res = await fetch(`${apiBaseUrl}/auth/forgot_password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      setStatusText('Request failed')
      return
    }
    const data = await res.json()
    setStatusText(String(data.message || 'Request sent'))
    if (data.reset_token) setResetToken(String(data.reset_token))
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FAFAFA] p-6 font-sans">
      <div className="w-full max-w-md bg-white border border-gray-100 rounded-2xl shadow-subtle overflow-hidden">
        <div className="px-8 py-7 border-b border-gray-50">
          <div className="text-2xl font-bold text-charcoal-dark tracking-tight">Forgot password</div>
          <div className="text-sm text-gray-500 mt-2">Request a reset token for testing</div>
        </div>

        <div className="p-8 space-y-5">
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

          {statusText ? <div className="text-sm text-gray-600">{statusText}</div> : null}
          {resetToken ? (
            <div className="text-sm text-charcoal-dark bg-gray-50 border border-gray-200 rounded-xl p-4">
              <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-2">Reset token</div>
              <div className="break-all">{resetToken}</div>
              <div className="mt-3 text-sm">
                <Link to={`/reset?token=${encodeURIComponent(resetToken)}`} className="text-charcoal hover:text-black">
                  Go to reset page
                </Link>
              </div>
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => submit().catch(() => setStatusText('Request failed'))}
            className="w-full bg-charcoal text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-black transition-colors shadow-sm"
          >
            Request reset token
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

