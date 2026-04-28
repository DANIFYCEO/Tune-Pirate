import { useState, useEffect } from 'react';
import TrackCard from '../components/TrackCard';
import CompactPlaylistCard from '../components/CompactPlaylistCard';

export default function SearchPage({ searchQuery, onSelectSong, onSelectPlaylist, currentSong }) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchMode, setSearchMode] = useState('songs'); // 'songs' | 'artist' | 'playlists'

  useEffect(() => {
    if (!searchQuery || searchQuery.trim().length < 2) {
      setResults([]);
      return;
    }

    const delayDebounceFn = setTimeout(async () => {
      setLoading(true);
      try {
        let endpoint = '/api/search?q=';
        if (searchMode === 'artist') endpoint = '/api/artist?name=';
        if (searchMode === 'playlists') endpoint = '/api/search-playlists?q='; // Need to add this endpoint or just use default search but it doesn't return playlists? Wait, I didn't add /api/search-playlists. Let me use a custom endpoint or just a query suffix. Let's just create the endpoint quickly in backend or handle it here. 
        // Actually, let me just add a new endpoint `/api/search-playlists` to the backend.
        
        const res = await fetch(`${import.meta.env.VITE_API_URL}${endpoint}${encodeURIComponent(searchMode === 'playlists' ? 'spotify ' + searchQuery : searchQuery)}`);
        const data = await res.json();
        setResults(searchMode === 'playlists' ? (data.playlists || []) : (data.songs || []));
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }, 500);

    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery, searchMode]);

  return (
    <div style={{ paddingTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h1 className="page-title" style={{ margin: 0 }}>Search</h1>
        <div style={{ display: 'flex', gap: 8, background: 'rgba(255,255,255,0.1)', padding: 4, borderRadius: 20 }}>
           <button 
             onClick={() => setSearchMode('songs')}
             style={{ padding: '6px 16px', borderRadius: 16, border: 'none', background: searchMode === 'songs' ? 'white' : 'transparent', color: searchMode === 'songs' ? 'black' : 'white', fontWeight: 600, cursor: 'pointer' }}
           >Songs</button>
           <button 
             onClick={() => setSearchMode('artist')}
             style={{ padding: '6px 16px', borderRadius: 16, border: 'none', background: searchMode === 'artist' ? 'white' : 'transparent', color: searchMode === 'artist' ? 'black' : 'white', fontWeight: 600, cursor: 'pointer' }}
           >Artist</button>
           <button 
             onClick={() => setSearchMode('playlists')}
             style={{ padding: '6px 16px', borderRadius: 16, border: 'none', background: searchMode === 'playlists' ? 'white' : 'transparent', color: searchMode === 'playlists' ? 'black' : 'white', fontWeight: 600, cursor: 'pointer' }}
           >Playlists</button>
        </div>
      </div>
      
      {!searchQuery && (
        <p style={{ color: 'var(--text-secondary)', marginTop: 8 }}>
          Type above to find {searchMode === 'artist' ? 'an artist\'s full discography' : 'songs & lyrics'}.
        </p>
      )}

      {loading && <p style={{ color: 'var(--text-secondary)' }}>Searching...</p>}

      {!loading && searchQuery && results.length === 0 && (
        <p style={{ color: 'var(--text-secondary)' }}>No results found.</p>
      )}

      {!loading && results.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div className="section-header">
            <span>{searchMode === 'artist' ? 'Artist Discography' : searchMode === 'playlists' ? 'Playlists' : 'Top Results'}</span>
          </div>
          {searchMode === 'artist' ? (
            <div 
              style={{ display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.08)', borderRadius: 12, padding: 16, cursor: 'pointer', transition: 'background 0.2s', position: 'relative' }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.12)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
              onClick={() => onSelectPlaylist({
                id: `artist-${searchQuery}`,
                title: searchQuery,
                cover: results[0]?.cover,
                songs: results,
                description: `Full discography for ${searchQuery}`
              })}
            >
              <img src={results[0]?.cover} alt="cover" style={{ width: 100, height: 100, borderRadius: 8, objectFit: 'cover' }} />
              <div style={{ marginLeft: 20 }}>
                <div style={{ fontSize: 24, fontWeight: 800, color: 'white', marginBottom: 6 }}>{searchQuery}</div>
                <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>{results.length} Songs • Artist</div>
              </div>
              <div style={{ position: 'absolute', right: 32, width: 56, height: 56, borderRadius: '50%', background: 'var(--text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="black"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              </div>
            </div>
          ) : searchMode === 'playlists' ? (
            <div className="grid-horizontal" style={{ flexWrap: 'wrap' }}>
              {results.map(pl => (
                <CompactPlaylistCard
                  key={pl.browseId || pl.title}
                  playlist={{ id: pl.browseId, ...pl }}
                  onClick={() => onSelectPlaylist({ id: pl.browseId, ...pl })}
                />
              ))}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 24, paddingBottom: 100 }}>
              {results.map(song => (
                <TrackCard
                  key={`search-${song.id}`}
                  song={song}
                  isActive={currentSong?.id === song.id}
                  onClick={() => onSelectSong(song, results)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
