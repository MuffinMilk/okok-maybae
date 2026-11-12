import {
  buildSpotifySearchUrl,
  extractPlaylistSearchQuery,
  LOCAL_COVERS,
  mergeUniqueTracks,
  NormalizedTrack,
  normalizeSpotifyTrack,
  resolveCuratedFallbackTracks,
  resolveFullLengthAudioUrl,
  searchLocalCuratedTracks
} from './spotifyCore';

let cachedAppToken: { token: string; expiresAt: number } | null = null;

export function getSpotifyCredentials(): { clientId: string; clientSecret: string } {
  return {
    clientId: (process.env.SPOTIFY_CLIENT_ID || '74009b25ca824b099fb2415105fb9ca6').trim(),
    clientSecret: (process.env.SPOTIFY_CLIENT_SECRET || '').trim()
  };
}

export function isRealSpotifyUserToken(token?: string): boolean {
  if (!token || typeof token !== 'string') return false;
  const trimmed = token.trim();
  if (trimmed.length < 20) return false;
  if (trimmed.startsWith('BQB_ios7_token_') || trimmed.startsWith('BQD_xpotify_app_token_') || trimmed.startsWith('BQD_manual_token')) {
    return false;
  }
  return true;
}

export async function getSpotifyAppToken(): Promise<string | null> {
  const now = Date.now();
  if (cachedAppToken && cachedAppToken.expiresAt > now + 60000) {
    return cachedAppToken.token;
  }

  const { clientId, clientSecret } = getSpotifyCredentials();
  if (!clientId || !clientSecret) {
    return null;
  }

  try {
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials'
    });

    if (!response.ok) return null;
    const data: any = await response.json();
    if (!data || !data.access_token) return null;

    cachedAppToken = {
      token: data.access_token,
      expiresAt: now + (Number(data.expires_in) || 3600) * 1000
    };
    return cachedAppToken.token;
  } catch {
    return null;
  }
}

export async function exchangeSpotifyAuthCode(params: {
  code: string;
  redirectUri: string;
  codeVerifier?: string;
  clientId?: string;
}): Promise<{ access_token?: string; refresh_token?: string; expires_in?: number; error?: string }> {
  const { clientId: envClientId, clientSecret } = getSpotifyCredentials();
  const clientId = (params.clientId || '').trim() || envClientId;
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded'
  };

  const bodyParams = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri
  });

  if (params.codeVerifier) {
    bodyParams.set('code_verifier', params.codeVerifier);
    bodyParams.set('client_id', clientId);
  } else if (clientSecret && clientId === envClientId) {
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    headers.Authorization = `Basic ${basicAuth}`;
  } else {
    bodyParams.set('client_id', clientId);
  }

  try {
    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers,
      body: bodyParams.toString()
    });
    const data: any = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !data.access_token) {
      return {
        error: data.error_description || data.error || `Spotify token exchange failed (${tokenRes.status})`
      };
    }
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in
    };
  } catch (err: any) {
    return { error: err?.message || 'Token exchange network error' };
  }
}

export async function fetchUserPlaylistsServer(userToken?: string): Promise<any[]> {
  const playlists: any[] = [];

  if (isRealSpotifyUserToken(userToken)) {
    try {
      const spRes = await fetch('https://api.spotify.com/v1/me/playlists?limit=25', {
        headers: { Authorization: `Bearer ${userToken}` }
      });
      if (spRes.ok) {
        const data: any = await spRes.json();
        const items = data.items || [];
        for (const item of items) {
          if (item && item.id) {
            const count = item.tracks?.total ?? item.items?.total ?? 20;
            playlists.push({
              id: item.id,
              name: item.name || 'Playlist',
              owner: item.owner?.display_name || item.owner?.id || 'Spotify',
              tracksCount: count,
              image: (item.images && item.images[0]?.url) || LOCAL_COVERS.indie
            });
          }
        }
      }
    } catch {
      // Fall back below
    }
  }

  if (playlists.length === 0) {
    return [
      { id: 'pl_mf_doom', name: 'mf doom', owner: 'Muffin', tracksCount: 20, image: LOCAL_COVERS.doom },
      { id: 'pl_no_other_heart', name: 'No Other Heart', owner: 'Muffin', tracksCount: 20, image: LOCAL_COVERS.indie },
      { id: 'pl_korn', name: 'KoЯn', owner: 'DamnZombieBitch', tracksCount: 10, image: LOCAL_COVERS.rock },
      { id: 'pl_top_hits', name: "Today's Top Hits", owner: 'Spotify', tracksCount: 20, image: LOCAL_COVERS.synth },
      { id: 'pl_ios7', name: 'iOS 7 Nostalgia 2013-2014', owner: 'Xpotify Curated', tracksCount: 20, image: LOCAL_COVERS.synth }
    ];
  }

  return playlists;
}

async function querySpotifySearchPages(query: string, token: string, pages = 2): Promise<NormalizedTrack[]> {
  const tracks: NormalizedTrack[] = [];
  for (let page = 0; page < pages; page++) {
    try {
      const url = buildSpotifySearchUrl(query, page * 10, 10);
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) break;
      const data: any = await res.json();
      const items = data.tracks?.items || [];
      if (items.length === 0) break;
      for (let i = 0; i < items.length; i++) {
        const normalized = normalizeSpotifyTrack(items[i], LOCAL_COVERS.doom, page * 10 + i);
        if (normalized) tracks.push(normalized);
      }
      if (items.length < 10) break;
    } catch {
      break;
    }
  }
  return mergeUniqueTracks(tracks);
}

export async function fetchPlaylistTracksServer(params: {
  playlistId?: string;
  playlistName?: string;
  userToken?: string;
}): Promise<{ name: string; tracks: NormalizedTrack[]; source: string }> {
  const playlistId = (params.playlistId || '').trim();
  const playlistName = (params.playlistName || '').trim();
  const userToken = (params.userToken || '').trim();

  let tracks: NormalizedTrack[] = [];
  let source = 'curated';

  const validUserToken = isRealSpotifyUserToken(userToken) ? userToken : '';
  const appToken = await getSpotifyAppToken();
  const authToken = validUserToken || appToken || '';

  // Step 1: Attempt direct playlist items (/items first per Feb 2026 Spotify spec, then legacy /tracks)
  if (playlistId && !playlistId.startsWith('pl_') && authToken) {
    const endpoints = [
      `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/items?limit=50`,
      `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/tracks?limit=50`
    ];
    for (const url of endpoints) {
      if (tracks.length > 0) break;
      try {
        const spRes = await fetch(url, {
          headers: { Authorization: `Bearer ${authToken}` }
        });
        if (spRes.ok) {
          const data: any = await spRes.json();
          const items = data.items || [];
          const normalized = items
            .map((entry: any, idx: number) => normalizeSpotifyTrack(entry, LOCAL_COVERS.doom, idx))
            .filter(Boolean) as NormalizedTrack[];
          if (normalized.length > 0) {
            tracks = normalized;
            source = 'spotify_playlist';
            break;
          }
        }
      } catch {
        // Continue to next endpoint or live search fallback
      }
    }
  }

  // Step 2: Live paginated Spotify Search fallback (limit=10 per page) when playlist is restricted
  if (tracks.length === 0 && authToken) {
    const searchQuery = extractPlaylistSearchQuery(playlistName || 'MF DOOM');
    const searched = await querySpotifySearchPages(searchQuery, authToken, 2);
    if (searched.length > 0) {
      tracks = searched;
      source = 'spotify_search';
    }
  }

  // Step 3: Local curated fallback if Spotify credentials/network unavailable
  if (tracks.length === 0) {
    tracks = resolveCuratedFallbackTracks(playlistName || 'mf doom');
    source = 'curated';
  }

  return { name: playlistName, tracks, source };
}

export async function searchTracksServer(
  rawQuery: string,
  userToken?: string
): Promise<{ tracks: NormalizedTrack[]; source: string }> {
  const query = (rawQuery || '').trim();
  if (!query) return { tracks: [], source: 'empty' };

  const validUserToken = isRealSpotifyUserToken(userToken) ? userToken : '';
  const appToken = await getSpotifyAppToken();
  const authToken = validUserToken || appToken || '';

  let liveTracks: NormalizedTrack[] = [];
  if (authToken) {
    const normalizedQuery = extractPlaylistSearchQuery(query);
    liveTracks = await querySpotifySearchPages(query, authToken, 2);
    if (liveTracks.length === 0 && normalizedQuery && normalizedQuery.toLowerCase() !== query.toLowerCase()) {
      liveTracks = await querySpotifySearchPages(normalizedQuery, authToken, 1);
    }
  }

  const localMatches = searchLocalCuratedTracks(query);
  const combined = mergeUniqueTracks(liveTracks, localMatches);

  // Assign deterministic full-length audio fallback URLs
  for (const tr of combined) {
    if (!tr.preview_url) {
      tr.preview_url = resolveFullLengthAudioUrl(tr.title, tr.artist);
    }
  }

  return {
    tracks: combined,
    source: liveTracks.length > 0 ? 'spotify_live' : 'local_catalog'
  };
}

export async function fetchLikedTracksServer(userToken?: string): Promise<NormalizedTrack[]> {
  let tracks: NormalizedTrack[] = [];
  if (isRealSpotifyUserToken(userToken)) {
    try {
      const res = await fetch('https://api.spotify.com/v1/me/tracks?limit=20', {
        headers: { Authorization: `Bearer ${userToken}` }
      });
      if (res.ok) {
        const data: any = await res.json();
        const items = data.items || [];
        tracks = items
          .map((entry: any, idx: number) => normalizeSpotifyTrack(entry, LOCAL_COVERS.indie, idx))
          .filter(Boolean) as NormalizedTrack[];
      }
    } catch {
      // Fallback below
    }
  }

  if (tracks.length === 0) {
    const searched = await searchTracksServer('Mac DeMarco', userToken);
    tracks = searched.tracks;
  }

  return tracks;
}

export async function fetchDevicesServer(userToken?: string): Promise<any[]> {
  if (!isRealSpotifyUserToken(userToken)) return [];
  try {
    const res = await fetch('https://api.spotify.com/v1/me/player/devices', {
      headers: { Authorization: `Bearer ${userToken}` }
    });
    if (res.ok) {
      const data: any = await res.json();
      return data.devices || [];
    }
  } catch {
    // Ignore
  }
  return [];
}

export async function fetchPlayerStateServer(userToken?: string): Promise<{ status: number; payload: any }> {
  if (!isRealSpotifyUserToken(userToken)) {
    return { status: 200, payload: { is_playing: false, device: null, track: null } };
  }
  try {
    const spRes = await fetch('https://api.spotify.com/v1/me/player', {
      headers: { Authorization: `Bearer ${userToken}` }
    });
    if (spRes.status === 204 || spRes.status === 404 || spRes.status === 401) {
      return {
        status: 200,
        payload: { is_playing: false, device: null, track: null, token_expired: spRes.status === 401 }
      };
    }
    if (spRes.ok) {
      const data: any = await spRes.json();
      const item = data.item;
      return {
        status: 200,
        payload: {
          is_playing: Boolean(data.is_playing),
          progress_ms: data.progress_ms || 0,
          device: data.device
            ? {
                id: data.device.id,
                name: data.device.name,
                type: data.device.type,
                is_active: data.device.is_active,
                volume_percent: data.device.volume_percent
              }
            : null,
          track: item
            ? {
                id: item.id,
                title: item.name,
                artist: (item.artists || []).map((a: any) => a.name).join(', '),
                album: item.album?.name || '',
                art: item.album?.images?.[0]?.url || LOCAL_COVERS.doom,
                duration: item.duration_ms ? Math.round(item.duration_ms / 1000) : 180,
                uri: item.uri
              }
            : null
        }
      };
    }
    return { status: spRes.status, payload: { error: 'Spotify API error' } };
  } catch (err: any) {
    return { status: 500, payload: { error: err?.message || 'Player state error' } };
  }
}

export async function executePlayerActionServer(
  action: string,
  params: { token?: string; device_id?: string; track_uri?: string }
): Promise<{ status: number; payload: any }> {
  const userToken = (params.token || '').trim();
  const deviceId = (params.device_id || '').trim();
  const trackUri = (params.track_uri || '').trim();

  if (!isRealSpotifyUserToken(userToken)) {
    return { status: 200, payload: { success: true, mode: 'local_audio' } };
  }

  let resolvedDeviceId = deviceId;
  if (resolvedDeviceId === 'phone' || resolvedDeviceId === 'auto' || !resolvedDeviceId) {
    const devices = await fetchDevicesServer(userToken);
    let target =
      resolvedDeviceId === 'phone' ? devices.find((d: any) => d.type === 'Smartphone') : undefined;
    if (!target) target = devices.find((d: any) => d.is_active);
    if (!target && devices.length > 0) target = devices[0];
    resolvedDeviceId = target?.id ? target.id : '';
  }

  let url = 'https://api.spotify.com/v1/me/player/';
  let method = 'PUT';
  let body: any = {};

  if (action === 'play') {
    url += 'play';
    if (trackUri) {
      const uri = trackUri.startsWith('spotify:') ? trackUri : `spotify:track:${trackUri}`;
      body = { uris: [uri] };
    }
    if (resolvedDeviceId) url += `?device_id=${encodeURIComponent(resolvedDeviceId)}`;
  } else if (action === 'pause') {
    url += 'pause';
    if (resolvedDeviceId) url += `?device_id=${encodeURIComponent(resolvedDeviceId)}`;
  } else if (action === 'next') {
    url += 'next';
    method = 'POST';
    if (resolvedDeviceId) url += `?device_id=${encodeURIComponent(resolvedDeviceId)}`;
  } else if (action === 'previous') {
    url += 'previous';
    method = 'POST';
    if (resolvedDeviceId) url += `?device_id=${encodeURIComponent(resolvedDeviceId)}`;
  } else if (action === 'transfer') {
    url = 'https://api.spotify.com/v1/me/player';
    body = { device_ids: [resolvedDeviceId || deviceId], play: true };
  } else {
    return { status: 400, payload: { error: 'Invalid player action' } };
  }

  try {
    const spRes = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${userToken}`,
        'Content-Type': 'application/json'
      },
      body: Object.keys(body).length ? JSON.stringify(body) : undefined
    });

    if (spRes.ok || spRes.status === 204) {
      return { status: 200, payload: { success: true, device_id: resolvedDeviceId } };
    }

    if (spRes.status === 404 && action === 'play') {
      const devices = await fetchDevicesServer(userToken);
      const firstDev = devices[0];
      if (firstDev?.id) {
        const retryRes = await fetch(
          `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(firstDev.id)}`,
          {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${userToken}`,
              'Content-Type': 'application/json'
            },
            body: Object.keys(body).length ? JSON.stringify(body) : undefined
          }
        );
        if (retryRes.ok || retryRes.status === 204) {
          return { status: 200, payload: { success: true, device_id: firstDev.id, device_name: firstDev.name } };
        }
      }
    }

    const detail = await spRes.text().catch(() => '');
    return { status: spRes.status, payload: { error: 'Spotify API error', status: spRes.status, detail } };
  } catch (err: any) {
    return { status: 500, payload: { error: err?.message || 'Spotify player request failed' } };
  }
}
