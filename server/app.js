const express = require('express');
const { listEntries } = require('./repositories/leaderboard');

const app = express();
app.disable('x-powered-by');

app.get('/', (req, res) => {
  res.json({ message: 'Typing Performance Tracker API' });
});


// API of Leaderboard
app.get('/api/leaderboard', async (req, res) => {
  const entries = await listEntries();
  const leaderboard = entries
    .map((entry) => ({
      ...entry,
      wpm: Math.round(entry.grossWpm * entry.accuracy / 100 * 10) / 10,
    }))
    .sort((a, b) => b.wpm - a.wpm || b.accuracy - a.accuracy || a.id.localeCompare(b.id))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));

  res.set('Cache-Control', 'no-store');
  res.json({ data: leaderboard });
});

app.use((req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found.' } });
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unable to load the leaderboard.' } });
});

module.exports = app;
