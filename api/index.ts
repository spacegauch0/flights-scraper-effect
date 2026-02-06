/**
 * Vercel Serverless Function Entry Point (Bun Runtime)
 *
 * With bunVersion set in vercel.json, Vercel uses Bun to execute this file
 * directly — no esbuild bundling step needed. Bun handles TypeScript natively.
 */

import { initializeServices, createApp } from "../src/api/server-hono"

const API_KEY = process.env.API_KEY

if (!API_KEY) {
  throw new Error("API_KEY environment variable is required")
}

// Initialize Effect services once per cold start (top-level await, supported by Bun ESM)
const { scraperService, cacheService } = await initializeServices()

// Create the Hono app with initialized services
const app = createApp(API_KEY, scraperService, cacheService)

// Vercel's Bun runtime calls app.fetch(req) for each incoming request
export default app
