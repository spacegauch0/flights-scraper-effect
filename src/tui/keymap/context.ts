import { command as buildCommand, type CommandConfig } from "./command"
import { Keymap } from "./keymap"

export type ContextItem<C> = CommandConfig<C> | Keymap<C>

export interface Context<C> {
  (...items: readonly ContextItem<C>[]): Keymap<C>
}

const isKeymap = <C>(item: ContextItem<C>): item is Keymap<C> => item instanceof Keymap

/**
 * Returns a callable bound to context type `C`. Each argument is either a
 * `CommandConfig<C>` (auto-wrapped via `command()`) or an existing `Keymap<C>`.
 *
 * ```ts
 * const Diff = context<DiffCtx>()
 *
 * const km = Diff(
 *   scrollCommands<DiffCtx>(),
 *   { id: "diff.close", title: "Close", keys: ["escape"], run: (s) => s.close() },
 * )
 * ```
 *
 * The benefit: `s` is typed `DiffCtx` automatically because the call site
 * fixes `C`. No `<DiffCtx>` repeated per command.
 */
export const context =
  <C>(): Context<C> =>
  (...items: readonly ContextItem<C>[]): Keymap<C> =>
    Keymap.union(...items.map((item) => (isKeymap(item) ? item : buildCommand(item))))
