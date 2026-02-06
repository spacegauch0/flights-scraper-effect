/**
 * API Server entry point
 */

import { startServer } from "./server-hono"

// Load environment variables
const API_KEY = process.env.API_KEY
const PORT = parseInt(process.env.PORT || "3000", 10)

if (!API_KEY) {
  console.error("❌ Error: API_KEY environment variable is required")
  console.error("   Please create a .env file with: API_KEY=your-secret-key")
  process.exit(1)
}

console.log(`📡 Starting REST API server...`)
console.log(`   Port: ${PORT}`)
console.log(`   API Key: ${API_KEY.substring(0, 8)}...`)

startServer(PORT, API_KEY)
  .then((server) => {
    console.log(`✅ Server running on http://localhost:${server.port}`)
  })
  .catch((error) => {
    console.error("❌ Failed to start server:", error)
    process.exit(1)
  })
