/**
 * The TUI's keymap: per-mode contexts composed into one app keymap.
 *
 * Each mode (search form, results table) gets a narrow context interface of
 * exactly the state and actions its bindings need. `scope` lifts each mode's
 * keymap into the app context and deactivates it outside its mode, so "is
 * this key live right now?" is data, not an if/else tree.
 *
 * Form mode only binds Enter/Escape and ctrl-chords: plain letters must reach
 * the focused text input. Table mode has no focused input, so it can use
 * vim-style letters and `g g` sequences.
 */

import { context, Keymap } from "./keymap"

export interface FormCtx {
  readonly isSearching: boolean
  readonly hasResults: boolean
  readonly isMultiCity: boolean
  readonly canAddLeg: boolean
  readonly canRemoveLeg: boolean
  readonly search: () => void
  readonly enterTable: () => void
  readonly focusNext: () => void
  readonly focusPrev: () => void
  readonly addLeg: () => void
  readonly removeLeg: () => void
  readonly openPalette: () => void
}

export interface TableCtx {
  readonly rowCount: number
  /** -1 selects the header row (column sort target) */
  readonly selectedRow: number
  /** True while interactively picking a multi-city leg */
  readonly isPickingLeg: boolean
  readonly moveRow: (delta: number) => void
  readonly moveCol: (delta: number) => void
  readonly setRow: (row: number) => void
  readonly sortByCurrentColumn: () => void
  /** Choose the multi-city leg or open the selected flight */
  readonly activate: () => void
  readonly exit: () => void
  readonly openPalette: () => void
}

/** The command palette overlay: filter text is handled by its input; these
 * bindings cover selection movement, running, and closing. */
export interface PaletteCtx {
  readonly entryCount: number
  readonly move: (delta: number) => void
  readonly run: () => void
  readonly close: () => void
}

export interface AppCtx {
  readonly mode: "form" | "table" | "palette"
  readonly form: FormCtx
  readonly table: TableCtx
  readonly palette: PaletteCtx
}

const Form = context<FormCtx>()
const Table = context<TableCtx>()
const Palette = context<PaletteCtx>()

const hasRows = (s: TableCtx) => (s.rowCount > 0 ? true : "No results")
const rowSelected = (s: TableCtx) => (s.selectedRow >= 0 && s.selectedRow < s.rowCount ? true : "No row selected")

export const formKeymap = Form(
  {
    id: "form.search",
    title: "Search flights",
    keys: ["return"],
    enabled: (s) => (s.isSearching ? "Search already in progress" : true),
    run: (s) => s.search(),
  },
  {
    id: "form.results",
    title: "Focus results table",
    keys: ["ctrl+r"],
    enabled: (s) => (s.hasResults ? true : "No results yet - search first"),
    run: (s) => s.enterTable(),
  },
  { id: "form.next-field", title: "Next field", keys: ["tab", "ctrl+n"], run: (s) => s.focusNext() },
  { id: "form.prev-field", title: "Previous field", keys: ["shift+tab"], run: (s) => s.focusPrev() },
  { id: "form.commands", title: "Command palette", keys: ["ctrl+p"], run: (s) => s.openPalette() },
  {
    id: "form.add-leg",
    title: "Add multi-city leg",
    keys: ["ctrl+a"],
    when: (s) => s.isMultiCity,
    enabled: (s) => (s.canAddLeg ? true : "Leg limit reached"),
    run: (s) => s.addLeg(),
  },
  {
    id: "form.remove-leg",
    title: "Remove multi-city leg",
    keys: ["ctrl+x"],
    when: (s) => s.isMultiCity,
    enabled: (s) => (s.canRemoveLeg ? true : "At least one extra leg is required"),
    run: (s) => s.removeLeg(),
  },
)

export const tableKeymap = Table(
  { id: "table.row-up", title: "Row up", keys: ["up", "k"], run: (s) => s.moveRow(-1) },
  { id: "table.row-down", title: "Row down", keys: ["down", "j"], run: (s) => s.moveRow(1) },
  { id: "table.col-left", title: "Column left", keys: ["left", "h"], run: (s) => s.moveCol(-1) },
  { id: "table.col-right", title: "Column right", keys: ["right", "l"], run: (s) => s.moveCol(1) },
  { id: "table.top", title: "First row", keys: ["g g", "home"], enabled: hasRows, run: (s) => s.setRow(0) },
  { id: "table.bottom", title: "Last row", keys: ["shift+g", "end"], enabled: hasRows, run: (s) => s.setRow(s.rowCount - 1) },
  { id: "table.sort", title: "Sort by column", keys: ["space", "s"], run: (s) => s.sortByCurrentColumn() },
  {
    id: "table.activate",
    title: "Open / choose flight",
    keys: ["return", "o"],
    enabled: rowSelected,
    run: (s) => s.activate(),
  },
  { id: "table.exit", title: "Back to form", keys: ["escape", "q", "tab"], run: (s) => s.exit() },
  { id: "table.commands", title: "Command palette", keys: ["ctrl+p"], run: (s) => s.openPalette() },
)

export const paletteKeymap = Palette(
  { id: "palette.up", title: "Selection up", keys: ["up", "ctrl+p"], run: (s) => s.move(-1) },
  { id: "palette.down", title: "Selection down", keys: ["down", "ctrl+n"], run: (s) => s.move(1) },
  {
    id: "palette.run",
    title: "Run command",
    keys: ["return"],
    enabled: (s) => (s.entryCount > 0 ? true : "No matching command"),
    run: (s) => s.run(),
  },
  { id: "palette.close", title: "Close palette", keys: ["escape"], run: (s) => s.close() },
  // Swallow tab so form focus can't move behind the overlay
  { id: "palette.tab-guard", title: "Ignore tab", keys: ["tab", "shift+tab"], run: () => {} },
)

/**
 * The whole app's keymap: each mode's bindings are inactive outside their
 * mode via `scope`, so the dispatcher needs no mode-awareness of its own.
 */
export const appKeymap: Keymap<AppCtx> = Keymap.union(
  formKeymap.scope((app: AppCtx) => app.mode === "form" && app.form),
  tableKeymap.scope((app: AppCtx) => app.mode === "table" && app.table),
  paletteKeymap.scope((app: AppCtx) => app.mode === "palette" && app.palette),
)
