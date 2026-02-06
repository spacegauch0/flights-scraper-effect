# Flight Scraper REST API

REST API endpoints for searching flights using the Google Flights scraper.

## Authentication

All endpoints require an `x-api-key` header that matches the `API_KEY` environment variable.

```bash
curl -H "x-api-key: your-api-key" http://localhost:3000/api/flights
```

## Endpoints

### GET /health

Health check endpoint.

**Request:**
```bash
curl -H "x-api-key: your-api-key" http://localhost:3000/health
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-02-06T00:00:00.000Z"
}
```

### GET /api/flights

Search for flights using query parameters.

**Query Parameters:**
- `from` (required): Origin airport code (3-letter IATA code, e.g., `JFK`)
- `to` (required): Destination airport code (3-letter IATA code, e.g., `LHR`)
- `departDate` (required): Departure date in `YYYY-MM-DD` format
- `tripType` (optional): `one-way`, `round-trip`, or `multi-city` (default: `one-way`)
- `returnDate` (optional): Return date in `YYYY-MM-DD` format (required for round-trip)
- `sort` (optional): Sort option - `price-asc`, `price-desc`, `duration-asc`, `duration-desc`, `airline`, `none` (default: `price-asc`)
- `seat` (optional): Seat class - `economy`, `premium-economy`, `business`, `first` (default: `economy`)
- `currency` (optional): Currency code (e.g., `USD`, `EUR`)
- `adults` (optional): Number of adults (default: `1`)
- `children` (optional): Number of children (default: `0`)
- `infantsInSeat` (optional): Number of infants with seat (default: `0`)
- `infantsOnLap` (optional): Number of infants on lap (default: `0`)
- `maxPrice` (optional): Maximum price filter
- `minPrice` (optional): Minimum price filter
- `maxDurationMinutes` (optional): Maximum duration in minutes
- `airlines` (optional): Comma-separated list of airline names
- `nonstopOnly` (optional): `true` or `false` - only nonstop flights
- `maxStops` (optional): Maximum number of stops (0, 1, or 2)
- `limit` (optional): Maximum number of results to return (default: `10`)

**Example Request:**
```bash
curl -H "x-api-key: your-api-key" \
  "http://localhost:3000/api/flights?from=JFK&to=LHR&departDate=2026-01-19&sort=price-asc&limit=10"
```

**Example Response:**
```json
{
  "success": true,
  "data": {
    "current_price": "low",
    "flights": [
      {
        "is_best": true,
        "name": "British Airways",
        "departure": "8:00 AM",
        "arrival": "8:00 PM",
        "arrival_time_ahead": "+1 day",
        "duration": "7 hr 0 min",
        "stops": 0,
        "price": "$599"
      }
    ]
  }
}
```

### POST /api/flights

Search for flights using JSON body.

**Request Body:**
```json
{
  "from": "JFK",
  "to": "LHR",
  "departDate": "2026-01-19",
  "tripType": "one-way",
  "sort": "price-asc",
  "seat": "economy",
  "adults": 1,
  "children": 0,
  "infantsInSeat": 0,
  "infantsOnLap": 0,
  "limit": 10,
  "maxPrice": 1000,
  "maxStops": 1
}
```

**Example Request:**
```bash
curl -X POST \
  -H "x-api-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "JFK",
    "to": "LHR",
    "departDate": "2026-01-19",
    "sort": "price-asc",
    "limit": 10
  }' \
  http://localhost:3000/api/flights
```

**Response:** Same as GET endpoint.

## Error Responses

All errors follow this format:

```json
{
  "error": {
    "reason": "Unauthorized|BadRequest|NotFound|InternalError|InvalidInput|RateLimitExceeded|Timeout|ParsingError|NavigationFailed",
    "message": "Error description"
  }
}
```

**HTTP Status Codes:**
- `200` - Success
- `400` - Bad Request (invalid parameters)
- `401` - Unauthorized (missing or invalid API key)
- `404` - Not Found
- `429` - Rate Limit Exceeded
- `500` - Internal Server Error
- `504` - Gateway Timeout

## Examples

### Round-trip flight search
```bash
curl -H "x-api-key: your-api-key" \
  "http://localhost:3000/api/flights?from=LAX&to=NRT&departDate=2026-01-19&returnDate=2026-01-26&tripType=round-trip&seat=business&adults=2"
```

### Filtered search with multiple passengers
```bash
curl -X POST \
  -H "x-api-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "ORD",
    "to": "CDG",
    "departDate": "2026-01-19",
    "adults": 2,
    "children": 1,
    "maxPrice": 800,
    "maxStops": 1,
    "airlines": ["United", "American"],
    "limit": 20
  }' \
  http://localhost:3000/api/flights
```
