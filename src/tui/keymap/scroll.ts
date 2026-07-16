import { command } from "./command"
import { Keymap } from "./keymap"

/**
 * Standard vim-style scroll context: scroll-by, scroll-to, half-page size.
 * Any keymap whose context extends this can use {@link scrollCommands}.
 */
export interface Scrollable {
	readonly halfPage: number
	readonly scrollBy: (delta: number) => void
	readonly scrollTo: (line: number) => void
}

/**
 * Vim-style scroll bindings: j/k/up/down for line scroll, ctrl-u/d/v + pageup/pagedown
 * for half-page, g g + home for top, shift+g + end for bottom.
 *
 * The Keymap requires its context to extend Scrollable. Lift it to a wider
 * context with `contramap` or `contramapMaybe`.
 */
export const scrollCommands = <C extends Scrollable>(): Keymap<C> => Keymap.union(
	command<C>({ id: "scroll.up",       title: "Up",            keys: ["k", "up"],                      run: (s) => s.scrollBy(-1) }),
	command<C>({ id: "scroll.down",     title: "Down",          keys: ["j", "down"],                    run: (s) => s.scrollBy(1) }),
	command<C>({ id: "scroll.half-up",  title: "Half page up",  keys: ["pageup", "ctrl+u"],             run: (s) => s.scrollBy(-s.halfPage) }),
	command<C>({ id: "scroll.half-down",title: "Half page down",keys: ["pagedown", "ctrl+d", "ctrl+v"], run: (s) => s.scrollBy(s.halfPage) }),
	command<C>({ id: "scroll.top",      title: "Top",           keys: ["g g", "home"],                  run: (s) => s.scrollTo(0) }),
	command<C>({ id: "scroll.bottom",   title: "Bottom",        keys: ["shift+g", "end"],               run: (s) => s.scrollTo(Number.MAX_SAFE_INTEGER) }),
)
