import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generatePairingCode,
  parsePairingResponse,
  parseStatusResponse,
  formatTime,
  formatSongDurationMs,
  buildPairingUrl,
  extractAccessTokenFromHash,
  formatSpotifyTrackUri,
  isPreviewSnippet,
  selectAudioSource,
  isSpotifyConnectActive,
  getAppBasePath,
  resolveAppAssetPath,
  isSpotifyOAuthCode
} from './pairingLogic';

test('generatePairingCode generates 6 uppercase characters without ambiguous characters', () => {
  const code = generatePairingCode();
  assert.equal(code.length, 6);
  assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
});

test('parsePairingResponse handles object with pairing_code', () => {
  const result = parsePairingResponse({ pairing_code: 'abc123' });
  assert.equal(result.code, 'ABC123');
  assert.equal(result.error, undefined);
});

test('parsePairingResponse handles raw JSON string', () => {
  const result = parsePairingResponse('{"pairing_code": "k9x42b"}');
  assert.equal(result.code, 'K9X42B');
});

test('parsePairingResponse handles raw text code', () => {
  const result = parsePairingResponse('W7Y29Q');
  assert.equal(result.code, 'W7Y29Q');
});

test('parseStatusResponse identifies paired status and extracts token', () => {
  const result = parseStatusResponse({ status: 'paired', access_token: 'BQDxyz123' });
  assert.equal(result.isPaired, true);
  assert.equal(result.accessToken, 'BQDxyz123');
});

test('parseStatusResponse handles pending status', () => {
  const result = parseStatusResponse({ status: 'pending' });
  assert.equal(result.isPaired, false);
});

test('formatTime formats seconds into mm:ss', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(65), '1:05');
  assert.equal(formatTime(215), '3:35');
});

test('formatSongDurationMs formats milliseconds', () => {
  assert.equal(formatSongDurationMs(215000), '3:35');
  assert.equal(formatSongDurationMs(0), '0:00');
});

test('buildPairingUrl appends ngrok skip param when ngrok in url', () => {
  assert.equal(
    buildPairingUrl('https://ngrok-free.dev', 'XP79K2'),
    'https://ngrok-free.dev/XP79K2?ngrok-skip-browser-warning=69420'
  );
});

test('extractAccessTokenFromHash extracts token from URL hash', () => {
  const hash = '#access_token=BQD_test_token_123&token_type=Bearer&expires_in=3600';
  assert.equal(extractAccessTokenFromHash(hash), 'BQD_test_token_123');
  assert.equal(extractAccessTokenFromHash(''), null);
  assert.equal(extractAccessTokenFromHash('#error=access_denied'), null);
});

test('formatSpotifyTrackUri formats track IDs to URI', () => {
  assert.equal(formatSpotifyTrackUri('4rGPj452601LzC3N7N2902'), 'spotify:track:4rGPj452601LzC3N7N2902');
  assert.equal(formatSpotifyTrackUri('spotify:track:4rGPj452601LzC3N7N2902'), 'spotify:track:4rGPj452601LzC3N7N2902');
});

test('isPreviewSnippet flags 30-second preview clips to avoid truncation', () => {
  assert.equal(isPreviewSnippet('https://audio-ssl.itunes.apple.com/preview.m4a'), true);
  assert.equal(isPreviewSnippet('https://cdns-preview-d.deezer.com/stream.mp3'), true);
  assert.equal(isPreviewSnippet('/audio/track1.mp3'), false);
});

test('selectAudioSource selects full-length audio tracks instead of 30-sec snippets', () => {
  const trackWith30sSnippet = { id: 't1', preview_url: 'https://audio-ssl.itunes.apple.com/preview.m4a' };
  const source = selectAudioSource(trackWith30sSnippet, 0);
  assert.match(source, /^\/audio\/track\d\.mp3$/);
});

test('isSpotifyConnectActive checks device ID validity', () => {
  assert.equal(isSpotifyConnectActive('dev_12345'), true);
  assert.equal(isSpotifyConnectActive(''), false);
  assert.equal(isSpotifyConnectActive(null), false);
});

test('getAppBasePath and resolveAppAssetPath handle root and GitHub Pages subpaths', () => {
  assert.equal(getAppBasePath('/'), '/');
  assert.equal(getAppBasePath('/callback'), '/');
  assert.equal(getAppBasePath('/pair'), '/');
  assert.equal(getAppBasePath('/spotify-on-ios-7-/'), '/spotify-on-ios-7-/');
  assert.equal(getAppBasePath('/spotify-on-ios-7-/index.html'), '/spotify-on-ios-7-/');
  assert.equal(getAppBasePath('/spotify-on-ios-7-/callback'), '/spotify-on-ios-7-/');

  assert.equal(
    resolveAppAssetPath('https://muffinmilk.github.io', '/spotify-on-ios-7-/', '/assets/covers/cover_doom_vinyl.jpg'),
    'https://muffinmilk.github.io/spotify-on-ios-7-/assets/covers/cover_doom_vinyl.jpg'
  );
  assert.equal(
    resolveAppAssetPath('https://spotify-on-ios-7.vercel.app', '/callback', '/audio/track1.mp3'),
    'https://spotify-on-ios-7.vercel.app/audio/track1.mp3'
  );
  assert.equal(
    resolveAppAssetPath('https://spotify-on-ios-7.vercel.app', '/', 'https://i.scdn.co/image/abc'),
    'https://i.scdn.co/image/abc'
  );
});

test('isSpotifyOAuthCode distinguishes long OAuth codes from 6-char pairing codes', () => {
  assert.equal(isSpotifyOAuthCode('AQBKPdClw-wbWU51unzTzy2c2i0UmNJMZ', '/spotify-on-ios-7-/'), true);
  assert.equal(isSpotifyOAuthCode('AQBKPdClw-wbWU51unzTzy2c2i0UmNJMZ', '/'), true);
  assert.equal(isSpotifyOAuthCode('QP2VUT', '/pair'), false);
  assert.equal(isSpotifyOAuthCode('AQBKPdClw-wbWU51unzTzy2c2i0UmNJMZ', '/pair'), false);
});
