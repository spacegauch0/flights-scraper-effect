/**
 * OpenTUI keyboard → keymap engine bridge.
 *
 * `normalizeOpenTuiKey` maps an OpenTUI KeyEvent into the keymap engine's
 * ParsedStroke; `option` (alt on Linux/Windows) is folded into `meta` to keep
 * one cross-platform modifier surface.
 *
 * `useOpenTuiKeymap` mounts a keymap in a React component: it feeds every
 * key press through the dispatcher, prevents default on handled strokes so
 * focused inputs don't double-process them, and surfaces disabled-binding
 * reasons through `onDisabled`.
 */

import type { KeyEvent } from "@opentui/core"
import { useKeyboard } from "@opentui/react"
import { useMemo, useRef } from "react"
import { appendFileSync } from "node:fs"
import { createDispatcher, type Dispatcher, type Keymap, type ParsedStroke } from "./keymap"

/** Optional key-dispatch trace for debugging: FLIGHTS_TUI_KEYLOG=/path/to/log */
const KEYLOG = process.env.FLIGHTS_TUI_KEYLOG
export const keylog = (entry: unknown) => {
  if (!KEYLOG) return
  try {
    appendFileSync(KEYLOG, `${JSON.stringify(entry)}\n`)
  } catch {
    // ignore
  }
}

const normalizeKeyName = (name: string) => {
  const key = name.toLowerCase()
  return key === "enter" ? "return" : key
}

export const normalizeOpenTuiKey = (event: KeyEvent): ParsedStroke => ({
  key: normalizeKeyName(event.name),
  ctrl: event.ctrl,
  shift: event.shift,
  meta: event.meta || event.option,
})

export const useOpenTuiKeymap = <C>(
  keymap: Keymap<C>,
  ctx: C,
  onDisabled?: (reason: string) => void,
): Dispatcher<C> => {
  const ctxRef = useRef(ctx)
  ctxRef.current = ctx
  const onDisabledRef = useRef(onDisabled)
  onDisabledRef.current = onDisabled

  const dispatcher = useMemo(() => createDispatcher(keymap, () => ctxRef.current), [keymap])

  useKeyboard((event) => {
    if (event.defaultPrevented) {
      keylog({ skipped: "defaultPrevented", name: event.name, ctrl: event.ctrl })
      return
    }
    const stroke = normalizeOpenTuiKey(event)
    const decision = dispatcher.dispatch(stroke)
    keylog({ stroke, decision: decision.kind, binding: "binding" in decision ? decision.binding.meta?.id : undefined })
    if (decision.kind === "ran" || decision.kind === "pending") {
      event.preventDefault()
    } else if (decision.kind === "disabled") {
      event.preventDefault()
      onDisabledRef.current?.(decision.reason)
    }
  })

  return dispatcher
}
