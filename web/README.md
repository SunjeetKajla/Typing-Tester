This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

### Docker deployment

From this folder, build with `docker build -t typing-web .`. The standalone Next.js image listens on port 3000. Supply `SERVER_URL` (the backend address reachable from this container) and `WEB_URL` (the frontend's public HTTPS origin) at runtime. For example:

```sh
docker run -p 3000:3000 -e SERVER_URL=https://api.example.com -e WEB_URL=https://typing.example.com typing-web
```

Put your VPS HTTPS reverse proxy in front of port 3000. Use a private network or HTTPS for the backend connection; `localhost` inside the container refers to that container. The build needs internet access for dependencies and Google fonts. Environment files are excluded from the image.

### Leaderboard

Start the Express API in a second terminal with `cd ../server` and `npm run dev` (port 8000). Set `SERVER_URL=http://localhost:8000` in the web `.env` file; see `.env.example`. Then start this web app below and visit `/leaderboard`.

The browser calls the same-origin `/api/leaderboard` route, which proxies to Express using the server-only `SERVER_URL`. Set it to match your server's `PORT` (the current local setup uses 8000). The simple table handles loading, empty results, and retry after an API failure. Sample results come from Express; the typing test does not submit results yet. See `../server/README.md` for the API contract and MongoDB migration point.

### Typing graph

Google sign-in is available through the green account button. See [the authentication setup guide](../server/AUTH_SETUP.md) for Google Cloud, MongoDB, and session configuration.

The home page samples cumulative gross WPM and error rate about once per second, including while paused. A final sample is captured when the passage is complete. The SVG graph stays visible after completion and resets when a new passage is requested. Error rate measures incorrect characters in the current text, so correcting a mistake reduces it. The graph uses no charting library.

Run `node --test test/typing-stats.test.mjs` on Node 24 to check the rate calculations.

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
