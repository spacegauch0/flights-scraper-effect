/**
 * Top-level render manifest (ghui pattern): all state, keymap wiring, and
 * side-effects live in useAppShell; this component is purely the layout that
 * consumes the shell bundle.
 *
 * Layout: header (route strip) / divider / form + board / divider /
 * status line / key hints.
 */

import { colors } from "../format"
import { CommandPalette } from "./CommandPalette"
import { Divider, Header, StatusLine } from "./chrome"
import { Legend } from "./Legend"
import { ResultsTable } from "./ResultsTable"
import { SearchForm } from "./SearchForm"
import { useAppShell, type AppRuntime } from "./useAppShell"

export const App = ({ runtime }: { readonly runtime: AppRuntime }) => {
  const shell = useAppShell(runtime)

  return (
    <box flexDirection="column" width="100%" height="100%" padding={1} backgroundColor={colors.background}>
      <Header route={shell.route} tripSummary={shell.tripSummary} />
      <Divider />
      <box width="100%" flexGrow={1} flexDirection="row" gap={2}>
        <SearchForm shell={shell} />
        <ResultsTable shell={shell} />
      </box>
      <Divider />
      <StatusLine text={shell.statusDisplay} />
      <Legend items={shell.hints} />
      {shell.state.palette.open ? <CommandPalette shell={shell} /> : null}
    </box>
  )
}
