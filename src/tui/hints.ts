/**
 * Contextual footer hints: a pure function from UI state to the hint items
 * the legend bar should show. Only currently-possible actions appear;
 * unavailable ones either drop out (`when`) or render dimmed (`disabled`).
 */

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const
export const SPINNER_INTERVAL_MS = 1000 / 12

export const spinnerFrame = (tick: number): string => SPINNER_FRAMES[((tick % SPINNER_FRAMES.length) + SPINNER_FRAMES.length) % SPINNER_FRAMES.length]

export interface HintItem {
  readonly key: string
  readonly label: string
  /** Omit the hint entirely when false */
  readonly when?: boolean
  /** Keep the hint visible but render it dimmed */
  readonly disabled?: boolean
}

export interface HintsContext {
  readonly mode: "form" | "table" | "palette"
  readonly isSearching: boolean
  readonly spinnerTick: number
  readonly hasResults: boolean
  readonly isMultiCity: boolean
  readonly canAddLeg: boolean
  readonly canRemoveLeg: boolean
  /** True while interactively picking a multi-city leg in the table */
  readonly isPickingLeg: boolean
  /** e.g. "Leg 2/3" while picking */
  readonly legLabel?: string
}

// The legend lists actions only; search progress animates in the status line
// and the results pane, so these stay stable while a search runs (constantly
// remounting the legend text is also an OpenTUI renderer hazard).
const formHints = (ctx: HintsContext): readonly HintItem[] => [
  { key: "enter", label: "search", disabled: ctx.isSearching },
  { key: "tab", label: "next field" },
  { key: "ctrl+r", label: "results", when: ctx.hasResults },
  { key: "ctrl+a", label: "add leg", when: ctx.isMultiCity, disabled: !ctx.canAddLeg },
  { key: "ctrl+x", label: "drop leg", when: ctx.isMultiCity, disabled: !ctx.canRemoveLeg },
  { key: "ctrl+p", label: "commands" },
  { key: "ctrl+c", label: "quit" },
]

const tableHints = (ctx: HintsContext): readonly HintItem[] => [
  { key: "↑↓", label: "rows" },
  { key: "←→", label: "cols" },
  { key: "space", label: "sort" },
  {
    key: "enter",
    label: ctx.isPickingLeg ? `choose ${ctx.legLabel ?? "leg"}` : "open flight",
    disabled: !ctx.hasResults,
  },
  { key: "g g", label: "top" },
  { key: "ctrl+p", label: "commands" },
  { key: "esc", label: "form" },
]

const paletteHints: readonly HintItem[] = [
  { key: "type", label: "filter" },
  { key: "↑↓", label: "move" },
  { key: "enter", label: "run" },
  { key: "esc", label: "close" },
]

export const footerHints = (ctx: HintsContext): readonly HintItem[] => {
  const items = ctx.mode === "palette" ? paletteHints : ctx.mode === "table" ? tableHints(ctx) : formHints(ctx)
  return items.filter((item) => item.when !== false)
}
