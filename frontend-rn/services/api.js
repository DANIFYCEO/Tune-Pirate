import { Platform } from 'react-native';

// Azure Container Apps live production backend in Poland Central
const AZURE_URL = 'https://tunepirate-live.happyflower-25695355.polandcentral.azurecontainerapps.io';

// Optional local LAN fallback for offline development
const LAN_IP = '192.168.1.217';

const DEFAULT_URL = AZURE_URL;

export const API_BASE = DEFAULT_URL;

async function request(endpoint, options = {}) {
  try {
    const url = `${API_BASE}${endpoint}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    if (!res.ok) {
      throw new Error(`API error ${res.status}: ${res.statusText}`);
    }
    return await res.json();
  } catch (err) {
    console.warn(`[API] ${endpoint} failed:`, err.message);
    throw err;
  }
}

export const api = {
  // Discovery & Feeds
  getFrequency: () => request('/api/frequency'),
  getDailyMixes: (topArtists = '', limit = 10) =>
    request(`/api/daily-mixes?top_artists=${encodeURIComponent(topArtists)}&limit_per_mix=${limit}`),
  getTrending: (country = 'US') => request(`/api/trending?country=${country}`),
  getTrendingByLocation: (country = 'NG') => request(`/api/trending-by-location?country=${country}`),
  getLocations: () => request('/api/locations'),
  getGenres: () => request('/api/genres'),
  getMoods: () => request('/api/moods'),
  getDiscoverFeed: (recentIds = '', topArtists = '') =>
    request(`/api/discover?recent_ids=${encodeURIComponent(recentIds)}&top_artists=${encodeURIComponent(topArtists)}`),

  // Search
  search: (query, limit = 20) => request(`/api/search?q=${encodeURIComponent(query)}&limit=${limit}`),
  getSearchSuggestions: (query) => request(`/api/search-suggestions?q=${encodeURIComponent(query)}`),
  searchAlbums: (query) => request(`/api/search-albums?q=${encodeURIComponent(query)}`),
  searchPlaylists: (query) => request(`/api/search-playlists?q=${encodeURIComponent(query)}`),

  // Audio Playback & Radio
  getAudioUrl: (videoId, title = '', artist = '') => {
    const params = [];
    if (title) params.push(`title=${encodeURIComponent(title)}`);
    if (artist) params.push(`artist=${encodeURIComponent(artist)}`);
    const qs = params.length > 0 ? `?${params.join('&')}` : '';
    return request(`/api/audio-url/${videoId}${qs}`);
  },
  getSongRadio: (videoId, limit = 30) => request(`/api/radio/${videoId}?limit=${limit}`),
  getInfiniteQueue: (videoId, count = 15, excludeIds = '') =>
    request(`/api/infinite-queue?video_id=${videoId}&count=${count}&exclude_ids=${encodeURIComponent(excludeIds)}`),
  getLyrics: (videoId, title = '', artist = '') =>
    request(`/api/lyrics/${videoId}?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`),

  // Song & Album details
  getSongInfo: (videoId) => request(`/api/song-info/${videoId}`),
  getSimilarSongs: (videoId) => request(`/api/similar/${videoId}`),
  getAlbum: (albumId) => request(`/api/album/${albumId}`),
  getPlaylist: (browseId, title = '') =>
    request(`/api/playlist/${browseId}?title=${encodeURIComponent(title)}`),

  // Artists
  getArtistInfo: (name) => request(`/api/artist-info/${encodeURIComponent(name)}`),
  getArtistSongs: (name) => request(`/api/artist?name=${encodeURIComponent(name)}`),
  getArtistAlbums: (artistId) => request(`/api/artist-albums/${artistId}`),

  // AI Concierge
  aiChat: (message) => request(`/api/ai-chat?message=${encodeURIComponent(message)}`),
};
