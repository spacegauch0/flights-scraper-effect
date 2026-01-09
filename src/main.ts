/**
 * Main entry point for the Google Flights Scraper TUI application
 */
import "reflect-metadata"
import { Effect, Layer } from "effect"
import { TuiLive, TUI } from "./tui"
import { ScraperProtobufLive } from "./services"
import { BunRuntime } from "@effect/platform-bun"

// The main application effect
const main = Effect.gen(function* () {
  const tui = yield* TUI
  // Render the initial UI
  yield* tui.render()
  // Attach event listeners and start the renderer event loop
  yield* tui.attachEventListeners()
})

// Define the layers for the application
const TuiLayer = TuiLive.pipe(Layer.provide(ScraperProtobufLive))

// Run the application
BunRuntime.runMain(main.pipe(Effect.provide(TuiLayer)))
