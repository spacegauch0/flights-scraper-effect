import type { Binding, BindingMeta, Enabled } from "./binding"
import { Keymap } from "./keymap"
import { parseBinding } from "./keys"

export interface CommandConfig<C> {
	readonly id?: string
	readonly title?: string
	readonly description?: string
	readonly group?: string
	readonly keywords?: readonly string[]
	readonly keys: readonly string[] | string
	readonly when?: (ctx: C) => boolean
	readonly enabled?: (ctx: C) => Enabled
	readonly run: (ctx: C) => void
}

const buildMeta = (config: CommandConfig<unknown>): BindingMeta | undefined => {
	const meta: BindingMeta = {
		...(config.id !== undefined && { id: config.id }),
		...(config.title !== undefined && { title: config.title }),
		...(config.description !== undefined && { description: config.description }),
		...(config.group !== undefined && { group: config.group }),
		...(config.keywords !== undefined && { keywords: config.keywords }),
	}
	return Object.keys(meta).length > 0 ? meta : undefined
}

/**
 * Build a Keymap from one logical command. Multiple key alternatives produce
 * multiple bindings that share the same action and meta.
 */
export const command = <C>(config: CommandConfig<C>): Keymap<C> => {
	const keys = typeof config.keys === "string" ? [config.keys] : config.keys
	const meta = buildMeta(config as CommandConfig<unknown>)
	const sequences = keys.length === 0 ? [[]] as readonly (readonly never[])[] : keys.map(parseBinding)
	const bindings: Binding<C>[] = sequences.map((sequence) => ({
		sequence,
		...(config.when ? { when: config.when } : {}),
		...(config.enabled ? { enabled: config.enabled } : {}),
		action: config.run,
		...(meta ? { meta } : {}),
	}))
	return new Keymap<C>(bindings)
}
