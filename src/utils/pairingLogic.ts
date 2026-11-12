/**
 * Core utility and state logic for Xpotify iOS 7 Web App.
 * Decoupled for deterministic unit testing.
 */

export interface StatusResponse {
  status?: string;
  access_token?: string;
  token?: string;
  pairing_code?: string;
  error?: string;
}

export function generatePairingCode(): string {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No ambiguous 0/O, 1/I
  var result = '';
  for (var i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function parsePairingResponse(data: any): { code: string; error?: string } {
  if (!data) return { code: '', error: 'Empty response' };
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch (e) {
      // If it's a raw 6-character text code
      var trimmed = data.trim();
      if (trimmed.length === 6) return { code: trimmed.toUpperCase() };
      return { code: '', error: 'Invalid response format' };
    }
  }
  var code = data.pairing_code || data.code || data.pair_code || '';
  if (code && typeof code === 'string') {
    return { code: code.trim().toUpperCase() };
  }
  return { code: '', error: 'No code in response' };
}

export function parseStatusResponse(data: any): { isPaired: boolean; accessToken?: string; error?: string } {
  if (!data) return { isPaired: false, error: 'Empty response' };
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch (e) {
      return { isPaired: false, error: 'Invalid JSON' };
    }
  }
  var status = (data.status || '').toLowerCase();
  var token = data.access_token || data.token || data.accessToken || '';

  if (status === 'paired' || token.length > 0) {
    return {
      isPaired: true,
      accessToken: token || 'demo_token_' + Date.now()
    };
  }
  return {
    isPaired: false,
    error: data.message || 'Waiting for pairing confirmation'
  };
}

export function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  var mins = Math.floor(seconds / 60);
  var secs = Math.floor(seconds % 60);
  return mins + ':' + (secs < 10 ? '0' : '') + secs;
}

export function formatSongDurationMs(ms: number): string {
  if (!ms || isNaN(ms)) return '0:00';
  return formatTime(Math.floor(ms / 1000));
}

export function buildPairingUrl(base: string, code: string): string {
  var cleanBase = base.replace(/\/+$/, '');
  var url = cleanBase + '/' + encodeURIComponent(code);
  // Append query parameter rather than header to avoid CORS preflight options
  if (url.indexOf('ngrok') !== -1) {
    url += (url.indexOf('?') === -1 ? '?' : '&') + 'ngrok-skip-browser-warning=69420';
  }
  return url;
}

export function extractAccessTokenFromHash(hash: string): string | null {
  if (!hash || typeof hash !== 'string') return null;
  var match = hash.match(/access_token=([^&]*)/);
  if (match && match[1]) {
    return decodeURIComponent(match[1]);
  }
  return null;
}

export function formatSpotifyTrackUri(idOrUri: string): string {
  if (!idOrUri) return '';
  var clean = idOrUri.trim();
  if (clean.indexOf('spotify:track:') === 0) return clean;
  if (clean.indexOf('spotify:') === 0) return clean;
  return 'spotify:track:' + clean;
}

export function isPreviewSnippet(url?: string): boolean {
  if (!url) return false;
  var lower = url.toLowerCase();
  return lower.indexOf('apple.com') !== -1 ||
         lower.indexOf('itunes') !== -1 ||
         lower.indexOf('deezer.com') !== -1 ||
         lower.indexOf('preview') !== -1;
}

export function selectAudioSource(track: any, index: number): string {
  // If track has a local full-length audio url, use it
  if (track && track.preview_url && !isPreviewSnippet(track.preview_url)) {
    return track.preview_url;
  }
  // Fall back to full-length bundled MP3 (3-5 minutes)
  var localTracks = [
    '/audio/track1.mp3',
    '/audio/track2.mp3',
    '/audio/track3.mp3',
    '/audio/track4.mp3',
    '/audio/track5.mp3',
    '/audio/track6.mp3'
  ];
  var idx = typeof index === 'number' ? index : 0;
  if (track && track.id) {
    var sum = 0;
    for (var i = 0; i < track.id.length; i++) {
      sum += track.id.charCodeAt(i);
    }
    idx = sum;
  }
  return localTracks[Math.abs(idx) % localTracks.length];
}

export function isSpotifyConnectActive(deviceId?: string | null): boolean {
  return typeof deviceId === 'string' && deviceId.trim().length > 0;
}

export function getAppBasePath(pathname: string): string {
  var p = (pathname || '/').split('?')[0].split('#')[0];
  p = p.replace(/\/(index\.html|pair|callback)\/?$/i, '');
  if (!p || p === '/') return '/';
  if (p.charAt(0) !== '/') p = '/' + p;
  if (p.charAt(p.length - 1) !== '/') p += '/';
  return p;
}

export function resolveAppAssetPath(origin: string, pathname: string, assetUrl: string): string {
  if (!assetUrl) return '';
  if (
    assetUrl.indexOf('http://') === 0 ||
    assetUrl.indexOf('https://') === 0 ||
    assetUrl.indexOf('blob:') === 0 ||
    assetUrl.indexOf('data:') === 0
  ) {
    return assetUrl;
  }
  var cleanOrigin = (origin || '').replace(/\/+$/, '');
  var cleanAsset = assetUrl.replace(/^\/+/, '');
  return cleanOrigin + getAppBasePath(pathname) + cleanAsset;
}

export function isSpotifyOAuthCode(code: string, pathname?: string): boolean {
  if (!code || typeof code !== 'string') return false;
  var trimmed = code.trim();
  if (trimmed.length <= 20) return false;
  var cleanPath = (pathname || '/').split('?')[0].toLowerCase();
  if (/\/pair\/?$/.test(cleanPath)) return false;
  return true;
}
