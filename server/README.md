# Typing leaderboard API

For Google login and MongoDB configuration, see [AUTH_SETUP.md](./AUTH_SETUP.md).

Run `npm run dev` in this directory. The API uses `PORT` from `.env` (default 8000). Set the web app's `SERVER_URL` to the same address.

`GET /api/leaderboard` returns `{ data: [...] }`. Each sample result contains `id`, `name`, `username`, `grossWpm`, `accuracy`, `wpm`, and `rank`.

Adjusted WPM is gross WPM multiplied by accuracy / 100, rounded to one decimal. Results sort by adjusted WPM, then accuracy, then ID for stable ties. All sample results represent 60-second personal bests.

To add MongoDB later, replace `listEntries()` in `repositories/leaderboard.js` with a query returning the same fields. Ranking is in `app.js`. Results are read-only; test submission and persistence are not implemented yet.

Run `npm test` to check the API.

## Docker

From this folder, build with `docker build -t typing-server .`. The image listens on port 8000 and uses production dependencies. Supply the variables from `.env.example` at runtime using your deployment platform or `docker run --env-file .env -p 8000:8000 typing-server`.

Set `WEB_URL` to your frontend's public HTTPS origin and `GOOGLE_REDIRECT_URI` to that origin followed by `/api/auth/google/callback`. Configure the Google callback and Atlas access as described in `AUTH_SETUP.md`. Environment files are excluded from the image.
