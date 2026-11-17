import { useEffect, useRef, useState } from 'react'

export function useFlash<T>(empty: T, duration: number): [T, (value: T, timeout?: number | null) => void] {
  const [value, setValue] = useState(empty)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const flash = (next: T, timeout: number | null = duration) => {
    clearTimeout(timer.current)
    setValue(next)
    timer.current = !Object.is(next, empty) && timeout !== null && timeout > 0
      ? setTimeout(() => { setValue(empty); timer.current = undefined }, timeout)
      : undefined
  }
  useEffect(() => () => clearTimeout(timer.current), [])
  return [value, flash]
}
