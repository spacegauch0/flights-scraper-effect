/**
 * Command palette overlay (ctrl+p): filterable list of the active mode's
 * commands with their key bindings; disabled entries show their reason.
 */

import { useTerminalDimensions } from "@opentui/react"
import { colors, fixedWidth } from "../format"
import type { AppShell } from "./useAppShell"

const PALETTE_WIDTH = 52
const PALETTE_MAX_ROWS = 9

export const CommandPalette = ({ shell }: { readonly shell: AppShell }) => {
  const { width: terminalWidth } = useTerminalDimensions()
  const { paletteEntries } = shell
  const { filter, selected } = shell.state.palette

  const clampedSelected = Math.max(0, Math.min(selected, paletteEntries.length - 1))
  const windowStart = Math.max(
    0,
    Math.min(clampedSelected - Math.floor(PALETTE_MAX_ROWS / 2), paletteEntries.length - PALETTE_MAX_ROWS)
  )
  const visible = paletteEntries.slice(windowStart, windowStart + PALETTE_MAX_ROWS)
  const innerWidth = PALETTE_WIDTH - 4

  return (
    <box
      position="absolute"
      left={Math.max(2, Math.floor((terminalWidth - PALETTE_WIDTH) / 2))}
      top={2}
      width={PALETTE_WIDTH}
      zIndex={100}
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor={colors.accent}
      backgroundColor={colors.surface}
      title=" Commands "
      titleAlignment="center"
      paddingLeft={1}
      paddingRight={1}
    >
      <input
        width="100%"
        value={filter}
        placeholder="Type to filter..."
        focused
        onInput={shell.actions.setPaletteFilter}
        backgroundColor={colors.background}
        textColor={colors.text}
        focusedBackgroundColor={colors.background}
        focusedTextColor={colors.text}
      />

      <box width="100%" flexDirection="column" marginTop={1}>
        {paletteEntries.length === 0 ? (
          <text fg={colors.muted}>No matching commands</text>
        ) : (
          visible.map((entry, index) => {
            const isSelected = windowStart + index === clampedSelected
            const disabled = entry.status !== true
            const titleText = disabled ? `${entry.title} · ${entry.status}` : entry.title
            return (
              <box key={entry.id} width="100%" height={1} flexDirection="row">
                <text
                  fg={isSelected ? colors.selectedText : disabled ? colors.muted : colors.text}
                  bg={isSelected ? colors.accent : undefined}
                >
                  {fixedWidth(titleText, Math.max(8, innerWidth - entry.keys.length - 1), false)}
                </text>
                <text
                  fg={isSelected ? colors.selectedText : colors.hintKey}
                  bg={isSelected ? colors.accent : undefined}
                >
                  {` ${entry.keys}`}
                </text>
              </box>
            )
          })
        )}
      </box>
    </box>
  )
}
