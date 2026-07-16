/**
 * Full-app frame test: mounts the real React TUI against the mock scraper
 * with OpenTUI's in-memory test renderer, drives it with mock key input,
 * and asserts on the captured character frames. This is ground truth for
 * rendering (no pty, no terminal emulator in between).
 */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/react/test-utils"
import { Layer, ManagedRuntime } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { createElement } from "react"
import { ScraperMockLive } from "../src/services/scraper-mock"
import { App } from "../src/tui/app/App"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const makeRuntime = () =>
  ManagedRuntime.make(Layer.mergeAll(ScraperMockLive, FetchHttpClient.layer))

describe("TUI frames", () => {
  test("search → table → sort by airline renders a consistent board", async () => {
    const runtime = makeRuntime()
    const setup = await testRender(createElement(App, { runtime }), { width: 120, height: 40 })
    const { mockInput, waitForFrame, captureCharFrame } = setup

    await waitForFrame((frame) => frame.includes("No search yet"), { maxPasses: 500 })

    // Search: the mock scraper answers after ~400ms of simulated latency
    mockInput.pressEnter()
    await sleep(700)
    const boardFrame = await waitForFrame((frame) => frame.includes("prices typical"), { maxPasses: 500 })
    expect(boardFrame).toContain("10 flights")

    // Enter table mode, move selection down twice. React schedules commits
    // on macrotasks, so give each key a beat of real time before waiting.
    mockInput.pressKey("r", { ctrl: true })
    await sleep(100)
    await waitForFrame((frame) => frame.includes("open flight"), { maxPasses: 500 })
    await mockInput.pressKeys(["j", "j"], 30)
    await sleep(100)
    await waitForFrame((frame) => frame.includes("▸ Air France"), { maxPasses: 500 })

    // Table-mode legend replaced the form legend
    const tableFrame = captureCharFrame()
    expect(tableFrame).toContain("g g top")
    expect(tableFrame).not.toContain("next field")

    // Sort by the airline column (selection starts on col 0)
    await mockInput.pressKeys([" "], 30)
    await sleep(100)
    const frame = await waitForFrame((f) => f.includes("AIRLINE ▲"), { maxPasses: 500 })

    // The board must be the alphabetically sorted mock data - every airline
    // in order, exactly once per row, with its own price on the row.
    const boardRows = frame
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /\$\d/.test(line) && line.includes("│") && !line.includes("▸"))
    const airlines = [
      "Air France", "British Airways", "British Airways", "Delta", "Iberia",
      "Iberia", "Lufthansa", "Norse Atlantic", "Norse Atlantic", "United"
    ]
    expect(boardRows.length).toBe(10)
    for (let i = 0; i < airlines.length; i++) {
      expect(boardRows[i] ?? "").toContain(airlines[i])
    }

    // Selection summary reflects the row moved to before sorting
    expect(frame).toContain("▸ British Airways")

    await runtime.dispose()
  }, 30000)

  test("command palette opens, filters, and runs a command", async () => {
    const runtime = makeRuntime()
    const setup = await testRender(createElement(App, { runtime }), { width: 120, height: 40 })
    const { mockInput, waitForFrame } = setup

    await waitForFrame((frame) => frame.includes("No search yet"), { maxPasses: 500 })

    mockInput.pressKey("p", { ctrl: true })
    await sleep(100)
    const palette = await waitForFrame((f) => f.includes("Commands"), { maxPasses: 500 })
    expect(palette).toContain("Search flights")
    expect(palette).toContain("Command palette")
    // No results yet: the results command is listed disabled, with its reason
    expect(palette).toContain("Focus results table · No results yet")

    // Filter down to the search command and run it
    await mockInput.typeText("search", 20)
    await sleep(100)
    const filtered = await waitForFrame((f) => f.includes("Search flights") && !f.includes("Next field"), { maxPasses: 500 })
    expect(filtered).toContain("Search flights")

    mockInput.pressEnter()
    await sleep(700)
    const results = await waitForFrame((f) => f.includes("prices typical"), { maxPasses: 500 })
    expect(results).toContain("10 flights")

    await runtime.dispose()
  }, 30000)
})
