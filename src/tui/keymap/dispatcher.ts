import { type Binding, isBindingActive } from "./binding"
import type { Keymap } from "./keymap"
import type { ParsedStroke } from "./keys"
import {
	type DispatchDecision,
	type DispatchState,
	initialDispatchState,
	pureDispatch,
	pureTick,
	type PureDispatchOptions,
} from "./pure-dispatch"

export type DispatchResult<C> = DispatchDecision<C>

export interface Clock {
	now(): number
	setTimeout(fn: () => void, ms: number): unknown
	clearTimeout(handle: unknown): void
}

export interface DispatcherOptions extends PureDispatchOptions {
	readonly clock?: Clock
	readonly onCollision?: (sequence: readonly ParsedStroke[], bindings: readonly Binding<unknown>[]) => void
}

export interface Dispatcher<C> {
	/** Process a key stroke. Runs the bound action as a side effect on success. */
	readonly dispatch: (stroke: ParsedStroke) => DispatchResult<C>
	/** Run a command imperatively by its meta.id, regardless of bound keys. */
	readonly runById: (id: string) => DispatchResult<C>
	/** Snapshot of the dispatcher's runtime state (pending + timeoutAt). */
	readonly getState: () => DispatchState
	/** Convenience: just the pending sequence. */
	readonly getPending: () => readonly ParsedStroke[]
	/** Drop any pending sequence and clear pending timeouts. */
	readonly clearPending: () => void
	/** Subscribe to state changes (pending sequence shifts). */
	readonly onStateChange: (listener: (state: DispatchState) => void) => () => void
}

const defaultClock: Clock = {
	now: () => Date.now(),
	setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
	clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
}

export const createDispatcher = <C>(
	keymap: Keymap<C>,
	getContext: () => C,
	options: DispatcherOptions = {},
): Dispatcher<C> => {
	const clock = options.clock ?? defaultClock
	const onCollision = options.onCollision

	let state: DispatchState = initialDispatchState
	let timer: unknown = null
	const listeners = new Set<(state: DispatchState) => void>()

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
		for (const listener of listeners) listener(state)
		reschedule()
	}

	const detectCollision = (sequence: readonly ParsedStroke[], ctx: C) => {
		if (!onCollision) return
		const matches = keymap.bindings.filter((b) => {
			if (isBindingActive(b, ctx) !== true) return false
			return b.sequence.length === sequence.length && b.sequence.every((s, i) =>
				s.key === sequence[i]!.key
				&& s.ctrl === sequence[i]!.ctrl
				&& s.shift === sequence[i]!.shift
				&& s.meta === sequence[i]!.meta)
		})
		if (matches.length > 1) onCollision(sequence, matches as readonly Binding<unknown>[])
	}

	return {
		dispatch: (stroke) => {
			const ctx = getContext()
			const now = clock.now()
			const { state: next, decision } = pureDispatch(keymap, state, stroke, ctx, now, options)
			updateState(next)
			if (decision.kind === "ran") {
				detectCollision(decision.binding.sequence, ctx)
				decision.binding.action(ctx)
			}
			return decision
		},
		runById: (id) => {
			const ctx = getContext()
			const binding = keymap.bindings.find((b) => b.meta?.id === id)
			if (!binding) return { kind: "no-match" }
			const status = isBindingActive(binding, ctx)
			if (status === true) {
				binding.action(ctx)
				return { kind: "ran", binding }
			}
			return { kind: "disabled", binding, reason: status }
		},
		getState: () => state,
		getPending: () => state.pending,
		clearPending: () => updateState(initialDispatchState),
		onStateChange: (listener) => {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},
	}
}
