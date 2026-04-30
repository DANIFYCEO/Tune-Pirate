import React, { useState, useRef, useEffect } from 'react';
import TrackListItem from '../components/TrackListItem';
import { useDownload } from '../hooks/useDownload';

const FALLBACK = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Crect width='300' height='300' fill='%23222'/%3E%3Ccircle cx='150' cy='150' r='60' fill='%23444'/%3E%3Ccircle cx='150' cy='150' r='20' fill='%23222'/%3E%3C/svg%3E";

const Icons = {
  Back:     () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>,
  Play:     () => <svg width="24" height="24" viewBox="0 0 24 24" fill="black"><polygon points="5 3 19 12 5 21 5 3"/></svg>,
  Heart:    ({ filled }) => <svg width="28" height="28" viewBox="0 0 24 24" fill={filled ? "#1db954" : "none"} stroke={filled ? "#1db954" : "currentColor"} strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>,
  Download: () => <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
};

export default function PlaylistPage({ 
  playlist, 
  onClose, 
  onSelectSong, 
  currentSong,
  isPlaylistLiked,
  onToggleLikePlaylist,
  onRemoveSong
}) {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState("");
  const scrollRef = useRef(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleScroll = () => {
      setIsScrolled(el.scrollTop > 240);
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  const [fetchedSongs, setFetchedSongs] = useState(null);
  const [isLoadingSongs, setIsLoadingSongs] = useState(false);

  useEffect(() => {
    if (playlist && (!playlist.songs || playlist.songs.length === 0) && playlist.id) {
      setIsLoadingSongs(true);
      fetch(`${import.meta.env.VITE_API_URL}/api/playlist/${playlist.id}`)
        .then(r => r.json())
        .then(data => {
          setFetchedSongs(data.songs || []);
        })
        .catch(err => {
          console.error("Failed to fetch playlist songs", err);
          setFetchedSongs([]);
        })
        .finally(() => setIsLoadingSongs(false));
    }
  }, [playlist]);

  const activeSongs = playlist?.songs?.length > 0 ? playlist.songs : (fetchedSongs || []);

  const { startDownload, downloads } = useDownload();
  const isDownloadingPlaylist = isDownloading || downloads.some(d => playlist.songs?.some(s => s.id === d.id));

  const downloadPlaylist = async () => {
    if (!activeSongs || activeSongs.length === 0) return;
    setIsDownloading(true);
    
    // Auto-save playlist to library if not already saved
    if (!isPlaylistLiked && playlist.title !== "Liked Songs") {
      onToggleLikePlaylist();
    }
    
    let cancelled = false;
    for (let i = 0; i < activeSongs.length; i++) {
      if (cancelled) break;
      const song = activeSongs[i];
      setDownloadProgress(`Downloading ${i + 1}/${activeSongs.length}`);
      try {
        await startDownload(song);
      } catch (e) {
        if (e.name === 'AbortError') cancelled = true;
        console.error("Failed to download:", song.title, e);
      }
    }
    setIsDownloading(false);
    setDownloadProgress(cancelled ? "Cancelled" : "Downloaded ✓");
    setTimeout(() => setDownloadProgress(""), 3000);
  };

  if (!playlist) return null;

  return (
    <div className="playlist-page" ref={scrollRef}>
      {/* Sticky Top Bar */}
      <div className={`playlist-sticky-header ${isScrolled ? 'visible' : ''}`}>
        <button className="btn-close" onClick={onClose}>
          <Icons.Back />
        </button>
        <h2 className="sticky-title">{playlist.title}</h2>
        <button 
          className="sticky-play-btn" 
          onClick={() => activeSongs.length > 0 && onSelectSong(activeSongs[0], activeSongs)}
        >
          <Icons.Play />
        </button>
      </div>

      {/* Hero Header */}
      <div className="playlist-hero">
        <div className="playlist-hero-bg" style={{ backgroundImage: `url(${playlist.cover || FALLBACK})` }} />
        <div className="playlist-hero-gradient" />
        
        {!isScrolled && (
          <button className="btn-close absolute-close" onClick={onClose}>
            <Icons.Back />
          </button>
        )}

        <div className="playlist-hero-content">
          <img src={playlist.cover || FALLBACK} alt="cover" className="playlist-cover-large" referrerPolicy="no-referrer" />
          <div className="playlist-hero-text">
            <span className="playlist-type">Playlist</span>
            <h1 className="playlist-title-massive">{playlist.title}</h1>
            <p className="playlist-description">{playlist.description}</p>
            <p className="playlist-meta">Tune Pirate • {activeSongs.length || 0} songs</p>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="playlist-actions-bar" style={{ display: 'flex', alignItems: 'center', gap: '24px', padding: '16px 24px' }}>
        <button 
          className="btn-play-massive"
          onClick={() => activeSongs.length > 0 && onSelectSong(activeSongs[0], activeSongs)}
        >
          <Icons.Play />
        </button>
        
        {/* Like Button */}
        {playlist.title !== "Liked Songs" && (
          <button 
            className="playlist-action-btn"
            style={{ background: 'none', border: 'none', color: isPlaylistLiked ? '#1db954' : 'rgba(255,255,255,0.7)', cursor: 'pointer', transition: 'transform 0.1s' }}
            onClick={onToggleLikePlaylist}
            onMouseDown={e => e.currentTarget.style.transform = 'scale(0.9)'}
            onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
          >
            <Icons.Heart filled={isPlaylistLiked} />
          </button>
        )}

        {/* Download Button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button 
            className="playlist-action-btn"
            style={{ background: 'none', border: 'none', color: isDownloading || downloadProgress.includes('✓') ? '#1db954' : 'rgba(255,255,255,0.7)', cursor: isDownloading ? 'default' : 'pointer', transition: 'transform 0.1s' }}
            onClick={() => !isDownloading && downloadPlaylist()}
            onMouseDown={e => !isDownloading && (e.currentTarget.style.transform = 'scale(0.9)')}
            onMouseUp={e => !isDownloading && (e.currentTarget.style.transform = 'scale(1)')}
          >
            <Icons.Download />
          </button>
          {(isDownloading || downloadProgress) && (
            <span style={{ color: '#1db954', fontSize: '13px', fontWeight: 600 }}>{downloadProgress}</span>
          )}
        </div>
      </div>

      {/* Tracklist */}
      <div className="playlist-tracks">
        {isLoadingSongs ? (
          <div style={{ color: 'white', padding: 24, textAlign: 'center' }}>Loading songs...</div>
        ) : (
          activeSongs.map((song, index) => (
            <TrackListItem
              key={`pl-${song.id}-${index}`}
              song={song}
              index={index}
              isActive={currentSong?.id === song.id}
              onClick={() => onSelectSong(song, activeSongs)}
              onRemove={onRemoveSong ? () => onRemoveSong(song) : undefined}
            />
          ))
        )}
      </div>
    </div>
  );
}
