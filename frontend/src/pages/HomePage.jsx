import { useState, useEffect } from 'react';
import TrackCard from '../components/TrackCard';
import CompactPlaylistCard from '../components/CompactPlaylistCard';

function SectionRow({ title, songs, onSelect, currentSong, isLoading }) {
  if (isLoading) return (
    <div style={{ marginBottom: 48 }}>
      <div className="section-header"><span>{title}</span></div>
      <div className="grid-horizontal">
        {[...Array(4)].map((_, i) => (
          <div key={i} style={{ minWidth: 175 }}>
            <div className="skeleton-cover track-cover-container" style={{ width: 175, height: 175 }} />
            <div style={{ marginTop: 12 }}>
              <div className="skeleton-line" style={{ width: '80%', height: 13, marginBottom: 8 }} />
              <div className="skeleton-line" style={{ width: '55%', height: 11 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
  if (!songs?.length) return null;
  return (
    <div style={{ marginBottom: 48 }}>
      <div className="section-header"><span>{title}</span></div>
      <div className="grid-horizontal">
        {songs.map(song => (
          <TrackCard
            key={song.id}
            song={song}
            isActive={currentSong?.id === song.id}
            onClick={() => onSelect(song, songs)}
          />
        ))}
      </div>
    </div>
  );
}

export default function HomePage({ onSelectSong, onSelectPlaylist, currentSong, history, topArtists, likedSongsPlaylist }) {
  const [recommendations, setRecommendations] = useState([]);
  const [trending, setTrending] = useState([]);
  const [newReleases, setNewReleases] = useState([]);
  const [moods, setMoods] = useState([]);
  const [checkTheseOut, setCheckTheseOut] = useState([]);
  const [spotifyPlaylists, setSpotifyPlaylists] = useState([]);
  const [becauseSections, setBecauseSections] = useState([]);
  const [loading, setLoading] = useState(true);

  const timeOfDay = (() => {
    const h = new Date().getHours();
    if (h >= 5 && h < 12) return 'morning';
    if (h >= 12 && h < 18) return 'afternoon';
    return 'night';
  })();

  const greeting = { morning: 'Good Morning ☀️', afternoon: 'Good Afternoon 🎵', night: 'Good Night 🌙' }[timeOfDay];

  const CACHE_KEY = `tp_home_cache_${timeOfDay}`;
  const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

  const loadFromCache = () => {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const { ts, data } = JSON.parse(raw);
      if (Date.now() - ts > CACHE_TTL) return null;
      // Force reset if new fields are missing
      if (!data.checkTheseOut || !data.spotifyPlaylists) return null;
      return data;
    } catch { return null; }
  };

  const saveToCache = (data) => {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
    } catch {}
  };

  useEffect(() => {
    // 1. Load from cache immediately (no spinner)
    const cached = loadFromCache();
    if (cached) {
      setRecommendations(cached.recommendations || []);
      setTrending(cached.trending || []);
      setNewReleases(cached.newReleases || []);
      setMoods(cached.moods || []);
      setCheckTheseOut(cached.checkTheseOut || []);
      setSpotifyPlaylists(cached.spotifyPlaylists || []);
      setLoading(false);
    }

    // 2. Always fetch fresh in background to update cache
    const fetchAll = async () => {
      try {
        const results = await Promise.allSettled([
          fetch(`${import.meta.env.VITE_API_URL}/api/recommendations?time_of_day=${timeOfDay}`).then(r => r.json()),
          fetch(`${import.meta.env.VITE_API_URL}/api/trending`).then(r => r.json()),
          fetch(`${import.meta.env.VITE_API_URL}/api/new-releases`).then(r => r.json()),
          fetch(`${import.meta.env.VITE_API_URL}/api/moods`).then(r => r.json()),
          fetch(`${import.meta.env.VITE_API_URL}/api/check-these-out`).then(r => r.json()),
          fetch(`${import.meta.env.VITE_API_URL}/api/spotify-playlists`).then(r => r.json()),
        ]);
        
        const safeData = (index, fallback) => results[index].status === 'fulfilled' ? results[index].value : fallback;

        const fresh = {
          recommendations: safeData(0, {songs:[]}).songs || [],
          trending: safeData(1, {songs:[]}).songs || [],
          newReleases: safeData(2, {songs:[]}).songs || [],
          moods: safeData(3, {moods:[]}).moods || [],
          checkTheseOut: safeData(4, {playlists:[]}).playlists || [],
          spotifyPlaylists: safeData(5, {playlists:[]}).playlists || [],
        };
        saveToCache(fresh);
        setRecommendations(fresh.recommendations);
        setTrending(fresh.trending);
        setNewReleases(fresh.newReleases);
        setMoods(fresh.moods);
        setCheckTheseOut(fresh.checkTheseOut);
        setSpotifyPlaylists(fresh.spotifyPlaylists);
      } catch (e) {
        console.error("Home fetch error:", e);
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, []);

  useEffect(() => {
    const artists = topArtists();
    if (!artists.length) return;

    const fetchPersonalized = async () => {
      const results = await Promise.all(
        artists.map(artist =>
          fetch(`${import.meta.env.VITE_API_URL}/api/because-you-listened?artist=${encodeURIComponent(artist)}`)
            .then(r => r.json())
            .then(d => ({ artist, songs: d.songs || [] }))
            .catch(() => null)
        )
      );
      setBecauseSections(results.filter(Boolean).filter(r => r.songs.length > 0));
    };
    fetchPersonalized();
  }, [topArtists]);

  // Construct Top Grid Items
  // We'll put "For You", some moods, and some personalized artists here.
  const topGridPlaylists = [];
  if (recommendations.length > 0) topGridPlaylists.push({ title: "For You Mix", cover: recommendations[0]?.cover, songs: recommendations, description: "Personalised mix based on time of day." });
  if (trending.length > 0) topGridPlaylists.push({ title: "Trending Mix", cover: trending[0]?.cover, songs: trending, description: "What's hot right now." });
  
  becauseSections.slice(0, 2).forEach(sec => {
     topGridPlaylists.push({ title: `${sec.artist} Mix`, cover: sec.songs[0]?.cover, songs: sec.songs, description: `Because you listened to ${sec.artist}` });
  });

  moods.slice(0, 2).forEach(mood => {
     topGridPlaylists.push({ title: `${mood.emoji} ${mood.label}`, cover: mood.cover, songs: mood.songs, description: `Songs for your ${mood.label} mood.` });
  });

  // Always prepend Liked Songs as the first card
  const allGridPlaylists = likedSongsPlaylist
    ? [likedSongsPlaylist, ...topGridPlaylists]
    : topGridPlaylists;

  return (
    <div>
      <h1 className="page-title">{greeting}</h1>

      {/* TOP GRID (Spotify Style) */}
      {(!loading || likedSongsPlaylist) && allGridPlaylists.length > 0 && (
        <div className="compact-grid">
           {allGridPlaylists.map((pl, i) => (
             <CompactPlaylistCard 
               key={`pl-${i}`} 
               playlist={pl}
               onClick={() => onSelectPlaylist({ id: `mix-${i}`, ...pl })} 
             />
           ))}
        </div>
      )}

      {loading && (
         <div className="compact-grid">
           {[...Array(6)].map((_, i) => (
             <div key={i} className="compact-playlist-card" style={{ background: 'rgba(255,255,255,0.02)' }}>
               <div className="skeleton-cover" style={{ width: 56, height: 56 }} />
               <div className="skeleton-line" style={{ width: 80, height: 12, marginLeft: 12 }} />
             </div>
           ))}
         </div>
      )}

      {/* Recently Played */}
      {history.length > 0 && (
        <div style={{ marginBottom: 48 }}>
          <div className="section-header"><span>Recently Played</span></div>
          <div className="grid-horizontal">
            {history.slice(0, 8).map((song, _, arr) => (
              <TrackCard key={`hist-${song.id}`} song={song} isActive={currentSong?.id === song.id} onClick={() => onSelectSong(song, arr)} />
            ))}
          </div>
        </div>
      )}

      {/* New Releases */}
      <SectionRow title="✨ New Releases" songs={newReleases} onSelect={onSelectSong} currentSong={currentSong} isLoading={loading} />

      {/* Check These Out */}
      {!loading && checkTheseOut.length > 0 && (
        <div style={{ marginBottom: 48 }}>
          <div className="section-header"><span>Check These Out</span></div>
          <div className="grid-horizontal">
            {checkTheseOut.map(pl => (
              <CompactPlaylistCard
                key={pl.browseId || pl.title}
                playlist={{ id: pl.browseId, ...pl }}
                onClick={() => onSelectPlaylist({ id: pl.browseId, ...pl })}
              />
            ))}
          </div>
        </div>
      )}

      {/* Spotify Curated */}
      {!loading && spotifyPlaylists.length > 0 && (
        <div style={{ marginBottom: 48 }}>
          <div className="section-header"><span>Spotify Curated</span></div>
          <div className="grid-horizontal">
            {spotifyPlaylists.map(pl => (
              <CompactPlaylistCard
                key={pl.browseId || pl.title}
                playlist={{ id: pl.browseId, ...pl }}
                onClick={() => onSelectPlaylist({ id: pl.browseId, ...pl })}
              />
            ))}
          </div>
        </div>
      )}

      {/* Other Personalised Sections (horizontal) */}
      {becauseSections.slice(2).map(sec => (
        <SectionRow
          key={`because-${sec.artist}`}
          title={`More like ${sec.artist}`}
          songs={sec.songs}
          onSelect={onSelectSong}
          currentSong={currentSong}
          isLoading={false}
        />
      ))}
      
      {/* Remaining Moods */}
      {moods.length > 2 && (
        <div style={{ marginBottom: 48 }}>
          <div className="section-header"><span>Browse by Mood</span></div>
          <div className="mood-grid">
            {moods.slice(2).map(mood => (
              <div
                key={mood.label}
                className="mood-card"
                onClick={() => onSelectPlaylist({ id: mood.label, title: mood.label, cover: mood.cover, songs: mood.songs, description: `Your ${mood.label} mix.` })}
              >
                <img
                  src={mood.cover}
                  alt={mood.label}
                  className="mood-cover"
                  referrerPolicy="no-referrer"
                  crossOrigin="anonymous"
                />
                <div className="mood-label">{mood.emoji} {mood.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
