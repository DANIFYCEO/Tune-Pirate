import { useState } from 'react';
import TrackCard from '../components/TrackCard';

export default function AIPage({ onSelectSong, onSelectPlaylist, currentSong }) {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [playlist, setPlaylist] = useState([]);
  const [error, setError] = useState("");

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setError("");
    setPlaylist([]);
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/ai-playlist?prompt=${encodeURIComponent(prompt)}`);
      const data = await res.json();
      if (data.songs && data.songs.length > 0) {
        setPlaylist(data.songs);
      } else {
        setError("Could not generate a playlist for that prompt.");
      }
    } catch (err) {
      setError("An error occurred connecting to the AI.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ paddingTop: 8 }}>
      <h1 className="page-title">AI Playlists</h1>
      <p style={{ color: 'var(--text-secondary)', marginTop: 8, marginBottom: 32 }}>
        Describe a vibe, an activity, or a mood, and Tune Pirate AI will build you a custom playlist instantly.
      </p>

      <div style={{ display: 'flex', gap: 12, marginBottom: 40, flexWrap: 'wrap' }}>
        <input
          type="text"
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder="e.g. Upbeat 80s synthwave for a night drive..."
          style={{ flex: 1, minWidth: 260, padding: '16px 20px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.5)', color: 'white', fontSize: 16, outline: 'none' }}
          onKeyDown={e => e.key === 'Enter' && handleGenerate()}
        />
        <button
          onClick={handleGenerate}
          disabled={loading || !prompt.trim()}
          style={{ padding: '16px 32px', borderRadius: 12, border: 'none', background: 'white', color: 'black', fontWeight: 700, fontSize: 16, cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.7 : 1 }}
        >
          {loading ? 'Generating...' : 'Generate'}
        </button>
      </div>

      {error && <p style={{ color: '#ff453a' }}>{error}</p>}

      {playlist.length > 0 && (
        <div style={{ paddingBottom: 100 }}>
          <div className="section-header"><span>Your Custom Playlist</span></div>
          <div 
            style={{ display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.08)', borderRadius: 12, padding: 16, cursor: 'pointer', transition: 'background 0.2s', position: 'relative' }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.12)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
            onClick={() => onSelectPlaylist({
              id: 'ai-playlist',
              title: `AI: ${prompt}`,
              cover: playlist[0]?.cover,
              songs: playlist,
              description: `Generated ${playlist.length} tracks for prompt: "${prompt}"`
            })}
          >
            <img src={playlist[0]?.cover} alt="cover" style={{ width: 100, height: 100, borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }} />
            <div style={{ marginLeft: 20 }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: 'white', marginBottom: 6 }}>{prompt} Mix</div>
              <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>{playlist.length} Songs • AI Generated</div>
            </div>
            <div style={{ position: 'absolute', right: 32, width: 56, height: 56, borderRadius: '50%', background: '#1db954', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="black"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
