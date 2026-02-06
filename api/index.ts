/**
 * Vercel Serverless Function Entry Point
 * This file is used for Vercel deployment
 */

import { createServerlessHandler } from "../src/api/server-hono"

// Load environment variables
const API_KEY = process.env.API_KEY

if (!API_KEY) {
  throw new Error("API_KEY environment variable is required")
}

// Initialize handler once (Vercel reuses the same instance)
let handler: ((req: Request) => Promise<Response>) | null = null

export default async function vercelHandler(req: Request): Promise<Response> {
  // Initialize handler on first request
  if (!handler) {
    console.log(`📡 Initializing REST API server for Vercel...`)
    console.log(`   API Key: ${API_KEY.substring(0, 8)}...`)

    handler = await createServerlessHandler(API_KEY)
    
    console.log(`✅ Server initialized`)
  }

  // Use the handler
  return handler(req)
}
