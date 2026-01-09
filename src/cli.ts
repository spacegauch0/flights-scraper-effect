/**
 * Main entry point for Google Flights Scraper
 * Routes to CLI or TUI based on command-line arguments
 */

import { runCli } from "./cli/index"
import { runTui } from "./tui/index"

// Check if --tui flag is present or if no CLI arguments are provided
const args = process.argv.slice(2)
const isTuiMode = args.includes("--tui") || args.length === 0 || args[0] === "--help" || args[0] === "-h"

if (isTuiMode && !args.includes("--help") && !args.includes("-h")) {
  // Run TUI
  runTui().catch(console.error)
} else {
  // Run CLI
  const production = args.includes("--production") || args.includes("-p")
  runCli(production).catch(console.error)
}
