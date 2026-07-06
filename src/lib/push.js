import { supabase } from './supabase'

// Public VAPID key (safe to ship). Private key lives in Supabase Vault, used only
// by the phase-notify edge function.
export const VAPID_PUBLIC = 'BGto2-DrEkUTtdHcCGFFEAn-UsbPQCDs5jIsQagRryhTy5hdJJtkb4odFjiMfP8ip3vc696OmS0j7BYDdO5WrYA'

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) // iPadOS masquerades as Mac
export const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true

function urlB64ToUint8(base64) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

// Reasons push can't be offered here, or null if it can.
export function pushBlockedReason() {
  if (isIOS() && !isStandalone()) return 'ios-install' // must Add to Home Screen first
  if (!pushSupported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  return null
}

export async function currentSubscription() {
  if (!pushSupported()) return null
  const reg = await navigator.serviceWorker.ready
  return reg.pushManager.getSubscription()
}

// Request permission, subscribe, and store the subscription (RLS: own row only).
export async function enablePush() {
  if (!pushSupported()) throw new Error('Notifications aren’t supported on this browser.')
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('Notification permission was not granted.')
  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(VAPID_PUBLIC) })
  const j = sub.toJSON()
  const { error } = await supabase.from('push_subscriptions').upsert(
    { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, ua: navigator.userAgent },
    { onConflict: 'endpoint' },
  )
  if (error) throw error
  return true
}

export async function disablePush() {
  const sub = await currentSubscription()
  if (sub) {
    await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
    await sub.unsubscribe().catch(() => {})
  }
}
