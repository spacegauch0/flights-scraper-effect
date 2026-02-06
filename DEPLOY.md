# 🚀 Vercel Deployment Guide

This guide will help you deploy the Flight Scraper API to Vercel.

## Prerequisites

1. **Vercel Account**: Sign up at [vercel.com](https://vercel.com)
2. **Vercel CLI** (optional): `npm i -g vercel`
3. **Git Repository**: Your code should be in a Git repository (GitHub, GitLab, or Bitbucket)

## Quick Deploy

### Option 1: Deploy via Vercel Dashboard

1. **Import Project:**
   - Go to [vercel.com/new](https://vercel.com/new)
   - Import your Git repository
   - Vercel will auto-detect the configuration

2. **Set Environment Variables:**
   - Go to Project Settings → Environment Variables
   - Add `API_KEY` with your secret API key
   - Add to Production, Preview, and Development environments

3. **Deploy:**
   - Click "Deploy"
   - Wait for deployment to complete

### Option 2: Deploy via CLI

```bash
# Install Vercel CLI (if not installed)
npm i -g vercel

# Login to Vercel
vercel login

# Deploy
vercel

# Set environment variable
vercel env add API_KEY

# Deploy to production
vercel --prod
```

## Configuration

### vercel.json

The project includes a `vercel.json` configuration file:

```json
{
  "version": 2,
  "rewrites": [
    {
      "source": "/(.*)",
      "destination": "/api"
    }
  ],
  "functions": {
    "api/index.ts": {
      "runtime": "nodejs20.x",
      "maxDuration": 60
    }
  }
}
```

**Key Settings:**
- **Runtime**: Node.js 20.x
- **Max Duration**: 60 seconds (for flight scraping operations)
- **Rewrites**: All routes (`/*`) are handled by `/api/index.ts`

### Environment Variables

Required environment variable:
- `API_KEY` - Your secret API key for authentication

Set in Vercel Dashboard → Project Settings → Environment Variables

## Serverless Function

The serverless function is located at `api/index.ts`:

- Uses Hono framework (compatible with Vercel)
- Initializes services on first request
- Reuses handler for subsequent requests (within same instance)
- Maintains in-memory cache per instance

## Caching Behavior

**Important**: The in-memory cache is per-instance in Vercel:

- ✅ **Within same instance**: Cache is shared across requests
- ⚠️ **Across instances**: Each instance has its own cache
- 💡 **Recommendation**: For distributed caching, use Vercel KV or Redis

The cache includes:
- 30-minute TTL
- 500 entry capacity
- HTTP cache headers for CDN caching

## Testing Deployment

After deployment, test your API:

```bash
# Replace with your Vercel URL
curl https://your-app.vercel.app/health \
  -H "x-api-key: your-api-key"

curl "https://your-app.vercel.app/api/flights?from=JFK&to=LHR&departDate=2026-01-19&limit=10" \
  -H "x-api-key: your-api-key"
```

## Monitoring

- **Logs**: View in Vercel Dashboard → Functions → Logs
- **Metrics**: Monitor in Vercel Dashboard → Analytics
- **Errors**: Check Vercel Dashboard → Functions → Errors

## Troubleshooting

### Function Timeout

If requests timeout:
- Increase `maxDuration` in `vercel.json` (max 60s for Hobby, 300s for Pro)
- Optimize scraper queries
- Use caching to reduce scrape frequency

### Cache Not Working

- Cache is per-instance (not shared across instances)
- Consider Vercel KV for distributed caching
- Check cache headers in response

### Environment Variables

- Ensure `API_KEY` is set in all environments
- Redeploy after adding environment variables
- Check variable names match exactly

## Production Checklist

- [ ] Set `API_KEY` environment variable
- [ ] Test all endpoints
- [ ] Verify cache headers
- [ ] Monitor function logs
- [ ] Set up error alerts (optional)
- [ ] Configure custom domain (optional)

## Cost Considerations

- **Hobby Plan**: 100GB-hours/month included
- **Pro Plan**: 1000GB-hours/month included
- Cache reduces function invocations
- Consider Vercel KV for distributed caching at scale
