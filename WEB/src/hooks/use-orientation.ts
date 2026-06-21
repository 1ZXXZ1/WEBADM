import * as React from "react"

/**
 * useOrientation
 *
 * Tracks device orientation and provides a "force-landscape" toggle.
 *
 * PRIMARY: Screen Orientation API + Fullscreen API
 *   - Actually rotates the browser to landscape (no CSS hacks)
 *   - All dialogs, portals, scrolling work perfectly
 *   - Requires user gesture (button click) + fullscreen
 *   - Supported on Android Chrome (Oppo Reno 11F etc.)
 *
 * FALLBACK: CSS transform on <body>
 *   - Used when Screen Orientation API is unavailable (e.g. iOS Safari)
 *   - Rotates the entire body so portaled dialogs are included
 *   - Overrides h-screen / vh units to use the rotated container's height
 *   - Scrolling works via body { overflow-y: auto }
 *
 * In forced-landscape mode (either native or CSS fallback), the Samba AD
 * sidebar is hidden to maximize horizontal space for chat / content.
 */
export function useOrientation() {
  const [isMobile, setIsMobile] = React.useState(false)
  const [naturalLandscape, setNaturalLandscape] = React.useState(false)
  const [forceLandscape, setForceLandscape] = React.useState(false)
  const [nativeLocked, setNativeLocked] = React.useState(false)

  // Track natural orientation + mobile breakpoint
  React.useEffect(() => {
    const orientMq = window.matchMedia("(orientation: landscape)")
    // Use the SHORTER screen dimension to detect "mobile device" rather than
    // viewport width — that way a phone rotated to landscape (viewport becomes
    // ~920px wide) is still detected as mobile, and the sidebar stays hidden.
    const mobileMq = window.matchMedia("(max-width: 767px)")
    const sync = () => {
      setNaturalLandscape(orientMq.matches)
      // A device is "mobile" if its shorter side < 768px OR it was mobile
      // before rotation. We use the shorter side via matchMedia on both
      // orientations.
      const shortSide = Math.min(window.innerWidth, window.innerHeight)
      const shortSideMobile = shortSide < 768
      setIsMobile(shortSideMobile || mobileMq.matches)
    }
    sync()
    orientMq.addEventListener("change", sync)
    mobileMq.addEventListener("change", sync)
    return () => {
      orientMq.removeEventListener("change", sync)
      mobileMq.removeEventListener("change", sync)
    }
  }, [])

  // Track native orientation lock changes (e.g. user exits fullscreen)
  React.useEffect(() => {
    const handler = () => {
      const type = screen.orientation?.type || ''
      if (type.startsWith('landscape') && forceLandscape) {
        setNativeLocked(true)
      } else if (!type.startsWith('landscape') && forceLandscape && !naturalLandscape) {
        // Orientation was unlocked externally (e.g. user pressed Esc to exit fullscreen)
        setNativeLocked(false)
        setForceLandscape(false)
      }
    }
    if (screen.orientation) {
      screen.orientation.addEventListener('change', handler)
      return () => screen.orientation.removeEventListener('change', handler)
    }
  }, [forceLandscape, naturalLandscape])

  // CSS fallback: add/remove class on <body> to rotate everything
  const needsCssRotation = forceLandscape && isMobile && !naturalLandscape && !nativeLocked
  React.useEffect(() => {
    if (needsCssRotation) {
      document.body.classList.add('force-landscape-css')
    } else {
      document.body.classList.remove('force-landscape-css')
    }
    return () => {
      document.body.classList.remove('force-landscape-css')
    }
  }, [needsCssRotation])

  const toggleForceLandscape = React.useCallback(async () => {
    if (forceLandscape) {
      // ── Exit landscape mode ──
      try {
        await screen.orientation?.unlock?.()
      } catch { /* ignore */ }
      if (document.fullscreenElement) {
        try { await document.exitFullscreen() } catch { /* ignore */ }
      }
      setNativeLocked(false)
      setForceLandscape(false)
    } else {
      // ── Enter landscape mode — try native orientation lock first ──
      try {
        if (!document.fullscreenElement) {
          await document.documentElement.requestFullscreen()
        }
        if (screen.orientation?.lock) {
          await screen.orientation.lock('landscape')
          setNativeLocked(true)
        }
      } catch (err) {
        // Native API failed (iOS Safari, or user denied fullscreen)
        // Fall back to CSS transform on body
        console.warn('Native orientation lock unavailable, using CSS fallback:', err)
        setNativeLocked(false)
      }
      setForceLandscape(true)
    }
  }, [forceLandscape])

  // "Effective landscape" = device is naturally landscape OR user forced it
  const effectiveLandscape = naturalLandscape || (forceLandscape && isMobile)

  return {
    isMobile,
    naturalLandscape,
    forceLandscape,
    nativeLocked,
    needsCssRotation,
    effectiveLandscape,
    toggleForceLandscape,
  }
}
