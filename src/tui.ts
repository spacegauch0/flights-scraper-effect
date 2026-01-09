/**
 * Terminal User Interface for the Google Flights Scraper
 * Built with OpenTUI (https://github.com/sst/opentui)
 */
import {
  createCliRenderer,
  BoxRenderable,
  TextRenderable,
  InputRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  InputRenderableEvents,
  CliRenderer,
} from "@opentui/core"
import { Effect, Context, Layer, Exit, Schedule, Fiber } from "effect"
import { exec } from "child_process"
import { ScraperService } from "./services"
import { encodeFlightSearch } from "./utils"
import type { TripType, SeatClass, Passengers, FlightFilters, SortOption, FlightOption } from "./domain"
import { clear } from "console"

/** Represents the state of the TUI, including form inputs, search results, and table navigation */
export interface TUIState {
  origin: string
  destination: string
  departDate: string
  returnDate: string
  tripType: TripType
  seatClass: SeatClass
  passengers: Passengers
  maxStops: number
  limit: number
  isSearching: boolean
  results: FlightOption[]
  priceLevel?: "low" | "typical" | "high"
  errorMessage?: string
  statusMessage: string
}

/** Service for interacting with the Terminal User Interface */
export class TUI extends Context.Tag("TUI")<
  TUI,
  {
    readonly renderer: CliRenderer
    readonly state: TUIState
    /** Renders the entire TUI based on the current state */
    readonly render: () => Effect.Effect<void>
    /** Displays a temporary status message */
    readonly setStatus: (message: string, duration?: number) => Effect.Effect<void>
    /** Updates the search results and redraws the table */
    readonly setSearchResults: (results: FlightOption[], priceLevel?: "low" | "typical" | "high") => Effect.Effect<void>
    /** Displays an error message */
    readonly setErrorMessage: (message: string) => Effect.Effect<void>
    /** Clears any displayed error message */
    readonly clearError: () => Effect.Effect<void>
    /** Attaches all the necessary keyboard and mouse event listeners */
    readonly attachEventListeners: () => Effect.Effect<void>
  }
>() {}

/** Live implementation of the TUI service */
export const TuiLive = Layer.effect(
  TUI,
  Effect.gen(function* () {
    const scraper = yield* ScraperService
    const renderer = yield* Effect.tryPromise(() =>
      createCliRenderer({
        exitOnCtrlC: true,
        backgroundColor: colors.bg,
        useMouse: true,
        useAlternateScreen: true,
      }),
    )

    const state: TUIState = {
      origin: "JFK",
      destination: "LHR",
      departDate: "2025-12-25",
      returnDate: "2025-12-30",
      tripType: "one-way",
      seatClass: "economy",
      passengers: { adults: 1 },
      maxStops: 2,
      limit: 10,
      isSearching: false,
      results: [],
      statusMessage: "Enter: search | Ctrl+R: results | Ctrl+C: exit",
    }

    const tableState = {
      selectedRow: 0,
      selectedCol: 0,
      sortColumn: "price",
      sortAsc: true,
      inTableMode: false,
    }

    // --- Renderable Components ---
    const { root } = renderer
    const mainContainer = new BoxRenderable(renderer, {
      flexDirection: "column",
      width: "100%",
      height: "100%",
      padding: 1,
      backgroundColor: colors.bg,
    })
    const legendBar = new BoxRenderable(renderer, {
      width: "100%",
      height: 1,
      flexDirection: "row",
      backgroundColor: colors.legendBg,
    })
    const legendText = new TextRenderable(renderer, {
      content: "↑↓ rows │ ←→ cols │ Space sort │ Enter open/search │ Ctrl+R table │ Esc form │ Tab next",
      fg: colors.accent,
    })
    const contentRow = new BoxRenderable(renderer, {
      width: "100%",
      flexGrow: 1,
      flexDirection: "row",
      gap: 2,
    })
    const leftPanel = new BoxRenderable(renderer, {
      width: 32,
      height: "100%",
      flexDirection: "column",
      border: true,
      borderStyle: "rounded",
      borderColor: colors.border,
      padding: 1,
      title: " Search ",
      titleAlignment: "center",
      backgroundColor: colors.bgLight,
    })
    const formFields = new BoxRenderable(renderer, { width: "100%", flexDirection: "column", gap: 1 })
    const originInput = new InputRenderable(renderer, {
      width: "100%",
      height: 1,
      value: state.origin,
      placeholder: "JFK",
      backgroundColor: colors.bg,
      textColor: colors.text,
      focusedBackgroundColor: colors.primaryDark,
      focusedTextColor: colors.text,
      maxLength: 3,
    })
    const destInput = new InputRenderable(renderer, {
      width: "100%",
      height: 1,
      value: state.destination,
      placeholder: "LHR",
      backgroundColor: colors.bg,
      textColor: colors.text,
      focusedBackgroundColor: colors.primaryDark,
      focusedTextColor: colors.text,
      maxLength: 3,
    })
    const departInput = new InputRenderable(renderer, {
      width: "100%",
      height: 1,
      value: state.departDate,
      placeholder: "YYYY-MM-DD",
      backgroundColor: colors.bg,
      textColor: colors.text,
      focusedBackgroundColor: colors.primaryDark,
      focusedTextColor: colors.text,
      maxLength: 10,
    })
    const tripTypeSelect = new SelectRenderable(renderer, {
      width: "100%",
      height: 2,
      options: [
        { name: "One-way", value: "one-way" },
        { name: "Round-trip", value: "round-trip" },
      ],
      backgroundColor: colors.bg,
      textColor: colors.text,
      selectedBackgroundColor: colors.primary,
      selectedTextColor: colors.bg,
    })
    const seatSelect = new SelectRenderable(renderer, {
      width: "100%",
      height: 4,
      options: [
        { name: "Economy", value: "economy" },
        { name: "Premium", value: "premium-economy" },
        { name: "Business", value: "business" },
        { name: "First", value: "first" },
      ],
      backgroundColor: colors.bg,
      textColor: colors.text,
      selectedBackgroundColor: colors.primary,
      selectedTextColor: colors.bg,
    })
    const statusBox = new BoxRenderable(renderer, {
      width: "100%",
      marginTop: 1,
      padding: 1,
      border: true,
      borderStyle: "single",
      borderColor: colors.border,
      backgroundColor: colors.bg,
    })
    const statusText = new TextRenderable(renderer, { content: "", fg: colors.textDim })
    const rightPanel = new BoxRenderable(renderer, {
      flexGrow: 1,
      height: "100%",
      flexDirection: "column",
      border: true,
      borderStyle: "rounded",
      borderColor: colors.border,
      padding: 1,
      title: " Results ",
      titleAlignment: "center",
      backgroundColor: colors.bgLight,
    })
    const resultsContainer = new BoxRenderable(renderer, {
      width: "100%",
      height: "100%",
      flexDirection: "column",
    })

    // --- Component Assembly ---
    root.add(mainContainer)
    mainContainer.add(legendBar)
    legendBar.add(legendText)
    mainContainer.add(contentRow)
    contentRow.add(leftPanel)
    leftPanel.add(formFields)
    formFields.add(new TextRenderable(renderer, { content: "From:", fg: colors.text }))
    formFields.add(originInput)
    formFields.add(new TextRenderable(renderer, { content: "To:", fg: colors.text }))
    formFields.add(destInput)
    formFields.add(new TextRenderable(renderer, { content: "Date:", fg: colors.text }))
    formFields.add(departInput)
    formFields.add(new TextRenderable(renderer, { content: "Trip:", fg: colors.text }))
    formFields.add(tripTypeSelect)
    formFields.add(new TextRenderable(renderer, { content: "Class:", fg: colors.text }))
    formFields.add(seatSelect)
    formFields.add(statusBox)
    statusBox.add(statusText)
    contentRow.add(rightPanel)
    rightPanel.add(resultsContainer)

    let statusResetFiber: Fiber.RuntimeFiber<void, never> | null = null

    /** Sets a status message, optionally resetting it after a duration */
    const setStatus = (message: string, duration?: number) =>
      Effect.gen(function* () {
        if (statusResetFiber) {
          yield* Fiber.interrupt(statusResetFiber)
          statusResetFiber = null
        }
        state.statusMessage = message
        yield* render()

        if (duration) {
          const resetEffect = Effect.sleep(`${duration} seconds`).pipe(
            Effect.flatMap(() => setStatus("Enter: search | Ctrl+R: results | Ctrl+C: exit")),
            Effect.interruptible,
          )
          statusResetFiber = yield* Effect.fork(resetEffect)
        }
      })

    const setSearchResults = (results: FlightOption[], priceLevel?: "low" | "typical" | "high") =>
      Effect.sync(() => {
        state.results = results
        state.priceLevel = priceLevel
        tableState.selectedRow = 0
        tableState.selectedCol = 0
        state.isSearching = false
      }).pipe(
        Effect.flatMap(() =>
          setStatus(
            `✅ ${state.results.length} flight${state.results.length !== 1 ? "s" : ""}` +
              ` | R: results | Enter: search`,
          ),
        ),
        Effect.flatMap(render),
      )

    const setErrorMessage = (message: string) =>
      Effect.sync(() => {
        state.errorMessage = message
        state.isSearching = false
      }).pipe(
        Effect.flatMap(() => setStatus("Search failed")),
        Effect.flatMap(render),
      )

    const clearError = () =>
      Effect.sync(() => {
        state.errorMessage = undefined
      }).pipe(Effect.flatMap(render))

    const render = () =>
      Effect.sync(() => {
        clearChildren(resultsContainer)
        statusText.content = state.statusMessage

        if (state.errorMessage) {
          resultsContainer.add(new TextRenderable(renderer, { content: `❌ Error: ${state.errorMessage}`, fg: colors.error }))
        } else if (state.isSearching) {
          resultsContainer.add(new TextRenderable(renderer, { content: "Loading...", fg: colors.textDim }))
        } else if (state.results.length === 0) {
          resultsContainer.add(
            new TextRenderable(renderer, { content: "Press Enter to search for flights...", fg: colors.textDim }),
          )
        } else {
          renderTable()
        }
        renderer.requestRender()
      })

    const renderTable = () => {
      // Price level indicator
      if (state.priceLevel) {
        const priceColor =
          state.priceLevel === "low" ? colors.success : state.priceLevel === "high" ? colors.error : colors.warning
        resultsContainer.add(
          new TextRenderable(renderer, {
            content: `💰 Prices are ${state.priceLevel.toUpperCase()} for this route`,
            fg: priceColor,
          }),
        )
      }

      const tableBox = new BoxRenderable(renderer, {
        width: "100%",
        height: "auto",
        flexDirection: "column",
        border: true,
        borderColor: colors.border,
        paddingLeft: 1,
        paddingRight: 1,
      })
      resultsContainer.add(tableBox)

      const sortedFlights = sortFlights(state.results, tableState.sortColumn, tableState.sortAsc)
      const headerRow = new BoxRenderable(renderer, {
        width: "100%",
        height: 1,
        flexDirection: "row",
        backgroundColor: colors.headerBg,
      })
      tableBox.add(headerRow)

      TABLE_COLUMNS.forEach((col, colIndex) => {
        const isSelected = tableState.inTableMode && tableState.selectedRow === -1 && tableState.selectedCol === colIndex
        const isSortCol = tableState.sortColumn === col.key
        const sortIndicator = isSortCol ? (tableState.sortAsc ? " ▲" : " ▼") : ""
        headerRow.add(
          new TextRenderable(renderer, {
            content: fixedWidth(
              col.label + sortIndicator,
              col.width,
              colIndex < TABLE_COLUMNS.length - 1,
              col.key === "price" ? "right" : "left",
            ),
            fg: isSelected ? colors.bg : isSortCol ? colors.primary : colors.text,
            bg: isSelected ? colors.primary : colors.headerBg,
          }),
        )
      })

      tableBox.add(
        new TextRenderable(renderer, {
          content: "─".repeat(TABLE_COLUMNS.reduce((sum, col) => sum + col.width, 0)),
          fg: colors.border,
        }),
      )

      sortedFlights.forEach((flight, rowIndex) => {
        const isRowSelected = tableState.inTableMode && tableState.selectedRow === rowIndex
        const row = new BoxRenderable(renderer, {
          width: "100%",
          height: 1,
          flexDirection: "row",
          backgroundColor: flight.is_best ? "#1a3a2a" : rowIndex % 2 === 0 ? colors.bg : colors.bgLight,
        })
        tableBox.add(row)

        TABLE_COLUMNS.forEach((col, colIndex) => {
          const isCellSelected = isRowSelected && tableState.selectedCol === colIndex
          let value = ""
          switch (col.key) {
            case "name":
              value = (flight.is_best ? "⭐ " : "") + flight.name
              break
            case "departure":
              value = formatDateTimeCompact(flight.departure)
              break
            case "arrival":
              value =
                formatDateTimeCompact(flight.arrival) + (flight.arrival_time_ahead ? ` ${flight.arrival_time_ahead}` : "")
              break
            case "duration":
              value = flight.duration
              break
            case "stops":
              value = formatStops(flight.stops)
              break
            case "price":
              value = formatPrice(flight.price)
              break
          }
          row.add(
            new TextRenderable(renderer, {
              content: fixedWidth(
                value,
                col.width,
                colIndex < TABLE_COLUMNS.length - 1,
                col.key === "price" ? "right" : "left",
              ),
              fg: isCellSelected ? colors.bg : col.key === "price" ? colors.success : colors.text,
              bg: isCellSelected ? colors.primary : undefined,
            }),
          )
        })
      })

      const selected = sortedFlights[Math.max(0, Math.min(tableState.selectedRow, sortedFlights.length - 1))]
      const summary = selected
        ? `Sel: ${selected.name} | ${selected.departure} → ${selected.arrival} | ${formatPrice(selected.price)}`
        : ""
      resultsContainer.add(
        new TextRenderable(renderer, {
          content: `─ ${sortedFlights.length} flight${sortedFlights.length !== 1 ? "s" : ""} ─ ${summary}`,
          fg: colors.textDim,
        }),
      )
    }

    const performSearch = Effect.gen(function* () {
      if (state.isSearching) return
      yield* clearError()
      state.isSearching = true
      yield* setStatus("🔍 Searching...")

      const filters: FlightFilters = { max_stops: state.maxStops, limit: state.limit }
      const sortOption: SortOption = "none"
      const returnDate = state.tripType === "round-trip" ? state.returnDate : undefined

      const searchResult = yield* scraper.scrape(
        state.origin,
        state.destination,
        state.departDate,
        state.tripType,
        returnDate,
        sortOption,
        filters,
        state.seatClass,
        state.passengers,
        "USD",
      )
      yield* setSearchResults(searchResult.flights, searchResult.current_price)
    }).pipe(
      Effect.catchAll(error => setErrorMessage(error.message)),
    )

    const attachEventListeners = () =>
      Effect.sync(() => {
        const focusableElements = [originInput, destInput, departInput, tripTypeSelect, seatSelect]
        let currentFocusIndex = 0

        const focusNext = Effect.sync(() => {
          tableState.inTableMode = false
          currentFocusIndex = (currentFocusIndex + 1) % focusableElements.length
          focusableElements[currentFocusIndex].focus()
          renderer.requestRender()
        })

        const focusPrev = Effect.sync(() => {
          tableState.inTableMode = false
          currentFocusIndex = (currentFocusIndex - 1 + focusableElements.length) % focusableElements.length
          focusableElements[currentFocusIndex].focus()
          renderer.requestRender()
        })

        const enterTableMode = () =>
          Effect.gen(function* () {
            if (state.results.length > 0) {
              tableState.inTableMode = true
              tableState.selectedRow = 0
              tableState.selectedCol = 0
              focusableElements.forEach(el => el.blur())
              yield* render()
              yield* setStatus("📋 Table mode | Enter: open flight | Esc: back to form")
            }
          })

        const exitTableMode = () =>
          Effect.gen(function* () {
            tableState.inTableMode = false
            focusableElements[currentFocusIndex].focus()
            yield* render()
            yield* setStatus(`✅ ${state.results.length} flights | R: results | Enter: search`)
          })

        // --- Event Listeners ---
        originInput.on(InputRenderableEvents.CHANGE, () => (state.origin = originInput.value.toUpperCase()))
        destInput.on(InputRenderableEvents.CHANGE, () => (state.destination = destInput.value.toUpperCase()))
        departInput.on(InputRenderableEvents.CHANGE, () => (state.departDate = departInput.value))
        tripTypeSelect.on(
          SelectRenderableEvents.SELECTION_CHANGED,
          () => (state.tripType = (tripTypeSelect.getSelectedOption()?.value as TripType) ?? "one-way"),
        )
        seatSelect.on(
          SelectRenderableEvents.SELECTION_CHANGED,
          () => (state.seatClass = (seatSelect.getSelectedOption()?.value as SeatClass) ?? "economy"),
        )

        renderer.keyInput.on("keypress", (_, event) => {
          let handler = Effect.void
          if (tableState.inTableMode) {
            // Table navigation
            switch (event.name) {
              case "up":
                tableState.selectedRow = Math.max(-1, tableState.selectedRow - 1)
                handler = render()
                break
              case "down":
                tableState.selectedRow = Math.min(state.results.length - 1, tableState.selectedRow + 1)
                handler = render()
                break
              case "left":
                tableState.selectedCol = Math.max(0, tableState.selectedCol - 1)
                handler = render()
                break
              case "right":
                tableState.selectedCol = Math.min(TABLE_COLUMNS.length - 1, tableState.selectedCol + 1)
                handler = render()
                break
              case "space": {
                const col = TABLE_COLUMNS[tableState.selectedCol]
                if (col.sortable) {
                  if (tableState.sortColumn === col.key) {
                    tableState.sortAsc = !tableState.sortAsc
                  } else {
                    tableState.sortColumn = col.key
                    tableState.sortAsc = true
                  }
                }
                handler = render()
                break
              }
              case "return":
              case "enter": {
                const sortedFlights = sortFlights(state.results, tableState.sortColumn, tableState.sortAsc)
                const selectedFlight = sortedFlights[tableState.selectedRow]
                if (selectedFlight) {
                  if (selectedFlight.deep_link) {
                    handler = Effect.gen(function* () {
                      yield* openInBrowser(selectedFlight.deep_link)
                      yield* setStatus(`🌐 Opening flight...`, 2)
                    })
                  } else {
                    handler = Effect.gen(function* () {
                      yield* setStatus(`🌐 Building URL...`)
                      const url = yield* buildGoogleFlightsUrl(
                        state.origin,
                        state.destination,
                        state.departDate,
                        state.tripType,
                        state.returnDate,
                        state.seatClass,
                        state.passengers,
                      )
                      yield* openInBrowser(url)
                      yield* setStatus(`🌐 Opening search... (no direct link)`, 2)
                    })
                  }
                }
                break
              }
              case "escape":
                handler = exitTableMode()
                break
            }
          } else {
            // Form navigation
            switch (event.name) {
              case "return":
              case "enter":
                handler = performSearch
                break
              case "r":
                if (event.ctrl) handler = enterTableMode()
                break
              case "n":
                if (event.ctrl) handler = focusNext
                break
              case "p":
                if (event.ctrl) handler = focusPrev
                break
            }
          }
          if (handler !== Effect.void) {
            Effect.runFork(handler)
          }
        })

        renderer.prependInputHandler((sequence: string) => {
          if (sequence === "\t") {
            Effect.runFork(tableState.inTableMode ? exitTableMode() : focusNext)
            return true
          }
          if (sequence === "\x1b[Z") {
            Effect.runFork(tableState.inTableMode ? exitTableMode() : focusPrev)
            return true
          }
          return false
        })

        focusableElements[0].focus()
        renderer.start()
      })

    return {
      renderer,
      state,
      render,
      setStatus,
      setSearchResults,
      setErrorMessage,
      clearError,
      attachEventListeners,
    }
  }),
)

// --- Helper Functions ---
const openInBrowser = (url: string) =>
  Effect.try(() => {
    const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open"
    exec(`${command} "${url}"`)
  })

const buildGoogleFlightsUrl = (
  origin: string,
  destination: string,
  departDate: string,
  tripType: TripType,
  returnDate?: string,
  seatClass: SeatClass = "economy",
  passengers: Passengers = { adults: 1 },
) =>
  Effect.gen(function* () {
    const flightData = [{ date: departDate, from_airport: origin, to_airport: destination }]
    if (tripType === "round-trip" && returnDate) {
      flightData.push({ date: returnDate, from_airport: destination, to_airport: origin })
    }

    const tfs = yield* encodeFlightSearch(flightData, tripType, seatClass, passengers)
    const params = new URLSearchParams({ tfs, hl: "en", tfu: "EgQIABABIgA" })
    return `https://www.google.com/travel/flights?${params.toString()}`
  }).pipe(
    Effect.catchTag("ProtobufError", () =>
      Effect.succeed(
        `https://www.google.com/travel/flights?q=${encodeURIComponent(
          `Flights from ${origin} to ${destination} on ${departDate}`,
        )}`,
      ),
    ),
  )

const clearChildren = (container: BoxRenderable) => {
  container.getChildren().forEach(child => {
    container.remove(child.id)
    child.destroy()
  })
}

const parseDurationMinutes = (duration: string): number => {
  const hrMatch = duration.match(/(\d+)\s*hr/)
  const minMatch = duration.match(/(\d+)\s*min/)
  return (hrMatch ? parseInt(hrMatch[1]) * 60 : 0) + (minMatch ? parseInt(minMatch[1]) : 0)
}

const parsePrice = (price: string): number => parseFloat(price.replace(/[^0-9.-]/g, "")) || 0

const sortFlights = (flights: FlightOption[], column: string, asc: boolean): FlightOption[] => {
  return [...flights].sort((a, b) => {
    let cmp = 0
    switch (column) {
      case "name":
        cmp = a.name.localeCompare(b.name)
        break
      case "departure":
        cmp = a.departure.localeCompare(b.departure)
        break
      case "arrival":
        cmp = a.arrival.localeCompare(b.arrival)
        break
      case "duration":
        cmp = parseDurationMinutes(a.duration) - parseDurationMinutes(b.duration)
        break
      case "stops":
        cmp = a.stops - b.stops
        break
      case "price":
        cmp = parsePrice(a.price) - parsePrice(b.price)
        break
    }
    return asc ? cmp : -cmp
  })
}

const getVisualWidth = (str: string): number => {
  let width = 0
  for (const char of str) {
    const code = char.codePointAt(0) || 0
    width +=
      code >= 0x1f000 ||
      (code >= 0x2300 && code <= 0x27bf) ||
      (code >= 0x2b00 && code <= 0x2bff) ||
      (code >= 0x1100 && code <= 0x9fff)
        ? 2
        : 1
  }
  return width
}

const fixedWidth = (str: string, width: number, addSep = true, align: "left" | "right" = "left"): string => {
  const maxContent = width - (addSep ? 2 : 0)
  let content = str
  let visualWidth = getVisualWidth(content)

  if (visualWidth > maxContent) {
    content = ""
    visualWidth = 0
    for (const char of str) {
      const charWidth = getVisualWidth(char)
      if (visualWidth + charWidth > maxContent - 1) break
      content += char
      visualWidth += charWidth
    }
    content += "…"
    visualWidth += 1
  }

  const padding = " ".repeat(Math.max(0, maxContent - visualWidth))
  content = align === "right" ? padding + content : content + padding
  return addSep ? content + "│ " : content
}

const formatPrice = (price: string): string => {
  const numeric = parsePrice(price)
  return Number.isNaN(numeric) ? price || "-" : `$${numeric.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
}

const formatStops = (stops: number): string => (stops === 0 ? "Nonstop" : `${stops} stop${stops > 1 ? "s" : ""}`)

const formatDateTimeCompact = (value: string): string => {
  if (!value) return "-"
  const match = value.match(/^(\d{1,2}:\d{2}\s*[AP]M)\s+on\s+([A-Za-z]{3})/)
  return match ? `${match[2]} ${match[1].replace(/\s+/g, " ")}` : value.replace(" on ", " ").replace(/,\s*/g, " ")
}

// --- Color Scheme ---
const colors = {
  bg: "#0f172a",
  bgLight: "#1e293b",
  bgHighlight: "#334155",
  primary: "#38bdf8",
  primaryDark: "#0284c7",
  secondary: "#a855f7",
  accent: "#22d3ee",
  text: "#f1f5f9",
  textDim: "#94a3b8",
  success: "#22c55e",
  warning: "#eab308",
  error: "#ef4444",
  border: "#334155",
  headerBg: "#1e3a5f",
  legendBg: "#0b1220",
}

// --- Table Column Definitions ---
interface TableColumn {
  key: string
  label: string
  width: number
  sortable: boolean
}

const TABLE_COLUMNS: TableColumn[] = [
  { key: "name", label: "Airline", width: 22, sortable: true },
  { key: "departure", label: "Departure", width: 20, sortable: true },
  { key: "arrival", label: "Arrival", width: 20, sortable: true },
  { key: "duration", label: "Duration", width: 14, sortable: true },
  { key: "stops", label: "Stops", width: 10, sortable: true },
  { key: "price", label: "Price", width: 12, sortable: true },
]
