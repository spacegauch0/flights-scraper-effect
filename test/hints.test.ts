import { describe, expect, test } from "bun:test"
import { footerHints, spinnerFrame, SPINNER_FRAMES, type HintsContext } from "../src/tui/hints"

const baseCtx: HintsContext = {
  mode: "form",
  isSearching: false,
  spinnerTick: 0,
  hasResults: false,
  isMultiCity: false,
  canAddLeg: true,
  canRemoveLeg: false,
  isPickingLeg: false,
}

const keys = (ctx: HintsContext) => footerHints(ctx).map((item) => item.key)
const labels = (ctx: HintsContext) => footerHints(ctx).map((item) => item.label)

describe("footerHints", () => {
  test("form mode without results hides the results hint", () => {
    expect(keys(baseCtx)).not.toContain("ctrl+r")
    expect(keys({ ...baseCtx, hasResults: true })).toContain("ctrl+r")
  })

  test("multi-city hints only appear for multi-city trips, dimmed at the leg limit", () => {
    expect(keys(baseCtx)).not.toContain("ctrl+a")

    const multi = footerHints({ ...baseCtx, isMultiCity: true, canAddLeg: false })
    const addLeg = multi.find((item) => item.key === "ctrl+a")
    expect(addLeg?.disabled).toBe(true)
  })

  test("searching dims the search hint instead of animating the legend", () => {
    const searching = { ...baseCtx, isSearching: true, spinnerTick: 3 }
    const enter = footerHints(searching).find((item) => item.key === "enter")
    expect(enter?.disabled).toBe(true)
    // No spinner frames in the legend - progress animates in the status line
    expect(keys(searching)).not.toContain(SPINNER_FRAMES[3])
  })

  test("table mode while picking a leg labels enter with the leg", () => {
    const picking: HintsContext = {
      ...baseCtx,
      mode: "table",
      hasResults: true,
      isPickingLeg: true,
      legLabel: "leg 2/3",
    }
    const enter = footerHints(picking).find((item) => item.key === "enter")
    expect(enter?.label).toBe("choose leg 2/3")
  })

  test("spinnerFrame cycles safely", () => {
    expect(spinnerFrame(0)).toBe(SPINNER_FRAMES[0])
    expect(spinnerFrame(SPINNER_FRAMES.length + 2)).toBe(SPINNER_FRAMES[2])
  })
})
