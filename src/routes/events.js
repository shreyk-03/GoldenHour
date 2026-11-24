/**
 * CHANGE STREAM (Server-Sent Events)
 *
 * Vercel runs each request in an isolated function, so an in-process WebSocket
 * broadcast never reaches other instances. Instead the store keeps a version
 * counter per collection (incremented by every write), and this endpoint polls
 * those counters and streams them to the browser. Clients then refetch only the
 * collections whose version moved.
 *
 * Only opaque version numbers leave the server here — no patient data — so the
 * stream can stay unauthenticated (EventSource cannot send an Authorization
 * header anyway). Data stays behind the authenticated JSON routes.
 */

const express = require('express');
const { getCollectionVersions } = require('../db/store');

const router = express.Router();

const WATCHED_COLLECTIONS = ['patients', 'dispatches', 'hospitals'];
const POLL_INTERVAL_MS = 2500;
// Function invocations are capped in production; close well before any limit and
// let the browser's EventSource reconnect on its own.
const STREAM_LIFETIME_MS = 25_000;

router.get('/', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  let closed = false;
  let lastPayload = '';
  let ticker;
  let lifetime;

  const send = (event, data) => {
    if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const finish = () => {
    if (closed) return;
    closed = true;
    clearInterval(ticker);
    clearTimeout(lifetime);
    res.end();
  };

  const poll = async () => {
    try {
      const versions = await getCollectionVersions(WATCHED_COLLECTIONS);
      const payload = JSON.stringify(versions);
      if (payload !== lastPayload) {
        lastPayload = payload;
        send('change', versions);
      } else if (!closed) {
        res.write(': keep-alive\n\n');
      }
    } catch (err) {
      console.error('[Events] Revision poll failed:', err.message);
      send('error', { message: 'Revision poll failed' });
    }
  };

  res.write('retry: 3000\n\n');
  poll();

  ticker = setInterval(poll, POLL_INTERVAL_MS);
  lifetime = setTimeout(finish, STREAM_LIFETIME_MS);

  req.on('close', finish);
});

module.exports = router;
