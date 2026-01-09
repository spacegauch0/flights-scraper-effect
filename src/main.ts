/**
 * Main entry point for the Google Flights Scraper TUI application
 */
import "reflect-metadata"
import { Effect, Layer } from "effect"
import { TuiLive, TUI } from "./ui"
import { ScraperProtobufLive } from "./services"
import { BunRuntime } from "@effect/platform-bun"

// The main application effect
const main = Effect.gen(function* () {
  const tui = yield* TUI
  // Render the initial UI
  yield* tui.render()
})

// Define the layers for the application
const TuiLayer = TuiLive.pipe(Layer.provide(ScraperProtobufLive), Layer.provide(TuiState.Live))

// Launch the application
const runnable = main.pipe(Layer.launch, Effect.provide(TuiLayer))

// Run the application
BunRuntime.runMain(runnable)
