import { type Binding, type BindingMeta, isBindingActive } from "./binding"
import { formatSequence } from "./keys"
import type { Keymap } from "./keymap"

export interface BindingSnapshot {
	readonly sequence: string
	readonly status: true | string
	readonly meta: BindingMeta
}

/**
 * Project a Keymap to a serializable shape for palette rendering, footer hints,
 * dev tooling, or wire transport. Functions on bindings (when/enabled/action)
 * are not included; status reflects the binding's `isBindingActive` result for
 * the given ctx.
 */
export const snapshot = <C>(keymap: Keymap<C>, ctx: C): readonly BindingSnapshot[] =>
	keymap.bindings.map((binding: Binding<C>) => ({
		sequence: formatSequence(binding.sequence),
		status: isBindingActive(binding, ctx),
		meta: binding.meta ?? {},
	}))
