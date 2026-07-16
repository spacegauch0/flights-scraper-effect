/**
 * The RPC transport's pure pieces: session extraction from a search page,
 * the f.req request envelope, and the wrb.fr response envelope.
 */
import { describe, expect, test } from "bun:test"
import { encodeFReq, extractRpcSession, parseRpcBlocks } from "../src/services/google-rpc"

describe("extractRpcSession", () => {
  test("scrapes bl and fSid from page source", () => {
    const html = `<script>var x = {"cfb2h":"boq_travel-frontend-ui_20260101.01_p0","FdrFJe":"-1234567890"};</script>`
    expect(extractRpcSession(html, "https://example.com/search")).toEqual({
      bl: "boq_travel-frontend-ui_20260101.01_p0",
      fSid: "-1234567890",
      referer: "https://example.com/search",
    })
  })

  test("returns undefined when either value is missing", () => {
    expect(extractRpcSession(`{"cfb2h":"only-bl"}`, "ref")).toBeUndefined()
    expect(extractRpcSession(`{"FdrFJe":"-1"}`, "ref")).toBeUndefined()
  })
})

describe("f.req envelope", () => {
  test("double-JSON encodes the payload as a form body", () => {
    const body = encodeFReq([null, "inner"])
    expect(body).toStartWith("f.req=")
    expect(body).toEndWith("&")

    const decoded = decodeURIComponent(body.slice("f.req=".length, -1))
    const outer = JSON.parse(decoded)
    expect(outer[0]).toBeNull()
    expect(JSON.parse(outer[1])).toEqual([null, "inner"])
  })
})

describe("wrb.fr envelope", () => {
  test("decodes payload blocks and skips noise lines", () => {
    const payload = [null, [["some", "data"]]]
    const line = JSON.stringify([["wrb.fr", null, JSON.stringify(payload)]])
    const responseText = `)]}'\n\n42\n${line}\n[["di",12]]\n`

    expect(parseRpcBlocks(responseText)).toEqual([payload])
  })

  test("tolerates malformed lines", () => {
    expect(parseRpcBlocks(`[["wrb.fr" not-json\n`)).toEqual([])
    expect(parseRpcBlocks("")).toEqual([])
  })
})
