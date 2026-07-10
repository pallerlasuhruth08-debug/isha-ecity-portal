import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { Icon } from '../lib/icons'

export default function Login() {
  const [mode, setMode] = useState('signin') // 'signin' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [err, setErr] = useState(null)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        setMsg('Account created — an admin will approve and assign your role. You can sign in once approved.')
      }
    } catch (e2) {
      setErr(e2.message || String(e2))
    } finally {
      setBusy(false)
    }
  }

  async function google() {
    setErr(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + window.location.pathname },
    })
    if (error) setErr(error.message)
  }

  const field = {
    width: '100%',
    padding: '11px 13px',
    border: '1px solid var(--border)',
    borderRadius: 10,
    fontSize: 14,
    fontFamily: 'inherit',
    background: '#fff',
    color: 'var(--ink)',
    outline: 'none',
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg)',
        padding: 20,
      }}
    >
      <div className="card" style={{ width: 400, maxWidth: '100%', padding: 32, boxShadow: 'var(--shadow-lg)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 13,
              background: 'linear-gradient(150deg,#E79248,#B0541A)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#FBEFDF',
              boxShadow: 'var(--shadow-md)',
            }}
          >
            {Icon.leaf(24)}
          </div>
          <div>
            <div style={{ fontFamily: "'Newsreader',serif", fontSize: 19, fontWeight: 600, color: 'var(--ink)' }}>
              Electronic City
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted-2)', letterSpacing: '.08em', textTransform: 'uppercase' }}>
              Volunteer Care
            </div>
          </div>
        </div>

        <h2 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 4px' }}>
          {mode === 'signin' ? 'Namaskaram' : 'Create your account'}
        </h2>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>
          {mode === 'signin'
            ? 'Sign in to coordinate volunteer & meditator care.'
            : 'New accounts start pending — an admin approves and assigns your role.'}
        </div>

        {err && (
          <div style={{ background: '#FBE6E0', color: '#B5532F', padding: '10px 12px', borderRadius: 9, fontSize: 12.5, marginBottom: 12 }}>
            {err}
          </div>
        )}
        {msg && (
          <div style={{ background: '#EAF2E5', color: '#4E7C3F', padding: '10px 12px', borderRadius: 9, fontSize: 12.5, marginBottom: 12 }}>
            {msg}
          </div>
        )}

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} style={field} />
          <input
            type="password"
            required
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={field}
          />
          <button type="submit" className="btn btn-primary tap44" disabled={busy} style={{ justifyContent: 'center', padding: '12px', fontSize: 14 }}>
            {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0' }}>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          <span style={{ fontSize: 11.5, color: 'var(--muted-2)' }}>or</span>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        </div>

        <button className="btn btn-ghost tap44" onClick={google} style={{ width: '100%', justifyContent: 'center', padding: '11px' }}>
          <svg width="17" height="17" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.7 30.1 0 24 0 14.6 0 6.4 5.4 2.5 13.2l7.8 6.1C12.2 13.5 17.6 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9.1h12.4c-.5 2.9-2.1 5.4-4.6 7.1l7.2 5.6C43.6 37.7 46.1 31.7 46.1 24.6z" />
            <path fill="#FBBC05" d="M10.3 28.3c-.5-1.4-.8-2.9-.8-4.3s.3-3 .8-4.3l-7.8-6.1C.9 16.7 0 20.2 0 24s.9 7.3 2.5 10.4l7.8-6.1z" />
            <path fill="#34A853" d="M24 48c6.1 0 11.3-2 15.1-5.5l-7.2-5.6c-2 1.4-4.6 2.2-7.9 2.2-6.4 0-11.8-4-13.7-9.8l-7.8 6.1C6.4 42.6 14.6 48 24 48z" />
          </svg>
          Continue with Google
        </button>

        <div style={{ textAlign: 'center', marginTop: 18, fontSize: 13, color: 'var(--muted)' }}>
          {mode === 'signin' ? "New here? " : 'Already have an account? '}
          <button
            onClick={() => {
              setMode(mode === 'signin' ? 'signup' : 'signin')
              setErr(null)
              setMsg(null)
            }}
            style={{ background: 'none', border: 'none', color: 'var(--orange)', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}
          >
            {mode === 'signin' ? 'Create an account' : 'Sign in'}
          </button>
        </div>
      </div>
    </div>
  )
}
