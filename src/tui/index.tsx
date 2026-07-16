/**
 * Terminal User Interface for the Google Flights Scraper.
 * Built with OpenTUI's React renderer (https://github.com/anomalyco/opentui);
 * all state and behavior live in the app shell hook (./app/useAppShell).
 */

import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { Layer, ManagedRuntime } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { ScraperProtobufLive } from "../services"
import { ScraperMockLive } from "../services/scraper-mock"
import { colors } from "./format"
import { App } from "./app/App"

export async function runTui() {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    backgroundColor: colors.background,
    useMouse: true,
    screenMode: "alternate-screen",
  })

  // Compose layers once. provideMerge keeps HttpClient exposed because the
  // TUI also drives the booking-options and multi-city adapters directly.
  // ManagedRuntime bridges React event handlers into Effect without
  // rebuilding the layer graph per program. FLIGHTS_TUI_MOCK=1
  // (bun run tui:mock) swaps in the deterministic mock scraper for
  // network-free UI iteration.
  const AppLive = process.env.FLIGHTS_TUI_MOCK === "1"
    ? Layer.mergeAll(ScraperMockLive, FetchHttpClient.layer)
    : ScraperProtobufLive.pipe(Layer.provideMerge(FetchHttpClient.layer))
  const runtime = ManagedRuntime.make(AppLive)

  createRoot(renderer).render(<App runtime={runtime} />)
}
