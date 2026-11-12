import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSpotifySearchUrl,
  extractPlaylistSearchQuery,
  mergeUniqueTracks,
  normalizeSpotifyTrack,
  resolveCuratedFallbackTracks,
  searchLocalCuratedTracks
} from './spotifyCore';
import {
  decodeFirestorePairingDoc,
  encodeFirestorePairingFields,
  isValidPairingCode,
  PairingRecord
} from './pairingStore';

test('extractPlaylistSearchQuery transliterates KoЯn to Korn and strips playlist filler', () => {
  assert.equal(extractPlaylistSearchQuery('KoЯn'), 'Korn');
  assert.equal(extractPlaylistSearchQuery('MY top best KMFDM songs'), 'KMFDM');
  assert.equal(extractPlaylistSearchQuery('No Other Heart'), 'Mac DeMarco');
  assert.equal(extractPlaylistSearchQuery('mf doom'), 'MF DOOM');
});

test('buildSpotifySearchUrl enforces Spotify Feb 2026 max limit of 10', () => {
  const url25 = buildSpotifySearchUrl('Mac DeMarco', 0, 25);
  assert.match(url25, /limit=10/);
  assert.match(url25, /offset=0/);

  const url50 = buildSpotifySearchUrl('Korn', 10, 50);
  assert.match(url50, /limit=10/);
  assert.match(url50, /offset=10/);
});

test('normalizeSpotifyTrack parses Feb 2026 /items format and legacy /tracks format', () => {
  const itemFormat = {
    item: {
      id: 'trk_1',
      name: 'No Other Heart',
      type: 'track',
      duration_ms: 173000,
      artists: [{ name: 'Mac DeMarco' }],
      album: { name: 'Another One', images: [{ url: 'https://i.scdn.co/image/test.jpg' }] }
    }
  };
  const legacyFormat = {
    track: {
      id: 'trk_2',
      name: 'Freak on a Leash',
      duration_ms: 255000,
      artists: [{ name: 'Korn' }],
      album: { name: 'Follow the Leader' }
    }
  };
  const episodeEntry = {
    item: {
      id: 'ep_1',
      name: 'Podcast Episode',
      type: 'episode'
    }
  };

  const t1 = normalizeSpotifyTrack(itemFormat);
  assert.ok(t1);
  assert.equal(t1.title, 'No Other Heart');
  assert.equal(t1.artist, 'Mac DeMarco');
  assert.equal(t1.duration, 173);
  assert.equal(t1.art, 'https://i.scdn.co/image/test.jpg');

  const t2 = normalizeSpotifyTrack(legacyFormat);
  assert.ok(t2);
  assert.equal(t2.title, 'Freak on a Leash');
  assert.equal(t2.artist, 'Korn');
  assert.match(t2.preview_url, /^\/audio\/track\d\.mp3$/);

  assert.equal(normalizeSpotifyTrack(episodeEntry), null);
});

test('resolveCuratedFallbackTracks returns real Korn songs instead of Track 1 placeholders', () => {
  const kornTracks = resolveCuratedFallbackTracks('KoЯn');
  assert.ok(kornTracks.length >= 6);
  assert.equal(kornTracks[0].artist, 'Korn');
  assert.equal(kornTracks[0].title, 'Freak on a Leash');
  for (const tr of kornTracks) {
    assert.doesNotMatch(tr.title, /Track \d+$/);
  }
});

test('searchLocalCuratedTracks matches short queries like "mo" cleanly without empty errors', () => {
  const moResults = searchLocalCuratedTracks('mo');
  assert.ok(moResults.length >= 1);
  assert.ok(moResults.some((t) => t.title.toLowerCase().includes('moonlight') || t.artist.toLowerCase().includes('mo')));

  const kornResults = searchLocalCuratedTracks('KoЯn');
  assert.ok(kornResults.length >= 5);
});

test('mergeUniqueTracks deduplicates duplicate track entries', () => {
  const a = resolveCuratedFallbackTracks('mf doom').slice(0, 2);
  const merged = mergeUniqueTracks(a, a);
  assert.equal(merged.length, 2);
});

test('pairingStore validates codes and round-trips Firestore REST field encoding', () => {
  assert.equal(isValidPairingCode('XP79K2'), true);
  assert.equal(isValidPairingCode('bad'), false);
  assert.equal(isValidPairingCode('OO11II'), false);

  const sample: PairingRecord = {
    code: 'XP79K2',
    status: 'paired',
    accessToken: 'BQD_sample_token',
    username: 'muffin',
    expiresAt: 1800000000000,
    createdAt: '2026-11-12T00:00:00.000Z',
    updatedAt: '2026-11-12T00:01:00.000Z'
  };

  const fields = encodeFirestorePairingFields(sample);
  const decoded = decodeFirestorePairingDoc({ fields });
  assert.deepEqual(decoded, sample);
});
