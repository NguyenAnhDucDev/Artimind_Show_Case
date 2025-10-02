// Simple Node.js server with proxy to bypass CORS for the frontend
// Requires Node 18+ (built-in fetch). If on Node <18, install node-fetch and import it.

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
let PORT = Number(process.env.PORT || 8099);

// Basic CORS for local dev
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Serve static files (index.html, main.js, styles.css)
app.use(express.static(__dirname, { extensions: ['html'] }));

// Proxy endpoint: /proxy?url=https://...
app.get('/proxy', async (req, res) => {
  try {
    const target = (req.query.url || '').toString();
    if (!target) {
      res.status(400).json({ error: 'Missing url param' });
      return;
    }
    try {
      const u = new URL(target);
      if (!(u.protocol === 'http:' || u.protocol === 'https:')) {
        res.status(400).json({ error: 'Only http/https are allowed' });
        return;
      }
    } catch {
      res.status(400).json({ error: 'Invalid URL' });
      return;
    }

    const upstream = await fetch(target, {
      redirect: 'follow',
      // Avoid sending cookies
      credentials: 'omit',
      // Set a basic UA
      headers: { 'user-agent': 'artimind-proxy/1.0' }
    });

    // Pass through status and content-type
    res.status(upstream.status);
    const ct = upstream.headers.get('content-type');
    if (ct) res.setHeader('content-type', ct);
    const cd = upstream.headers.get('content-disposition');
    if (cd) res.setHeader('content-disposition', cd);
    const cache = upstream.headers.get('cache-control');
    if (cache) res.setHeader('cache-control', cache);

    // Stream body
    if (upstream.body) {
      upstream.body.pipeTo(new WritableStream({
        write(chunk) {
          res.write(chunk);
        },
        close() {
          res.end();
        },
        abort(err) {
          res.end();
        }
      }));
    } else {
      res.end();
    }
  } catch (err) {
    res.status(500).json({ error: 'Proxy error', detail: String(err) });
  }
});

function startServer(port) {
  const server = app
    .listen(port, () => {
      console.log(`Server listening on http://localhost:${port}`);
    })
    .on('error', (err) => {
      if (err && (err.code === 'EADDRINUSE' || err.code === 'EACCES')) {
        const next = port + 1;
        console.warn(`Port ${port} in use, trying ${next}...`);
        startServer(next);
      } else {
        console.error('Server failed to start:', err);
        process.exit(1);
      }
    });
  return server;
}

startServer(PORT);
