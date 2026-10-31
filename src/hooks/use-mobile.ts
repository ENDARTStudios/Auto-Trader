import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  // Inicializador lazy: lê o viewport uma vez, sem setState síncrono no effect
  // (react-hooks/set-state-in-effect, plugin 7.1). O effect cuida só das
  // atualizações via media query.
  const [isMobile, setIsMobile] = React.useState<boolean>(() =>
    typeof window === "undefined" ? false : window.innerWidth < MOBILE_BREAKPOINT
  )

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return isMobile
}
