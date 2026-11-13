import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  approvePairingRecord,
  createPairingRecord,
  getPairingRecord,
  isValidPairingCode
} from './src/server/pairingStore';
import {
  exchangeSpotifyAuthCode,
  executePlayerActionServer,
  fetchDevicesServer,
  fetchLikedTracksServer,
  fetchPlayerStateServer,
  fetchPlaylistTracksServer,
  fetchUserPlaylistsServer,
  getSpotifyAppToken,
  getSpotifyCredentials,
  resolveRealAudioServer,
  searchTracksServer
} from './src/server/spotifyApi';
import { linkSpotifyToken } from './src/db/userDb';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Global CORS Middleware for legacy browsers and external devices
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

// Explicit Static File Serving (Crucial for iOS Safari HTML5 audio & byte-ranges)
app.use(
  '/audio',
  express.static(path.resolve(__dirname, 'public/audio'), {
    acceptRanges: true,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.mp3')) {
        res.setHeader('Content-Type', 'audio/mpeg');
      }
    }
  })
);
app.use(express.static(path.resolve(__dirname, 'public')));

// -------------------------------------------------------------
// API: Pairing Lifecycle (Firestore-backed + Memory Cache)
// -------------------------------------------------------------
app.get('/api/pair/new', async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  const username = (req.query.username || '').toString().toLowerCase() || undefined;
  const record = await createPairingRecord(username);
  return res.json({ pairing_code: record.code, code: record.code, status: record.status });
});

app.get('/api/config', (_req: Request, res: Response) => {
  const { clientId, clientSecret } = getSpotifyCredentials();
  return res.json({
    clientId,
    hasSecret: Boolean(clientSecret)
  });
});

const handleStatusCheck = async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  const code = (req.params.code || '').toUpperCase();
  if (!isValidPairingCode(code)) {
    return res.status(400).json({ error: 'Invalid pairing code format', status: 'invalid' });
  }
  const record = await getPairingRecord(code);
  if (record.status === 'paired' && record.accessToken) {
    return res.json({
      status: 'paired',
      access_token: record.accessToken,
      refresh_token: record.refreshToken,
      username: record.username,
      code: record.code
    });
  }
  return res.json({ status: 'pending', code: record.code });
};

app.get('/api/pair/status/:code', handleStatusCheck);
app.get('/api/status/:code', handleStatusCheck);
app.get('/pair/status/:code', handleStatusCheck);

app.post('/api/pair/approve', async (req: Request, res: Response) => {
  const code = (req.body.code || '').toString().trim().toUpperCase();
  if (!isValidPairingCode(code)) {
    return res.status(400).json({ error: 'Pairing code must be 6 valid uppercase characters' });
  }

  let token = (req.body.token || req.body.access_token || '').toString().trim();
  const refreshToken = (req.body.refresh_token || '').toString().trim() || undefined;
  const username = (req.body.username || '').toString().trim().toLowerCase() || undefined;

  if (!token) {
    token = `BQD_xpotify_app_token_${code}_${Date.now()}`;
  }

  const result = await approvePairingRecord(code, token, username, refreshToken);
  if (!result.success || !result.record) {
    return res.status(400).json({ error: result.error || 'Failed to approve pairing' });
  }

  if (result.record.username) {
    try {
      linkSpotifyToken(result.record.username, token);
    } catch {
      // Optional local account sync
    }
  }

  return res.json({
    success: true,
    code: result.record.code,
    status: 'paired',
    access_token: result.record.accessToken,
    username: result.record.username
  });
});

app.post('/api/account/link-spotify', (req: Request, res: Response) => {
  const username = (req.body.username || '').toString().trim().toLowerCase();
  const spotifyToken = (req.body.spotify_token || '').toString().trim();
  const displayName = (req.body.display_name || '').toString().trim();
  if (!username || !spotifyToken) {
    return res.status(400).json({ error: 'Missing username or token' });
  }
  const result = linkSpotifyToken(username, spotifyToken, displayName || undefined);
  return res.json(result);
});

// -------------------------------------------------------------
// Spotify Web API Token & Proxy
// -------------------------------------------------------------
app.get('/api/spotify/config', (_req: Request, res: Response) => {
  const { clientId, clientSecret } = getSpotifyCredentials();
  const redirectUri = (process.env.SPOTIFY_REDIRECT_URI || '').trim();
  return res.json({
    client_id: clientId,
    redirect_uri: redirectUri,
    has_secret: Boolean(clientSecret)
  });
});

app.get('/api/spotify/token', (_req: Request, res: Response) => {
  const { clientId, clientSecret } = getSpotifyCredentials();
  return res.json({ clientId, hasSecret: Boolean(clientSecret) });
});

app.post('/api/spotify/token', async (req: Request, res: Response) => {
  const code = (req.body.code || '').toString().trim();
  const redirectUri = (req.body.redirect_uri || req.body.redirectUri || '').toString().trim();
  const codeVerifier = (req.body.code_verifier || req.body.codeVerifier || '').toString().trim() || undefined;
  const clientId = (req.body.client_id || req.body.clientId || '').toString().trim() || undefined;

  if (!code || !redirectUri) {
    return res.status(400).json({ error: 'Missing OAuth authorization code or redirect_uri' });
  }

  const result = await exchangeSpotifyAuthCode({ code, redirectUri, codeVerifier, clientId });
  if (result.error || !result.access_token) {
    return res.status(400).json({ error: result.error || 'Token exchange failed' });
  }
  return res.json(result);
});

app.get('/api/spotify/app-token', async (_req: Request, res: Response) => {
  const token = await getSpotifyAppToken();
  const { clientId } = getSpotifyCredentials();
  return res.json({ access_token: token, client_id: clientId, configured: Boolean(token) });
});

app.get('/api/audio/resolve', async (req: Request, res: Response) => {
  const title = (req.query.title || '').toString();
  const artist = (req.query.artist || '').toString();
  const resolved = await resolveRealAudioServer(title, artist);
  return res.json(resolved);
});

// -------------------------------------------------------------
// Playlists, Tracks & Search Endpoints
// -------------------------------------------------------------
app.get('/api/spotify/playlists', async (req: Request, res: Response) => {
  const userToken = (req.query.token || '').toString();
  const playlists = await fetchUserPlaylistsServer(userToken);
  return res.json({ playlists });
});

app.get('/api/spotify/playlist-tracks', async (req: Request, res: Response) => {
  const playlistId = (req.query.playlist_id || '').toString();
  const playlistName = (req.query.name || '').toString();
  const userToken = (req.query.token || '').toString();

  const data = await fetchPlaylistTracksServer({ playlistId, playlistName, userToken });
  return res.json({
    name: data.name,
    tracks: data.tracks,
    total: data.tracks.length,
    source: data.source
  });
});

app.get('/api/spotify/liked-tracks', async (req: Request, res: Response) => {
  const userToken = (req.query.token || '').toString();
  const tracks = await fetchLikedTracksServer(userToken);
  return res.json({ tracks, total: tracks.length });
});

app.get('/api/spotify/search', async (req: Request, res: Response) => {
  const query = (req.query.q || '').toString();
  const userToken = (req.query.token || '').toString();
  const result = await searchTracksServer(query, userToken);
  return res.json({ tracks: result.tracks, source: result.source });
});

// Spotify Connect Player Controls & Device Management
app.get('/api/spotify/devices', async (req: Request, res: Response) => {
  const userToken = (req.query.token || '').toString();
  if (!userToken) return res.status(401).json({ error: 'Missing token', devices: [] });
  const devices = await fetchDevicesServer(userToken);
  return res.json({ devices });
});

app.post('/api/spotify/player/:action', async (req: Request, res: Response) => {
  const action = req.params.action;
  const result = await executePlayerActionServer(action, {
    token: req.body.token,
    device_id: req.body.device_id,
    track_uri: req.body.track_uri
  });
  return res.status(result.status).json(result.payload);
});

app.get('/api/spotify/player', async (req: Request, res: Response) => {
  const userToken = (req.query.token || '').toString();
  if (!userToken) return res.status(401).json({ error: 'Missing token' });
  const result = await fetchPlayerStateServer(userToken);
  return res.status(result.status).json(result.payload);
});

// Direct 6-character code status check shortcut (strictly valid pairing chars only)
app.get('/:code([A-HJ-NP-Z2-9]{6})', handleStatusCheck);

// -------------------------------------------------------------
// Vite Server Integration (Middleware mode for development)
// -------------------------------------------------------------
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Xpotify iOS 7 Full-Stack Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
