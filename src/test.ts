import { Effect, Layer } from "effect"
import { createCliRenderer } from "@opentui/core"
import { BunRuntime } from "@effect/platform-bun"

const main = Effect.gen(function* () {
  const renderer = yield* Effect.tryPromise(() =>
    createCliRenderer({
      exitOnCtrlC: true,
    }),
  )
  renderer.textBuffer.writeAt(1, 1, "Hello from test!")
  renderer.requestRender()
  yield* Effect.sleep("5 seconds")
})

const runnable = main.pipe(Layer.launch)

BunRuntime.runMain(runnable)
