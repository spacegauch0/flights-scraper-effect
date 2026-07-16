/**
 * The departure board: an open flight table (no nested borders) with
 * whole-row selection, a sortable column header bar, and colored stops.
 * Pure render off the shell bundle - selection and sorting live in the shell.
 */

import { TextAttributes } from "@opentui/core"
import { colors, TABLE_COLUMNS, fixedWidth, formatDateTimeCompact, formatDurationCompact, formatPrice, formatStops } from "../format"
import { spinnerFrame } from "../hints"
import type { FlightOption } from "../../domain"
import type { AppShell } from "./useAppShell"

const cellValue = (flight: FlightOption, key: string): string => {
  switch (key) {
    case "name":
      return (flight.is_best ? "⭐ " : "") + flight.name
    case "departure":
      return formatDateTimeCompact(flight.departure)
    case "arrival": {
      const ahead = flight.arrival_time_ahead ? ` ${flight.arrival_time_ahead}` : ""
      return formatDateTimeCompact(flight.arrival) + ahead
    }
    case "duration":
      return formatDurationCompact(flight.duration)
    case "stops":
      return formatStops(flight.stops)
    case "price":
      return formatPrice(flight.price)
    default:
      return ""
  }
}

const stopsColor = (stops: number): string =>
  stops === 0 ? colors.success : stops === 1 ? colors.warning : colors.error

const cellColor = (flight: FlightOption, key: string): string => {
  switch (key) {
    case "price":
      return colors.success
    case "stops":
      return stopsColor(flight.stops)
    case "duration":
      return colors.muted
    default:
      return colors.text
  }
}

const priceLevelColor = (level: "low" | "typical" | "high"): string =>
  level === "low" ? colors.success : level === "high" ? colors.error : colors.warning

/** Centered single-message state (empty / loading / error headline) */
const CenteredNote = ({ children }: { readonly children: React.ReactNode }) => (
  <box width="100%" flexGrow={1} flexDirection="column" justifyContent="center" alignItems="center">
    {children}
  </box>
)

export const ResultsTable = ({ shell }: { readonly shell: AppShell }) => {
  const { resultsView, sortedFlights, route } = shell
  const { table, priceLevel, errorMessage, multiCityFlow, multiCityLegs } = shell.state

  // Title bar: what this result set IS. Left: count or the multi-city step;
  // right: the route-level price verdict.
  const flightCount = `${sortedFlights.length} flight${sortedFlights.length !== 1 ? "s" : ""}`
  const boardTitle = multiCityFlow
    ? `Pick a flight · leg ${multiCityFlow.session.legIndex + 1} of ${multiCityFlow.session.legs.length}`
    : multiCityLegs
      ? `Itinerary · ${sortedFlights.length} legs`
      : flightCount

  // Selection detail: the full, untruncated flight behind the highlighted row
  const selected = table.inTableMode ? sortedFlights[table.selectedRow] : undefined
  const selectionDetail = selected
    ? `▸ ${selected.name}${selected.flight_number ? ` ${selected.flight_number}` : ""} · ${formatDateTimeCompact(selected.departure)} → ${formatDateTimeCompact(selected.arrival)}${selected.arrival_time_ahead ? ` ${selected.arrival_time_ahead}` : ""} · ${formatStops(selected.stops)} · ${formatPrice(selected.price)}`
    : ""

  return (
    <box flexGrow={1} height="100%" flexDirection="column" paddingTop={0}>
      {resultsView === "placeholder" ? (
        <CenteredNote>
          <text fg={colors.text}>No search yet</text>
          <text fg={colors.muted}>{`Press enter to find flights on ${route}`}</text>
        </CenteredNote>
      ) : null}

      {resultsView === "loading" ? (
        <CenteredNote>
          <text fg={colors.accent}>{`${spinnerFrame(shell.state.spinnerTick)} ${shell.state.spinnerLabel}`}</text>
          <text fg={colors.muted}>{route}</text>
        </CenteredNote>
      ) : null}

      {resultsView === "error" ? (
        <box width="100%" flexGrow={1} flexDirection="column" justifyContent="center" paddingLeft={2} paddingRight={2}>
          <text fg={colors.error}>Search failed</text>
          <text fg={colors.muted}>{errorMessage ?? "Something went wrong - try again."}</text>
        </box>
      ) : null}

      {resultsView === "table" ? (
        <box width="100%" flexDirection="column">
          <box width="100%" height={1} flexDirection="row" justifyContent="space-between" marginBottom={1}>
            <text wrapMode="none" fg={multiCityFlow ? colors.accent : colors.text}>{boardTitle}</text>
            <text wrapMode="none" fg={priceLevel ? priceLevelColor(priceLevel) : colors.muted}>
              {priceLevel ? `prices ${priceLevel}` : ""}
            </text>
          </box>

          <box width="100%" height={1} flexDirection="row" backgroundColor={colors.headerBg}>
            {TABLE_COLUMNS.map((col, colIndex) => {
              const isSelected = table.inTableMode && table.selectedRow === -1 && table.selectedCol === colIndex
              const isSortCol = table.sortColumn === col.key
              const sortIndicator = isSortCol ? (table.sortAsc ? " ▲" : " ▼") : ""
              const isLast = colIndex === TABLE_COLUMNS.length - 1
              return (
                <text
                  key={col.key}
                  wrapMode="none"
                  flexShrink={0}
                  fg={isSelected ? colors.selectedText : isSortCol ? colors.accent : colors.muted}
                  bg={isSelected ? colors.accent : colors.headerBg}
                >
                  {fixedWidth(col.label.toUpperCase() + sortIndicator, col.width, !isLast, col.key === "price" ? "right" : "left")}
                </text>
              )
            })}
          </box>

          {sortedFlights.map((flight, rowIndex) => {
            const isRowSelected = table.inTableMode && table.selectedRow === rowIndex
            const rowBg = isRowSelected ? colors.accent : flight.is_best ? colors.bestRowBg : undefined
            return (
              <box
                key={rowIndex}
                width="100%"
                height={1}
                flexDirection="row"
                backgroundColor={rowBg}
              >
                {TABLE_COLUMNS.map((col, colIndex) => {
                  const isLast = colIndex === TABLE_COLUMNS.length - 1
                  return (
                    <text
                      key={col.key}
                      wrapMode="none"
                      flexShrink={0}
                      fg={isRowSelected ? colors.selectedText : cellColor(flight, col.key)}
                      bg={rowBg}
                      attributes={col.key === "price" ? TextAttributes.BOLD : undefined}
                    >
                      {fixedWidth(cellValue(flight, col.key), col.width, !isLast, col.key === "price" ? "right" : "left")}
                    </text>
                  )
                })}
              </box>
            )
          })}

          <box width="100%" height={1} marginTop={1}>
            <text wrapMode="none" fg={colors.muted}>{selectionDetail}</text>
          </box>
        </box>
      ) : null}
    </box>
  )
}
