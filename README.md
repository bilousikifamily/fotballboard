<<<<<<< HEAD
# fotballboard
=======
# Telegram Bot + WebApp Starter (Cloudflare)

## Structure
```
tg-webapp-starter/
  api/    # Cloudflare Worker
  web/    # Vite WebApp
```

## Requirements
- Node.js 18+
- Cloudflare account + Wrangler

## Env / secrets
- `BOT_TOKEN` (Worker secret)
- `WEBAPP_URL` (Worker var: Cloudflare Pages URL)
- `VITE_API_BASE` (Web env: Worker URL)

## 1) Create a bot (BotFather)
1. Open BotFather in Telegram.
2. Run `/newbot` and follow steps.
3. Copy the bot token.

## 2) Deploy the Worker (api)
```
cd api
npm install

# set secret
npx wrangler secret put BOT_TOKEN

# set WebApp URL (Cloudflare Pages URL)
# update wrangler.toml or pass as --var
npx wrangler deploy --var WEBAPP_URL=https://your-pages-domain.pages.dev
```

## 3) Deploy the WebApp (web)
```
cd web
npm install

# build
npm run build
```

Deploy `web/dist` to Cloudflare Pages.
You can use the Pages dashboard or CLI:
```
# optional
npx wrangler pages deploy dist --project-name tg-webapp-web
```

Set `VITE_API_BASE` to your Worker URL in the Pages environment variables.

## 4) Set Telegram webhook
```
https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=<YOUR_WORKER_URL>/tg/webhook
```

## 5) Local development (optional)
```
# terminal 1
cd api
npm run dev -- --var WEBAPP_URL=http://localhost:5173

# terminal 2
cd web
VITE_API_BASE=http://localhost:8787 npm run dev
```

For real Telegram WebApp testing, you need a public URL (Cloudflare Tunnel or ngrok) for both the Worker and WebApp.

## Endpoints
- `GET /healthcheck` -> `{ ok: true }`
- `POST /api/auth` -> validates Telegram `initData`
- `POST /tg/webhook` -> Telegram updates

## Notes
- The WebApp never sees the bot token.
- `/api/auth` validates `initData` using Telegram HMAC algorithm.
>>>>>>> c3e1199 (initial project setup)
