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
} from "@opentui/core"
import { Effect, Exit, Layer } from "effect"
import { FetchHttpClient } from "@effect/platform"
import { exec } from "child_process"
import { ScraperService, ScraperProtobufLive } from "../services"
import { encodeFlightSearch } from "../utils"
import type { TripType, SeatClass, Passengers, FlightFilters, SortOption, FlightOption } from "../domain"

/** Opens a URL in the default browser */
function openInBrowser(url: string): void {
  // Use 'open' on macOS, 'xdg-open' on Linux, 'start' on Windows
  const platform = process.platform
  const command = platform === "darwin" ? "open" 
    : platform === "win32" ? "start" 
    : "xdg-open"
  exec(`${command} "${url}"`)
}

/** Builds Google Flights search URL using protobuf encoding (same as scraper) */
async function buildGoogleFlightsUrl(
  origin: string,
  destination: string,
  departDate: string,
  tripType: TripType,
  returnDate?: string,
  seatClass: SeatClass = "economy",
  passengers: Passengers = { adults: 1, children: 0, infants_in_seat: 0, infants_on_lap: 0 },
  currency: string = "USD"
): Promise<string> {
  // Build flight data for protobuf encoding
  const flightData = [{
    date: departDate,
    from_airport: origin,
    to_airport: destination
  }]
  
  if (tripType === "round-trip" && returnDate) {
    flightData.push({
      date: returnDate,
      from_airport: destination,
      to_airport: origin
    })
  }
  
  // Try to encode using protobuf (same as scraper)
  const result = await Effect.runPromiseExit(
    encodeFlightSearch(flightData, tripType, seatClass, passengers).pipe(
      Effect.map((tfs: string) => {
        const params = new URLSearchParams({ tfs, hl: "en", tfu: "EgQIABABIgA" })
        if (currency) params.set("curr", currency)
        return `https://www.google.com/travel/flights?${params.toString()}`
      }),
      Effect.catchAll(() => {
        // Fallback to simple query URL if encoding fails
        let searchQuery = `Flights from ${origin} to ${destination} on ${departDate}`
        if (tripType === "round-trip" && returnDate) {
          searchQuery += ` return ${returnDate}`
        }
        return Effect.succeed(`https://www.google.com/travel/flights?q=${encodeURIComponent(searchQuery)}`)
      })
    )
  )
  
  if (Exit.isSuccess(result)) {
    return result.value
  }
  
  // Final fallback if everything fails
  let searchQuery = `Flights from ${origin} to ${destination} on ${departDate}`
  if (tripType === "round-trip" && returnDate) {
    searchQuery += ` return ${returnDate}`
  }
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(searchQuery)}`
}

/** Color scheme */
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

/** Table column definition */
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

/** Table state */
interface TableState {
  selectedRow: number
  selectedCol: number
  sortColumn: string
  sortAsc: boolean
  inTableMode: boolean
}

const tableState: TableState = {
  selectedRow: 0,
  selectedCol: 0,
  sortColumn: "price",
  sortAsc: true,
  inTableMode: false,
}

/** Application state */
interface AppState {
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
  currentField: number
}

const state: AppState = {
  origin: "JFK",
  destination: "LHR",
  departDate: "2026-01-25",
  returnDate: "2026-01-30",
  tripType: "one-way",
  seatClass: "economy",
  passengers: { adults: 1, children: 0, infants_in_seat: 0, infants_on_lap: 0 },
  maxStops: 2,
  limit: 10,
  isSearching: false,
  results: [],
  currentField: 0,
}

/** Helper to clear all children from a container */
function clearChildren(container: BoxRenderable) {
  const children = container.getChildren()
  children.forEach(child => {
    container.remove(child.id)
    child.destroy()
  })
}

/** Parse duration to minutes for sorting */
function parseDurationMinutes(duration: string): number {
  const hrMatch = duration.match(/(\d+)\s*hr/)
  const minMatch = duration.match(/(\d+)\s*min/)
  return (hrMatch ? parseInt(hrMatch[1]) * 60 : 0) + (minMatch ? parseInt(minMatch[1]) : 0)
}

/** Parse price to number for sorting */
function parsePrice(price: string): number {
  return parseFloat(price.replace(/[^0-9.-]/g, "")) || 0
}

/** Sort flights based on column and direction */
function sortFlights(flights: FlightOption[], column: string, asc: boolean): FlightOption[] {
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

/** Calculate the visual width of a string (accounting for emojis and wide chars) */
function getVisualWidth(str: string): number {
  let width = 0
  for (const char of str) {
    const code = char.codePointAt(0) || 0
    // Emoji and wide characters typically take 2 columns in terminal
    if (code >= 0x1F000 || // Emoji and symbols (1F000+)
        (code >= 0x2300 && code <= 0x23FF) || // Misc technical
        (code >= 0x2600 && code <= 0x27BF) || // Misc symbols
        (code >= 0x2B00 && code <= 0x2BFF) || // Misc symbols and arrows (includes ⭐ U+2B50)
        (code >= 0x2900 && code <= 0x297F) || // Supplemental arrows
        (code >= 0x1100 && code <= 0x11FF) || // Korean Jamo
        (code >= 0x3000 && code <= 0x9FFF) || // CJK
        (code >= 0xAC00 && code <= 0xD7AF) || // Korean Hangul
        (code >= 0xFE00 && code <= 0xFE0F)) { // Variation selectors
      width += 2
    } else {
      width += 1
    }
  }
  return width
}

/** Pad/truncate string to fixed width with separator (handles Unicode properly) */
function fixedWidth(str: string, width: number, addSep = true, align: "left" | "right" = "left"): string {
  const maxContent = width - (addSep ? 2 : 0)
  let content = str
  let visualWidth = getVisualWidth(content)
  
  // Truncate if too long
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
  
  // Pad to fixed width
  const padding = maxContent - visualWidth
  if (padding > 0) {
    if (align === "right") {
      content = " ".repeat(padding) + content
    } else {
      content = content + " ".repeat(padding)
    }
  }
  
  return addSep ? content + "│ " : content
}

/** Human friendly price formatter (USD) */
function formatPrice(price: string): string {
  const numeric = parseFloat(price.replace(/[^0-9.]/g, ""))
  if (Number.isNaN(numeric)) return price || "-"
  return `$${numeric.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
}

/** Friendly stops text */
function formatStops(stops: number): string {
  if (stops === 0) return "Nonstop"
  if (stops === 1) return "1 stop"
  return `${stops} stops`
}

/** Compact date/time, e.g., "8:20 AM on Wed, Jan 14" -> "Wed 8:20 AM" */
function formatDateTimeCompact(value: string): string {
  if (!value) return "-"
  const match = value.match(/^(\d{1,2}:\d{2}\s*[AP]M)\s+on\s+([A-Za-z]{3})/)
  if (match) {
    const time = match[1].replace(/\s+/g, " ")
    const day = match[2]
    return `${day} ${time}`
  }
  return value.replace(" on ", " ").replace(/,\s*/g, " ")
}

export async function runTui() {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    backgroundColor: colors.bg,
    useMouse: true,
    useAlternateScreen: true,
  })

  // Compose layers once - provide FetchHttpClient for HTTP requests
  const AppLive = ScraperProtobufLive.pipe(
    Layer.provide(FetchHttpClient.layer)
  )

  const { root } = renderer

  // Main container
  const mainContainer = new BoxRenderable(renderer, {
    flexDirection: "column",
    width: "100%",
    height: "100%",
    padding: 1,
    backgroundColor: colors.bg,
  })
  root.add(mainContainer)

  // Legend / Keybindings bar (k9s style)
  const legendBar = new BoxRenderable(renderer, {
    width: "100%",
    height: 1,
    flexDirection: "row",
    backgroundColor: colors.legendBg,
  })
  mainContainer.add(legendBar)

  const legendText = new TextRenderable(renderer, {
    content: "↑↓ rows │ ←→ cols │ Space sort │ Enter open/search │ Ctrl+R table │ Esc form │ Tab next",
    fg: colors.accent,
  })
  legendBar.add(legendText)

  // Main content row
  const contentRow = new BoxRenderable(renderer, {
    width: "100%",
    flexGrow: 1,
    flexDirection: "row",
    gap: 2,
  })
  mainContainer.add(contentRow)

  // Left panel - Search form
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
  contentRow.add(leftPanel)

  // Form fields container
  const formFields = new BoxRenderable(renderer, {
    width: "100%",
    flexDirection: "column",
    gap: 1,
  })
  leftPanel.add(formFields)

  // Origin input
  const originLabel = new TextRenderable(renderer, { content: "From:", fg: colors.text })
  formFields.add(originLabel)
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
  formFields.add(originInput)

  // Destination input
  const destLabel = new TextRenderable(renderer, { content: "To:", fg: colors.text })
  formFields.add(destLabel)
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
  formFields.add(destInput)

  // Trip type selector (moved to be below "To")
  const tripTypeLabel = new TextRenderable(renderer, { content: "Trip:", fg: colors.text })
  formFields.add(tripTypeLabel)
  const tripTypeSelect = new SelectRenderable(renderer, {
    width: "100%",
    height: 2,
    options: [
      { name: "One-way", description: "", value: "one-way" },
      { name: "Round-trip", description: "", value: "round-trip" },
    ],
    selectedIndex: 0,
    backgroundColor: colors.bg,
    textColor: colors.text,
    selectedBackgroundColor: colors.primary,
    selectedTextColor: colors.bg,
    showDescription: false,
    wrapSelection: true,
  })
  formFields.add(tripTypeSelect)

  // Departure date
  const departLabel = new TextRenderable(renderer, { content: "Date:", fg: colors.text })
  formFields.add(departLabel)
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
  formFields.add(departInput)

  // Return date (only shown for round-trip)
  const returnLabel = new TextRenderable(renderer, { content: "Return:", fg: colors.text })
  const returnInput = new InputRenderable(renderer, {
    width: "100%",
    height: 1,
    value: state.returnDate,
    placeholder: "YYYY-MM-DD",
    backgroundColor: colors.bg,
    textColor: colors.text,
    focusedBackgroundColor: colors.primaryDark,
    focusedTextColor: colors.text,
    maxLength: 10,
  })

  // Function to update return date visibility
  const updateReturnDateVisibility = () => {
    const children = formFields.getChildren()
    const returnLabelIndex = children.findIndex(c => c.id === returnLabel.id)
    const isCurrentlyVisible = returnLabelIndex !== -1
    
    if (state.tripType === "round-trip" && !isCurrentlyVisible) {
      // Sync return input value with state before showing it
      returnInput.value = state.returnDate || returnInput.value
      
      // Add return date fields right after departure date input
      const departInputIndex = children.findIndex(c => c.id === departInput.id)
      if (departInputIndex !== -1) {
        // Remove all elements after departure date input, add return date, then re-add the rest
        const elementsAfterDepartDate: any[] = []
        for (let i = departInputIndex + 1; i < children.length; i++) {
          const child = children[i]
          elementsAfterDepartDate.push(child)
          formFields.remove(child.id)
        }
        // Add return date fields
        formFields.add(returnLabel)
        formFields.add(returnInput)
        // Re-add the elements that were after departure date
        elementsAfterDepartDate.forEach(el => formFields.add(el))
      } else {
        // Fallback: just add at the end
        formFields.add(returnLabel)
        formFields.add(returnInput)
      }
      // Adjust focus if needed
      const focusableElements = getFocusableElements()
      if (currentFocusIndex >= focusableElements.length) {
        currentFocusIndex = Math.max(0, focusableElements.length - 1)
      }
    } else if (state.tripType !== "round-trip" && isCurrentlyVisible) {
      // Remove return date fields
      formFields.remove(returnLabel.id)
      formFields.remove(returnInput.id)
      // Adjust focus if we were on return input
      const focusableElements = getFocusableElements()
      if (currentFocusIndex >= focusableElements.length) {
        currentFocusIndex = Math.max(0, focusableElements.length - 1)
        focusableElements[currentFocusIndex].focus()
      }
    }
    renderer.requestRender()
  }

  // Initialize visibility based on current trip type
  if (state.tripType === "round-trip") {
    // Insert right after departure date input
    const children = formFields.getChildren()
    const departInputIndex = children.findIndex(c => c.id === departInput.id)
    if (departInputIndex !== -1) {
      const elementsAfterDepartDate: any[] = []
      for (let i = departInputIndex + 1; i < children.length; i++) {
        const child = children[i]
        elementsAfterDepartDate.push(child)
        formFields.remove(child.id)
      }
      formFields.add(returnLabel)
      formFields.add(returnInput)
      elementsAfterDepartDate.forEach(el => formFields.add(el))
    } else {
      formFields.add(returnLabel)
      formFields.add(returnInput)
    }
  }

  // Seat class selector
  const seatLabel = new TextRenderable(renderer, { content: "Class:", fg: colors.text })
  formFields.add(seatLabel)
  const seatSelect = new SelectRenderable(renderer, {
    width: "100%",
    height: 4,
    options: [
      { name: "Economy", description: "", value: "economy" },
      { name: "Premium", description: "", value: "premium-economy" },
      { name: "Business", description: "", value: "business" },
      { name: "First", description: "", value: "first" },
    ],
    selectedIndex: 0,
    backgroundColor: colors.bg,
    textColor: colors.text,
    selectedBackgroundColor: colors.primary,
    selectedTextColor: colors.bg,
    showDescription: false,
    wrapSelection: true,
  })
  formFields.add(seatSelect)

  // Status/Instructions
  const statusBox = new BoxRenderable(renderer, {
    width: "100%",
    marginTop: 1,
    padding: 1,
    border: true,
    borderStyle: "single",
    borderColor: colors.border,
    backgroundColor: colors.bg,
  })
  formFields.add(statusBox)

  const statusText = new TextRenderable(renderer, {
    content: "Enter: search\nR: focus results\nCtrl+C: exit",
    fg: colors.textDim,
  })
  statusBox.add(statusText)

  // Right panel - Results Table
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
  contentRow.add(rightPanel)

  // Results container
  const resultsContainer = new BoxRenderable(renderer, {
    width: "100%",
    height: "100%",
    flexDirection: "column",
  })
  rightPanel.add(resultsContainer)

  const placeholderText = new TextRenderable(renderer, {
    content: "Press Enter to search for flights...",
    fg: colors.textDim,
  })
  resultsContainer.add(placeholderText)

  // Table rendering function
  let headerElements: TextRenderable[] = []
  let rowElements: TextRenderable[][] = []

  const renderTable = () => {
    clearChildren(resultsContainer)
    headerElements = []
    rowElements = []

    if (state.results.length === 0) {
      const noResults = new TextRenderable(renderer, {
        content: "No flights found. Press Enter to search.",
        fg: colors.textDim,
      })
      resultsContainer.add(noResults)
      return
    }

    // Price level indicator bar
    if (state.priceLevel) {
      const priceColor = state.priceLevel === "low" ? colors.success
        : state.priceLevel === "high" ? colors.error
        : colors.warning
      const priceIndicator = new TextRenderable(renderer, {
        content: `💰 Prices are ${state.priceLevel.toUpperCase()} for this route`,
        fg: priceColor,
      })
      resultsContainer.add(priceIndicator)
    }
    
    // Table container with border
    const tableBox = new BoxRenderable(renderer, {
      width: "100%",
      height: "auto",
      flexDirection: "column",
      border: true,
      borderStyle: "single",
      borderColor: colors.border,
      paddingLeft: 1,
      paddingRight: 1,
      paddingTop: 0,
      paddingBottom: 0,
      backgroundColor: colors.bg,
    })
    resultsContainer.add(tableBox)

    // Sort the flights
    const sortedFlights = sortFlights(state.results, tableState.sortColumn, tableState.sortAsc)

    // Table header row
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
      const isLast = colIndex === TABLE_COLUMNS.length - 1
      
      const headerCell = new TextRenderable(renderer, {
        content: fixedWidth(col.label + sortIndicator, col.width, !isLast, col.key === "price" ? "right" : "left"),
        fg: isSelected ? colors.bg : (isSortCol ? colors.primary : colors.text),
        bg: isSelected ? colors.primary : colors.headerBg,
      })
      headerRow.add(headerCell)
      headerElements.push(headerCell)
    })

    // Separator line
    const tableWidth = TABLE_COLUMNS.reduce((sum, col) => sum + col.width + 2, -2) // account for separators
    const separatorLine = new TextRenderable(renderer, {
      content: "─".repeat(Math.max(tableWidth, 60)),
      fg: colors.border,
    })
    tableBox.add(separatorLine)

    // Data rows
    sortedFlights.forEach((flight, rowIndex) => {
      const isRowSelected = tableState.inTableMode && tableState.selectedRow === rowIndex
      
      const row = new BoxRenderable(renderer, {
        width: "100%",
        height: 1,
        flexDirection: "row",
        backgroundColor: flight.is_best ? "#1a3a2a" : (rowIndex % 2 === 0 ? colors.bg : colors.bgLight),
      })
      tableBox.add(row)

      const rowCells: TextRenderable[] = []

      TABLE_COLUMNS.forEach((col, colIndex) => {
        const isCellSelected = isRowSelected && tableState.selectedCol === colIndex
        const isLast = colIndex === TABLE_COLUMNS.length - 1
        let value = ""
        
        switch (col.key) {
          case "name":
            value = (flight.is_best ? "⭐ " : "") + flight.name
            break
          case "departure":
            value = formatDateTimeCompact(flight.departure)
            break
          case "arrival": {
            const arr = formatDateTimeCompact(flight.arrival)
            const ahead = flight.arrival_time_ahead ? ` ${flight.arrival_time_ahead}` : ""
            value = arr + ahead
            break
          }
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

        const cell = new TextRenderable(renderer, {
          content: fixedWidth(value, col.width, !isLast, col.key === "price" ? "right" : "left"),
          fg: isCellSelected ? colors.bg : (col.key === "price" ? colors.success : colors.text),
          bg: isCellSelected ? colors.primary : undefined,
        })
        row.add(cell)
        rowCells.push(cell)
      })

      rowElements.push(rowCells)
    })

    // Footer with count and selected flight summary
    const selected = sortedFlights[Math.max(0, Math.min(tableState.selectedRow, sortedFlights.length - 1))]
    const summary = selected
      ? `Sel: ${selected.name} | ${selected.departure} → ${selected.arrival} | ${formatStops(selected.stops)} | ${formatPrice(selected.price)}`
      : ""
    const footer = new TextRenderable(renderer, {
      content: `─ ${sortedFlights.length} flight${sortedFlights.length !== 1 ? "s" : ""} ─ ${summary}`,
      fg: colors.textDim,
    })
    resultsContainer.add(footer)
  }

  // Event handlers
  originInput.on(InputRenderableEvents.CHANGE, () => {
    state.origin = originInput.value.toUpperCase()
  })

  destInput.on(InputRenderableEvents.CHANGE, () => {
    state.destination = destInput.value.toUpperCase()
  })

  departInput.on(InputRenderableEvents.CHANGE, () => {
    state.departDate = departInput.value
  })

  returnInput.on(InputRenderableEvents.CHANGE, () => {
    state.returnDate = returnInput.value
  })

  tripTypeSelect.on(SelectRenderableEvents.SELECTION_CHANGED, () => {
    const selected = tripTypeSelect.getSelectedOption()
    if (selected) {
      state.tripType = selected.value as TripType
      updateReturnDateVisibility()
    }
  })

  seatSelect.on(SelectRenderableEvents.SELECTION_CHANGED, () => {
    const selected = seatSelect.getSelectedOption()
    if (selected) state.seatClass = selected.value as SeatClass
  })

  // Focusable elements list for Tab navigation (dynamically updated)
  // Order matches visual order: From -> To -> Trip -> Date -> Return (if round-trip) -> Class
  const getFocusableElements = () => {
    const base = [originInput, destInput, tripTypeSelect, departInput]
    if (state.tripType === "round-trip") {
      base.push(returnInput)
    }
    base.push(seatSelect)
    return base
  }
  let currentFocusIndex = 0

  const focusNext = () => {
    tableState.inTableMode = false
    const focusableElements = getFocusableElements()
    currentFocusIndex = (currentFocusIndex + 1) % focusableElements.length
    focusableElements[currentFocusIndex].focus()
    renderer.requestRender()
  }

  const focusPrev = () => {
    tableState.inTableMode = false
    const focusableElements = getFocusableElements()
    currentFocusIndex = (currentFocusIndex - 1 + focusableElements.length) % focusableElements.length
    focusableElements[currentFocusIndex].focus()
    renderer.requestRender()
  }

  const enterTableMode = () => {
    if (state.results.length > 0) {
      tableState.inTableMode = true
      tableState.selectedRow = 0
      tableState.selectedCol = 0
      getFocusableElements().forEach(el => el.blur())
      renderTable()
      statusText.content = `📋 Table mode\nEnter: open flight\nEsc: back to form`
      renderer.requestRender()
    }
  }

  const exitTableMode = () => {
    tableState.inTableMode = false
    const focusableElements = getFocusableElements()
    focusableElements[currentFocusIndex].focus()
    renderTable()
    statusText.content = `✅ ${state.results.length} flights\nR: results | Enter: search`
    renderer.requestRender()
  }

  // Search function
  const performSearch = async () => {
    if (state.isSearching) return
    
    // Read all values directly from inputs/selects to ensure they're up-to-date
    state.origin = originInput.value.toUpperCase() || "JFK"
    state.destination = destInput.value.toUpperCase() || "LHR"
    state.departDate = departInput.value || "2025-12-25"
    
    // Update trip type from select FIRST, before checking return date
    const selectedTripType = tripTypeSelect.getSelectedOption()
    if (selectedTripType) {
      state.tripType = selectedTripType.value as TripType
    }
    
    // Update seat class from select
    const selectedSeatClass = seatSelect.getSelectedOption()
    if (selectedSeatClass) {
      state.seatClass = selectedSeatClass.value as SeatClass
    }
    
    // Update return date if round-trip - always read from input
    // The input object exists even if not visible, so we can always read its value
    if (state.tripType === "round-trip") {
      // Always read from the input object (it exists even when not in the form)
      // Use the input value, or fall back to state if input is empty
      state.returnDate = returnInput.value || state.returnDate || "2026-01-30"
    }
    
    state.isSearching = true
    statusText.content = "🔍 Searching..."
    clearChildren(resultsContainer)
    const loadingText = new TextRenderable(renderer, { content: "Loading...", fg: colors.textDim })
    resultsContainer.add(loadingText)
    renderer.requestRender()

    const filters: FlightFilters = { max_stops: state.maxStops, limit: state.limit }
    const sortOption: SortOption = "none"
    const returnDate = state.tripType === "round-trip" ? state.returnDate : undefined

    const program = Effect.gen(function* () {
      const scraper = yield* ScraperService
      return yield* scraper.scrape(
        state.origin, state.destination, state.departDate, state.tripType,
        returnDate, sortOption, filters, state.seatClass, state.passengers, "USD"
      )
    })

    const exit = await Effect.runPromiseExit(
      program.pipe(
        Effect.provide(AppLive),
        Effect.tapErrorCause((cause) => 
          Effect.sync(() => {
            clearChildren(resultsContainer)
            const errorText = new TextRenderable(renderer, {
              content: `❌ Error: ${cause}`,
              fg: colors.error,
            })
            resultsContainer.add(errorText)
            statusText.content = "Search failed"
            renderer.requestRender()
          })
        )
      )
    )
    state.isSearching = false

    if (Exit.isSuccess(exit)) {
      state.results = [...exit.value.flights]
      state.priceLevel = exit.value.current_price
      tableState.selectedRow = 0
      tableState.selectedCol = 0
      renderTable()
      statusText.content = `✅ ${state.results.length} flights\nR: results | Enter: search`
      renderer.requestRender()
    }
  }

  // Handle keyboard navigation
  renderer.keyInput.on("keypress", (event) => {
    if (tableState.inTableMode) {
      // Table navigation mode
      if (event.name === "up") {
        event.preventDefault()
        if (tableState.selectedRow > -1) {
          tableState.selectedRow--
        }
        renderTable()
        renderer.requestRender()
      } else if (event.name === "down") {
        event.preventDefault()
        if (tableState.selectedRow < state.results.length - 1) {
          tableState.selectedRow++
        }
        renderTable()
        renderer.requestRender()
      } else if (event.name === "left") {
        event.preventDefault()
        if (tableState.selectedCol > 0) {
          tableState.selectedCol--
        }
        renderTable()
        renderer.requestRender()
      } else if (event.name === "right") {
        event.preventDefault()
        if (tableState.selectedCol < TABLE_COLUMNS.length - 1) {
          tableState.selectedCol++
        }
        renderTable()
        renderer.requestRender()
      } else if (event.name === "space") {
        // Sort by current column (only when on header row)
        event.preventDefault()
        const col = TABLE_COLUMNS[tableState.selectedCol]
        if (col.sortable) {
          if (tableState.sortColumn === col.key) {
            tableState.sortAsc = !tableState.sortAsc
          } else {
            tableState.sortColumn = col.key
            tableState.sortAsc = true
          }
          renderTable()
          renderer.requestRender()
        }
      } else if (event.name === "return" || event.name === "enter") {
        // Open selected flight in Google Flights
        event.preventDefault()
        if (tableState.selectedRow >= 0 && tableState.selectedRow < state.results.length) {
          // Get the sorted flights to match what's displayed in the table
          const sortedFlights = sortFlights(state.results, tableState.sortColumn, tableState.sortAsc)
          const selectedFlight = sortedFlights[tableState.selectedRow]
          
          // Use the flight's deep_link if available, otherwise fall back to search URL
          if (selectedFlight.deep_link) {
            openInBrowser(selectedFlight.deep_link)
            statusText.content = `🌐 Opening flight...\n${selectedFlight.name}`
            renderer.requestRender()
          } else {
            // Fallback to search URL (async)
            statusText.content = `🌐 Building URL...`
            renderer.requestRender()
            const returnDate = state.tripType === "round-trip" ? state.returnDate : undefined
            buildGoogleFlightsUrl(
              state.origin,
              state.destination,
              state.departDate,
              state.tripType,
              returnDate,
              state.seatClass,
              state.passengers
            ).then(url => {
              openInBrowser(url)
              statusText.content = `🌐 Opening search...\n(no direct link)`
              renderer.requestRender()
            })
          }
        }
      } else if (event.name === "escape") {
        event.preventDefault()
        exitTableMode()
      }
    } else {
      // Form mode
      if (event.name === "return" || event.name === "enter") {
        event.preventDefault()
        performSearch()
      } else if (event.ctrl && event.name === "r") {
        event.preventDefault()
        enterTableMode()
      }
      if (event.ctrl && event.name === "n") {
        event.preventDefault()
        focusNext()
      }
      if (event.ctrl && event.name === "p") {
        event.preventDefault()
        focusPrev()
      }
    }
  })

  // Tab handling
  renderer.prependInputHandler((sequence: string) => {
    if (sequence === "\t") {
      if (tableState.inTableMode) {
        exitTableMode()
      } else {
        focusNext()
      }
      return true
    }
    if (sequence === "\x1b[Z") {
      if (tableState.inTableMode) {
        exitTableMode()
      } else {
        focusPrev()
      }
      return true
    }
    return false
  })

  getFocusableElements()[0].focus()
  renderer.start()
}
