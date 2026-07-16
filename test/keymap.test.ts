/**
 * The keymap is data and dispatch is pure, so the TUI's whole keyboard
 * surface is testable without a terminal: mode gating, disabled reasons,
 * and multi-key sequences.
 */
import { describe, expect, test } from "bun:test"
import { initialDispatchState, parseKey, pureDispatch, pureTick } from "../src/tui/keymap"
import { appKeymap, type AppCtx, type FormCtx, type PaletteCtx, type TableCtx } from "../src/tui/keymaps"

interface CtxOptions {
  mode?: AppCtx["mode"]
  rowCount?: number
  selectedRow?: number
  isSearching?: boolean
  hasResults?: boolean
  isMultiCity?: boolean
  canAddLeg?: boolean
  paletteEntryCount?: number
}

const makeCtx = (options: CtxOptions = {}, calls: string[] = []) => {
  const record = (name: string) => () => {
    calls.push(name)
  }
  const form: FormCtx = {
    isSearching: options.isSearching ?? false,
    hasResults: options.hasResults ?? false,
    isMultiCity: options.isMultiCity ?? false,
    canAddLeg: options.canAddLeg ?? true,
    canRemoveLeg: false,
    search: record("search"),
    enterTable: record("enterTable"),
    focusNext: record("focusNext"),
    focusPrev: record("focusPrev"),
    addLeg: record("addLeg"),
    removeLeg: record("removeLeg"),
    openPalette: record("openPalette"),
  }
  const table: TableCtx = {
    rowCount: options.rowCount ?? 3,
    selectedRow: options.selectedRow ?? 0,
    isPickingLeg: false,
    moveRow: (delta) => {
      calls.push(`moveRow:${delta}`)
    },
    moveCol: (delta) => {
      calls.push(`moveCol:${delta}`)
    },
    setRow: (row) => {
      calls.push(`setRow:${row}`)
    },
    sortByCurrentColumn: record("sort"),
    activate: record("activate"),
    exit: record("exit"),
    openPalette: record("openPalette"),
  }
  const palette: PaletteCtx = {
    entryCount: options.paletteEntryCount ?? 3,
    move: (delta) => {
      calls.push(`paletteMove:${delta}`)
    },
    run: record("paletteRun"),
    close: record("paletteClose"),
  }
  const ctx: AppCtx = { mode: options.mode ?? "form", form, table, palette }
  return { ctx, calls }
}

const dispatch = (ctx: AppCtx, key: string, state = initialDispatchState, now = 0) => pureDispatch(appKeymap, state, parseKey(key), ctx, now)

describe("app keymap", () => {
  test("enter runs search in form mode", () => {
    const { ctx, calls } = makeCtx({ mode: "form" })
    const { decision } = dispatch(ctx, "return")
    expect(decision.kind).toBe("ran")
    if (decision.kind === "ran") decision.binding.action(ctx)
    expect(calls).toEqual(["search"])
  })

  test("search is disabled with a reason while a search is in flight", () => {
    const { ctx } = makeCtx({ mode: "form", isSearching: true })
    const { decision } = dispatch(ctx, "return")
    expect(decision).toMatchObject({ kind: "disabled", reason: "Search already in progress" })
  })

  test("ctrl+r reports why the results table is unavailable", () => {
    const { ctx } = makeCtx({ mode: "form", hasResults: false })
    const { decision } = dispatch(ctx, "ctrl+r")
    expect(decision).toMatchObject({ kind: "disabled", reason: "No results yet - search first" })
  })

  test("table bindings are inactive in form mode (typing j must reach the input)", () => {
    const { ctx } = makeCtx({ mode: "form" })
    expect(dispatch(ctx, "j").decision.kind).toBe("no-match")
    expect(dispatch(ctx, "q").decision.kind).toBe("no-match")
  })

  test("multi-city leg bindings only exist for multi-city trips", () => {
    const oneWay = makeCtx({ mode: "form", isMultiCity: false })
    expect(dispatch(oneWay.ctx, "ctrl+a").decision.kind).toBe("no-match")

    const multi = makeCtx({ mode: "form", isMultiCity: true })
    const { decision } = dispatch(multi.ctx, "ctrl+a")
    expect(decision.kind).toBe("ran")
  })

  test("vim keys move the table selection in table mode", () => {
    const { ctx, calls } = makeCtx({ mode: "table" })
    const ran = dispatch(ctx, "j").decision
    expect(ran.kind).toBe("ran")
    if (ran.kind === "ran") ran.binding.action(ctx)
    expect(calls).toEqual(["moveRow:1"])
  })

  test("g g is a pending sequence that resolves to first row", () => {
    const { ctx, calls } = makeCtx({ mode: "table" })

    const first = dispatch(ctx, "g", initialDispatchState, 0)
    expect(first.decision.kind).toBe("pending")

    const second = pureDispatch(appKeymap, first.state, parseKey("g"), ctx, 10)
    expect(second.decision.kind).toBe("ran")
    if (second.decision.kind === "ran") second.decision.binding.action(ctx)
    expect(calls).toEqual(["setRow:0"])
  })

  test("a lone g times out without firing anything", () => {
    const { ctx, calls } = makeCtx({ mode: "table" })
    const first = dispatch(ctx, "g", initialDispatchState, 0)
    expect(first.decision.kind).toBe("pending")

    const ticked = pureTick(appKeymap, first.state, ctx, 10_000)
    expect(ticked.decision?.kind ?? "no-match").toBe("no-match")
    expect(calls).toEqual([])
  })

  test("activate is disabled when the header row is selected", () => {
    const { ctx } = makeCtx({ mode: "table", selectedRow: -1 })
    const { decision } = dispatch(ctx, "return")
    expect(decision).toMatchObject({ kind: "disabled", reason: "No row selected" })
  })

  test("ctrl+p opens the palette from form and table modes", () => {
    for (const mode of ["form", "table"] as const) {
      const { ctx, calls } = makeCtx({ mode })
      const { decision } = dispatch(ctx, "ctrl+p")
      expect(decision.kind).toBe("ran")
      if (decision.kind === "ran") decision.binding.action(ctx)
      expect(calls).toEqual(["openPalette"])
    }
  })

  test("palette mode owns the keys: enter runs the selection, form/table bindings are inactive", () => {
    const { ctx, calls } = makeCtx({ mode: "palette" })

    const ran = dispatch(ctx, "return").decision
    expect(ran.kind).toBe("ran")
    if (ran.kind === "ran") ran.binding.action(ctx)
    expect(calls).toEqual(["paletteRun"])

    // Table/form keys must not leak through while the palette is open
    expect(dispatch(ctx, "space").decision.kind).toBe("no-match")
  })

  test("palette enter is disabled when the filter matches nothing", () => {
    const { ctx } = makeCtx({ mode: "palette", paletteEntryCount: 0 })
    const { decision } = dispatch(ctx, "return")
    expect(decision).toMatchObject({ kind: "disabled", reason: "No matching command" })
  })

  test("escape closes the palette", () => {
    const { ctx, calls } = makeCtx({ mode: "palette" })
    const { decision } = dispatch(ctx, "escape")
    expect(decision.kind).toBe("ran")
    if (decision.kind === "ran") decision.binding.action(ctx)
    expect(calls).toEqual(["paletteClose"])
  })
})
