import { useEffect, useMemo, useRef, useSyncExternalStore } from "react"
import { createDispatcher, type Dispatcher, type DispatcherOptions } from "./dispatcher"
import type { ParsedStroke } from "./keys"
import type { Keymap } from "./keymap"
import type { DispatchState } from "./pure-dispatch"

export type KeySubscribe = (handler: (stroke: ParsedStroke) => boolean | void) => () => void

/**
 * Mounts a Keymap. Subscribes to host key events through `subscribe`; reads
 * `ctx` fresh on every dispatch. The dispatcher is re-created when `keymap`
 * identity changes, so swapping keymaps reactively works.
 */
export const useKeymap = <C>(
	keymap: Keymap<C>,
	ctx: C,
	subscribe: KeySubscribe,
	options?: DispatcherOptions,
): Dispatcher<C> => {
	const ctxRef = useRef(ctx)
	ctxRef.current = ctx

	const dispatcher = useMemo(
		() => createDispatcher(keymap, () => ctxRef.current, options),
		// Intentionally depend on keymap; options is captured at first build.
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[keymap],
	)

	useEffect(() => subscribe((stroke) => dispatcher.dispatch(stroke).kind !== "no-match"), [dispatcher, subscribe])

	return dispatcher
}

export const useDispatchState = <C>(dispatcher: Dispatcher<C>): DispatchState =>
	useSyncExternalStore(
		(callback) => dispatcher.onStateChange(() => callback()),
		dispatcher.getState,
		dispatcher.getState,
	)

export const usePendingSequence = <C>(dispatcher: Dispatcher<C>): readonly ParsedStroke[] =>
	useDispatchState(dispatcher).pending
