import * as React from "react"

/**
 * useIsMobile
 *
 * Returns true if the device is a mobile device — checked by the SHORTER
 * screen dimension, not by viewport width. This is important because:
 *
 *   - Portrait phone (e.g. Oppo Reno 11F): viewport ~412×920 → short side 412 < 768 → mobile
 *   - Landscape phone (after ⟳ rotate): viewport ~920×412 → short side 412 < 768 → still mobile
 *
 * If we only checked `max-width: 767px`, a phone rotated to landscape
 * would be misdetected as desktop (920px > 768px) and the UI would switch
 * to desktop layouts (wide tables, side-by-side panels) which is wrong.
 *
 * Use this hook for JS-based conditional rendering that must respect
 * "is this a phone" rather than "is the viewport wide right now".
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mobileMq = window.matchMedia("(max-width: 767px)")
    const onChange = () => {
      // Check short side — works in both portrait and landscape
      const shortSide = Math.min(window.innerWidth, window.innerHeight)
      const shortSideMobile = shortSide < 768
      setIsMobile(shortSideMobile || mobileMq.matches)
    }
    onChange()
    mobileMq.addEventListener("change", onChange)
    window.addEventListener("resize", onChange)
    window.addEventListener("orientationchange", onChange)
    return () => {
      mobileMq.removeEventListener("change", onChange)
      window.removeEventListener("resize", onChange)
      window.removeEventListener("orientationchange", onChange)
    }
  }, [])

  return !!isMobile
}
