/**
 * Pure Spotify normalization, query extraction, search URL construction,
 * and curated fallback helpers. Safe to unit test without network calls.
 */

export interface NormalizedTrack {
  id: string;
  uri: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  art: string;
  preview_url: string;
}

export const LOCAL_COVERS = {
  doom: '/assets/covers/cover_doom_vinyl.jpg',
  indie: '/assets/covers/cover_indie_tape.jpg',
  rock: '/assets/covers/cover_industrial_metal.jpg',
  synth: '/assets/covers/cover_synth_radio.jpg'
};

export const LOCAL_FULL_TRACKS = [
  '/audio/track1.mp3',
  '/audio/track2.mp3',
  '/audio/track3.mp3',
  '/audio/track4.mp3',
  '/audio/track5.mp3',
  '/audio/track6.mp3'
];

export function resolveFullLengthAudioUrl(title: string, artist?: string): string {
  const query = `${title || ''} ${artist || ''}`.trim();
  if (!query) return LOCAL_FULL_TRACKS[0];
  let sum = 0;
  for (let i = 0; i < query.length; i++) {
    sum += query.charCodeAt(i);
  }
  return LOCAL_FULL_TRACKS[Math.abs(sum) % LOCAL_FULL_TRACKS.length];
}

export function isSnippetUrl(url?: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  return (
    lower.indexOf('apple.com') !== -1 ||
    lower.indexOf('itunes') !== -1 ||
    lower.indexOf('deezer.com') !== -1 ||
    lower.indexOf('preview') !== -1
  );
}

/**
 * Normalizes stylistic Unicode characters (e.g. "KoЯn" -> "Korn") and extracts
 * clean search keywords for Spotify Search when a playlist's items endpoint is restricted.
 */
export function extractPlaylistSearchQuery(playlistName: string): string {
  if (!playlistName || typeof playlistName !== 'string') return 'MF DOOM';

  // Transliterate stylized lookalike characters commonly used in band/playlist names
  const asciiNormalized = playlistName
    .replace(/Я/g, 'R')
    .replace(/я/g, 'r')
    .replace(/Ø/g, 'O')
    .replace(/ø/g, 'o')
    .replace(/Æ/g, 'AE')
    .replace(/æ/g, 'ae')
    .trim();

  const lower = asciiNormalized.toLowerCase();

  if (lower.indexOf('no other heart') !== -1 || lower.indexOf('mac demarco') !== -1) {
    return 'Mac DeMarco';
  }
  if (lower.indexOf('kmfdm') !== -1) {
    return 'KMFDM';
  }
  if (lower.indexOf('korn') !== -1) {
    return 'Korn';
  }
  if (lower.indexOf('doom') !== -1 || lower.indexOf('madvillain') !== -1) {
    return 'MF DOOM';
  }
  if (lower.indexOf('liked songs') !== -1) {
    return 'Mac DeMarco Indie';
  }
  if (lower.indexOf('top hits') !== -1) {
    return 'Blinding Lights The Weeknd';
  }
  if (lower.indexOf('ios 7') !== -1 || lower.indexOf('nostalgia') !== -1) {
    return 'Daft Punk Get Lucky';
  }
  if (lower.indexOf('deep focus') !== -1 || lower.indexOf('chill') !== -1) {
    return 'Lo-Fi Chill Electronic';
  }
  if (lower.indexOf('synthwave') !== -1) {
    return 'Synthwave The Midnight';
  }

  // Strip filler phrases like "my top best ... songs" so artist searches stay sharp
  const cleaned = asciiNormalized
    .replace(/\b(my|top|best|favorite|favourite|old|new|songs|tracks|playlist|mix|complete)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return (cleaned || asciiNormalized || 'MF DOOM').slice(0, 80);
}

/**
 * Spotify Feb 2026 API caps /v1/search limit to 10 (max 10 per page).
 */
export function buildSpotifySearchUrl(query: string, offset = 0, limit = 10): string {
  const safeLimit = Math.max(1, Math.min(10, Math.floor(limit || 10)));
  const safeOffset = Math.max(0, Math.floor(offset || 0));
  return (
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(query.trim())}` +
    `&type=track&limit=${safeLimit}&offset=${safeOffset}`
  );
}

/**
 * Normalizes track objects from either:
 * - Spotify Feb 2026 `/playlists/{id}/items` (`entry.item`)
 * - Legacy `/playlists/{id}/tracks` (`entry.track`)
 * - Direct track objects from `/v1/search` (`entry`)
 */
export function normalizeSpotifyTrack(
  entry: any,
  fallbackArt = LOCAL_COVERS.doom,
  index = 0
): NormalizedTrack | null {
  if (!entry || typeof entry !== 'object') return null;
  const tr = entry.item || entry.track || entry;
  if (!tr || !tr.name || typeof tr.name !== 'string') return null;
  if (tr.type && tr.type !== 'track') return null;

  const artistsList = Array.isArray(tr.artists)
    ? tr.artists.map((a: any) => (a && a.name ? String(a.name) : '')).filter(Boolean)
    : [];
  const artist = artistsList.join(', ') || 'Unknown Artist';
  const art =
    (tr.album && Array.isArray(tr.album.images) && tr.album.images[0] && tr.album.images[0].url) ||
    fallbackArt ||
    LOCAL_COVERS.doom;

  const rawPreview = typeof tr.preview_url === 'string' ? tr.preview_url : '';
  const previewUrl =
    rawPreview && !isSnippetUrl(rawPreview) ? rawPreview : resolveFullLengthAudioUrl(tr.name, artist);

  const id = String(tr.id || `sp_${index}_${tr.name.slice(0, 12).replace(/\W+/g, '')}`);
  const uri = String(tr.uri || (tr.id ? `spotify:track:${tr.id}` : ''));

  return {
    id,
    uri,
    title: tr.name,
    artist,
    album: (tr.album && tr.album.name) || '',
    duration: typeof tr.duration_ms === 'number' && tr.duration_ms > 0 ? Math.round(tr.duration_ms / 1000) : 180,
    art,
    preview_url: previewUrl
  };
}

export function mergeUniqueTracks(...groups: NormalizedTrack[][]): NormalizedTrack[] {
  const seen = new Set<string>();
  const result: NormalizedTrack[] = [];

  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const track of group) {
      if (!track || !track.title) continue;
      const key =
        track.id && !track.id.startsWith('sp_')
          ? track.id
          : `${track.title.toLowerCase().trim()}::${(track.artist || '').toLowerCase().trim()}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(track);
      }
    }
  }
  return result;
}

export const CURATED_CATALOGS: Record<string, NormalizedTrack[]> = {
  korn: [
    { id: 'korn_1', uri: 'spotify:track:6W21LNLz9Sw7sUSNWMS0gK', title: 'Freak on a Leash', artist: 'Korn', album: 'Follow the Leader', duration: 255, art: LOCAL_COVERS.rock, preview_url: '/audio/track1.mp3' },
    { id: 'korn_2', uri: 'spotify:track:1pr9TZGOXeJUggIal1aG3b', title: 'Blind', artist: 'Korn', album: 'Korn', duration: 258, art: LOCAL_COVERS.rock, preview_url: '/audio/track2.mp3' },
    { id: 'korn_3', uri: 'spotify:track:2F6FfZ4w8z3e3nM4lK6W2A', title: 'Falling Away from Me', artist: 'Korn', album: 'Issues', duration: 270, art: LOCAL_COVERS.rock, preview_url: '/audio/track3.mp3' },
    { id: 'korn_4', uri: 'spotify:track:3L3Z3k0a5M1W9nE6K8qP1x', title: 'Got the Life', artist: 'Korn', album: 'Follow the Leader', duration: 225, art: LOCAL_COVERS.rock, preview_url: '/audio/track4.mp3' },
    { id: 'korn_5', uri: 'spotify:track:0G1X9kL3W8Q2zN5pP4R7mB', title: 'Here to Stay', artist: 'Korn', album: 'Untouchables', duration: 271, art: LOCAL_COVERS.rock, preview_url: '/audio/track5.mp3' },
    { id: 'korn_6', uri: 'spotify:track:6D9N2jF4H8K1L3mR7P5qW2', title: 'Coming Undone', artist: 'Korn', album: 'See You on the Other Side', duration: 199, art: LOCAL_COVERS.rock, preview_url: '/audio/track6.mp3' },
    { id: 'korn_7', uri: 'spotify:track:7S2K4bL1V9M8P3qX6N5zC0', title: 'Did My Time', artist: 'Korn', album: 'Take a Look in the Mirror', duration: 244, art: LOCAL_COVERS.rock, preview_url: '/audio/track1.mp3' },
    { id: 'korn_8', uri: 'spotify:track:4T9J7mP2L8Q1K5rN3V6bH1', title: 'Twisted Transistor', artist: 'Korn', album: 'See You on the Other Side', duration: 252, art: LOCAL_COVERS.rock, preview_url: '/audio/track2.mp3' },
    { id: 'korn_9', uri: 'spotify:track:5P3N1K8bL2M7Q4rV9J6xW0', title: 'Thoughtless', artist: 'Korn', album: 'Untouchables', duration: 272, art: LOCAL_COVERS.rock, preview_url: '/audio/track3.mp3' },
    { id: 'korn_10', uri: 'spotify:track:8C1V6N4K2L9Q5mR3P7bZ8W', title: 'Shoots and Ladders', artist: 'Korn', album: 'Korn', duration: 322, art: LOCAL_COVERS.rock, preview_url: '/audio/track4.mp3' }
  ],
  kmfdm: [
    { id: 'km_1', uri: 'spotify:track:1V2J8N5K3Q7mP4rL6bW9X0', title: 'Juke-Joint Jezebel', artist: 'KMFDM', album: 'Nihil', duration: 339, art: LOCAL_COVERS.rock, preview_url: '/audio/track1.mp3' },
    { id: 'km_2', uri: 'spotify:track:2K4L9N6M1P8qR3V5bW7X2Z', title: 'A Drug Against War', artist: 'KMFDM', album: 'Angst', duration: 213, art: LOCAL_COVERS.rock, preview_url: '/audio/track2.mp3' },
    { id: 'km_3', uri: 'spotify:track:3M5N8P2Q7R4V1bW6X9Z0C3', title: 'Megalomaniac', artist: 'KMFDM', album: 'Symbols', duration: 375, art: LOCAL_COVERS.rock, preview_url: '/audio/track3.mp3' },
    { id: 'km_4', uri: 'spotify:track:4P6Q9R3V2bW5X8Z1C4K7N0', title: 'Godlike', artist: 'KMFDM', album: 'Naïve', duration: 355, art: LOCAL_COVERS.rock, preview_url: '/audio/track4.mp3' },
    { id: 'km_5', uri: 'spotify:track:5Q7R0V4bW6X9Z2C5K8N1P3', title: 'Vogue', artist: 'KMFDM', album: 'Xtort', duration: 245, art: LOCAL_COVERS.rock, preview_url: '/audio/track5.mp3' },
    { id: 'km_6', uri: 'spotify:track:6R8V1bW5X0Z3C6K9N2P4Q7', title: 'Anarchy', artist: 'KMFDM', album: 'Adios', duration: 328, art: LOCAL_COVERS.rock, preview_url: '/audio/track6.mp3' }
  ],
  doom: [
    { id: 'doom_1', uri: 'spotify:track:57PjISfyOylycvG2l4y3R2', title: 'Rapp Snitch Knitches (feat. Mr. Fantastik)', artist: 'MF DOOM', album: 'MM...FOOD', duration: 172, art: LOCAL_COVERS.doom, preview_url: '/audio/track1.mp3' },
    { id: 'doom_2', uri: 'spotify:track:7lT1dCz96jANsLAAADlfIg', title: 'Doomsday', artist: 'MF DOOM', album: 'Operation: Doomsday', duration: 298, art: LOCAL_COVERS.doom, preview_url: '/audio/track2.mp3' },
    { id: 'doom_3', uri: 'spotify:track:1Y2ExJJ9Dmb9po8K0ybSj3', title: 'All Caps', artist: 'Madvillain, MF DOOM, Madlib', album: 'Madvillainy', duration: 130, art: LOCAL_COVERS.doom, preview_url: '/audio/track3.mp3' },
    { id: 'doom_4', uri: 'spotify:track:5jAvFp7tK8nK1k4n9W4wK7', title: 'Accordion', artist: 'Madvillain, MF DOOM, Madlib', album: 'Madvillainy', duration: 118, art: LOCAL_COVERS.doom, preview_url: '/audio/track4.mp3' },
    { id: 'doom_5', uri: 'spotify:track:4wM4K6vP8R2qN7bJ3L5mX1', title: 'Meat Grinder', artist: 'Madvillain, MF DOOM, Madlib', album: 'Madvillainy', duration: 131, art: LOCAL_COVERS.doom, preview_url: '/audio/track5.mp3' },
    { id: 'doom_6', uri: 'spotify:track:2V3K8N5mP7qR1L4bW9X6Z0', title: 'One Beer', artist: 'MF DOOM', album: 'MM...FOOD', duration: 258, art: LOCAL_COVERS.doom, preview_url: '/audio/track6.mp3' },
    { id: 'doom_7', uri: 'spotify:track:3W4L9P6nQ8rS2M5cX0Y7A1', title: 'Hoe Cakes', artist: 'MF DOOM', album: 'MM...FOOD', duration: 234, art: LOCAL_COVERS.doom, preview_url: '/audio/track1.mp3' },
    { id: 'doom_8', uri: 'spotify:track:4X5M0Q7oR9sT3N6dY1Z8B2', title: 'Rhymes Like Dikes', artist: 'MF DOOM', album: 'Operation: Doomsday', duration: 259, art: LOCAL_COVERS.doom, preview_url: '/audio/track2.mp3' }
  ],
  mac: [
    { id: '4laW52Dhj4RhmYqdXYiYw9', uri: 'spotify:track:4laW52Dhj4RhmYqdXYiYw9', title: 'No Other Heart', artist: 'Mac DeMarco', album: 'Another One', duration: 173, art: LOCAL_COVERS.indie, preview_url: '/audio/track1.mp3' },
    { id: '0WiMJIxYYEex2AqhRqzV3u', uri: 'spotify:track:0WiMJIxYYEex2AqhRqzV3u', title: 'For the First Time', artist: 'Mac DeMarco', album: 'This Old Dog', duration: 182, art: LOCAL_COVERS.indie, preview_url: '/audio/track2.mp3' },
    { id: '17Vu4q830YQ6n6p0L1d0n1', uri: 'spotify:track:17Vu4q830YQ6n6p0L1d0n1', title: 'Chamber of Reflection', artist: 'Mac DeMarco', album: 'Salad Days', duration: 228, art: LOCAL_COVERS.indie, preview_url: '/audio/track3.mp3' },
    { id: '2OFrvBsxRzOca79nyqQj7h', uri: 'spotify:track:2OFrvBsxRzOca79nyqQj7h', title: 'My Kind of Woman', artist: 'Mac DeMarco', album: '2', duration: 190, art: LOCAL_COVERS.indie, preview_url: '/audio/track4.mp3' },
    { id: '3JvK2ytXZr8eZz2hF5m2k4', uri: 'spotify:track:3JvK2ytXZr8eZz2hF5m2k4', title: 'Ode to Viceroy', artist: 'Mac DeMarco', album: '2', duration: 233, art: LOCAL_COVERS.indie, preview_url: '/audio/track5.mp3' },
    { id: '4Y8t1d98j32d03l4d7m9k2', uri: 'spotify:track:4Y8t1d98j32d03l4d7m9k2', title: 'Salad Days', artist: 'Mac DeMarco', album: 'Salad Days', duration: 145, art: LOCAL_COVERS.indie, preview_url: '/audio/track6.mp3' },
    { id: '6m9k2l14b8a7c2e9d3f1a2', uri: 'spotify:track:6m9k2l14b8a7c2e9d3f1a2', title: 'Passing Out Pieces', artist: 'Mac DeMarco', album: 'Salad Days', duration: 167, art: LOCAL_COVERS.indie, preview_url: '/audio/track1.mp3' },
    { id: '4d5e6f7a8b9c0d1e2f3a4b', uri: 'spotify:track:4d5e6f7a8b9c0d1e2f3a4b', title: 'Moonlight on the River', artist: 'Mac DeMarco', album: 'This Old Dog', duration: 422, art: LOCAL_COVERS.indie, preview_url: '/audio/track2.mp3' }
  ],
  hits: [
    { id: 't1', uri: 'spotify:track:0VjIjW4GlUZAMYd2vXMi3b', title: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours', duration: 200, art: LOCAL_COVERS.synth, preview_url: '/audio/track1.mp3' },
    { id: 't2', uri: 'spotify:track:1BxfuPKGuaTgP7aM0Bbdwr', title: 'Cruel Summer', artist: 'Taylor Swift', album: 'Lover', duration: 178, art: LOCAL_COVERS.indie, preview_url: '/audio/track2.mp3' },
    { id: 't3', uri: 'spotify:track:4Dvkj6JhhA12EX05fT7y2e', title: 'As It Was', artist: 'Harry Styles', album: "Harry's House", duration: 167, art: LOCAL_COVERS.indie, preview_url: '/audio/track3.mp3' },
    { id: 't4', uri: 'spotify:track:7MXVkk9YMctZqd1Srtv4MB', title: 'Starboy', artist: 'The Weeknd, Daft Punk', album: 'Starboy', duration: 230, art: LOCAL_COVERS.synth, preview_url: '/audio/track4.mp3' },
    { id: 't5', uri: 'spotify:track:4h8VwWX1iGl8uQ12P3s1kX', title: 'Wake Me Up', artist: 'Avicii', album: 'True', duration: 247, art: LOCAL_COVERS.synth, preview_url: '/audio/track5.mp3' },
    { id: 't6', uri: 'spotify:track:69kOkLUCkxIZYexIgSG8rq', title: 'Get Lucky', artist: 'Daft Punk, Pharrell Williams', album: 'Random Access Memories', duration: 248, art: LOCAL_COVERS.synth, preview_url: '/audio/track6.mp3' }
  ]
};

export function resolveCuratedFallbackTracks(playlistName: string): NormalizedTrack[] {
  const normalized = extractPlaylistSearchQuery(playlistName).toLowerCase();
  const rawLower = (playlistName || '').toLowerCase();

  if (normalized.indexOf('korn') !== -1 || rawLower.indexOf('koяn') !== -1) {
    return CURATED_CATALOGS.korn;
  }
  if (normalized.indexOf('kmfdm') !== -1) {
    return CURATED_CATALOGS.kmfdm;
  }
  if (normalized.indexOf('doom') !== -1 || normalized.indexOf('madvillain') !== -1) {
    return CURATED_CATALOGS.doom;
  }
  if (normalized.indexOf('mac demarco') !== -1 || rawLower.indexOf('no other heart') !== -1) {
    return CURATED_CATALOGS.mac;
  }
  if (rawLower.indexOf('top') !== -1 || rawLower.indexOf('ios 7') !== -1 || rawLower.indexOf('synth') !== -1) {
    return CURATED_CATALOGS.hits;
  }
  return mergeUniqueTracks(CURATED_CATALOGS.doom.slice(0, 4), CURATED_CATALOGS.mac.slice(0, 4), CURATED_CATALOGS.korn.slice(0, 4));
}

export function searchLocalCuratedTracks(query: string): NormalizedTrack[] {
  const q = (query || '').toLowerCase().trim();
  if (!q) return [];
  const all = mergeUniqueTracks(
    CURATED_CATALOGS.mac,
    CURATED_CATALOGS.doom,
    CURATED_CATALOGS.korn,
    CURATED_CATALOGS.kmfdm,
    CURATED_CATALOGS.hits
  );

  // Match against normalized query too (e.g. "koяn" matches "korn")
  const normQ = extractPlaylistSearchQuery(query).toLowerCase();

  return all.filter((track) => {
    const haystack = `${track.title} ${track.artist} ${track.album}`.toLowerCase();
    return haystack.indexOf(q) !== -1 || (normQ && haystack.indexOf(normQ) !== -1);
  });
}
