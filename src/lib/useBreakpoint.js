import { useSyncExternalStore } from 'react'

// Single source of truth for responsive layout decisions.
//
// The app styles almost everything with inline style objects, which @media
// queries CANNOT reach. So structural responsiveness (wide table -> stacked
// cards, pinned side panel -> full-screen overlay, sidebar -> drawer) is driven
// from JS: components read useBreakpoint() and conditionally render.
//
// Breakpoints (agreed with the user):
//   phone   : width <= 640   -> Tier 2 structural rework switches on
//   tablet  : 641 .. 1024    -> Tier 1 fluid behaviour
//   desktop : > 1024         -> unchanged (pinned panel, full tables)
// Narrowest verified viewport is ~380px.
export const PHONE_MAX = 640
export const TABLET_MAX = 1024

const QUERIES = {
  phone: `(max-width: ${PHONE_MAX}px)`,
  tablet: `(min-width: ${PHONE_MAX + 1}px) and (max-width: ${TABLET_MAX}px)`,
}

function currentBucket() {
  if (typeof window === 'undefined' || !window.matchMedia) return 'desktop'
  if (window.matchMedia(QUERIES.phone).matches) return 'phone'
  if (window.matchMedia(QUERIES.tablet).matches) return 'tablet'
  return 'desktop'
}

function subscribe(cb) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const mqls = [window.matchMedia(QUERIES.phone), window.matchMedia(QUERIES.tablet)]
  mqls.forEach((m) => m.addEventListener('change', cb))
  return () => mqls.forEach((m) => m.removeEventListener('change', cb))
}

// Returns { bucket, isPhone, isTablet, isDesktop }. Re-renders on viewport
// crossing a breakpoint (via matchMedia listeners, not resize spam).
export function useBreakpoint() {
  const bucket = useSyncExternalStore(subscribe, currentBucket, () => 'desktop')
  return {
    bucket,
    isPhone: bucket === 'phone',
    isTablet: bucket === 'tablet',
    isDesktop: bucket === 'desktop',
  }
}
