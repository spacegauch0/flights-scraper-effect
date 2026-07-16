/**
 * Keymap engine: bindings as data, state as input.
 *
 * Vendored from ghui's `@ghui/keymap` package (github.com/kitlangton/ghui,
 * MIT license) minus its React adapter. Renderer-agnostic and dependency-free:
 *
 * - A `Binding` is a value: key sequence + `when`/`enabled` gates + action +
 *   palette metadata. `enabled` may return a reason string ("No row selected"),
 *   which surfaces in hints instead of silently ignoring the key.
 * - `Keymap` is a monoid (`union`/`empty`) and contravariant (`lift`/`scope`),
 *   so per-mode keymaps compose into one app keymap that self-gates by mode.
 * - Dispatch is pure (`pureDispatch`/`pureTick`): multi-key sequences and
 *   disambiguation timeouts are unit-testable without a terminal.
 */

export {
	type Binding,
	type BindingMeta,
	type Command,
	type Enabled,
	isBindingActive,
	isCommand,
} from "./binding"
export { command, type CommandConfig } from "./command"
export { context, type Context, type ContextItem } from "./context"
export {
	type Clock,
	createDispatcher,
	type Dispatcher,
	type DispatcherOptions,
	type DispatchResult,
} from "./dispatcher"
export { Keymap } from "./keymap"
export {
	formatSequence,
	formatStroke,
	parseBinding,
	parseKey,
	type ParsedStroke,
	sequenceMatches,
	sequenceStartsWith,
	strokeMatches,
} from "./keys"
export {
	type DispatchDecision,
	type DispatchState,
	initialDispatchState,
	pureDispatch,
	type PureDispatchOptions,
	pureTick,
} from "./pure-dispatch"
export { type Scrollable, scrollCommands } from "./scroll"
export { type BindingSnapshot, snapshot } from "./snapshot"
