import type { Keymap } from "./keymap"
import type { ParsedStroke } from "./keys"
import { type DispatchDecision, type DispatchState, initialDispatchState, pureDispatch, pureTick, type PureDispatchOptions } from "./pure-dispatch"

export type DispatchResult<C> = DispatchDecision<C>

export interface Clock {
  now(): number
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export interface DispatcherOptions extends PureDispatchOptions {
  readonly clock?: Clock
}

export interface Dispatcher<C> {
  /** Process a key stroke. Runs the bound action as a side effect on success. */
  readonly dispatch: (stroke: ParsedStroke) => DispatchResult<C>
}

const defaultClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
}

export const createDispatcher = <C>(keymap: Keymap<C>, getContext: () => C, options: DispatcherOptions = {}): Dispatcher<C> => {
  const clock = options.clock ?? defaultClock

  let state: DispatchState = initialDispatchState
  let timer: unknown = null

  const clearTimer = () => {
    if (timer !== null) {
      clock.clearTimeout(timer)
      timer = null
    }
  }

  const reschedule = () => {
    clearTimer()
    if (state.timeoutAt !== null) {
      const delay = Math.max(0, state.timeoutAt - clock.now())
      timer = clock.setTimeout(() => {
        timer = null
        const ctx = getContext()
        const { state: next, decision } = pureTick(keymap, state, ctx, clock.now())
        updateState(next)
        if (decision?.kind === "ran") decision.binding.action(ctx)
      }, delay)
    }
  }

  const updateState = (next: DispatchState) => {
    if (next === state) return
    state = next
    reschedule()
  }

  return {
    dispatch: (stroke) => {
      const ctx = getContext()
      const now = clock.now()
      const { state: next, decision } = pureDispatch(keymap, state, stroke, ctx, now, options)
      updateState(next)
      if (decision.kind === "ran") {
        decision.binding.action(ctx)
      }
      return decision
    },
  }
}
