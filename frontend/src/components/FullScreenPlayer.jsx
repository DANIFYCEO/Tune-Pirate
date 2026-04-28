import { useEffect, useState, useRef } from 'react';
import { useDownload } from '../hooks/useDownload';

const FALLBACK = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Crect width='300' height='300' fill='%23222'/%3E%3Ccircle cx='150' cy='150' r='60' fill='%23444'/%3E%3Ccircle cx='150' cy='150' r='20' fill='%23222'/%3E%3C/svg%3E";

const Icons = {
  Down:       () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>,
  Play:       () => <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>,
  Pause:      () => <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>,
  Prev:       () => <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5" stroke="currentColor" strokeWidth="2"/></svg>,
  Next:       () => <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" strokeWidth="2"/></svg>,
  Shuffle:    ({ active }) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={active ? "#1db954" : "white"} strokeWidth="2"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>,
  Repeat:     ({ active, mode }) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={active ? "#1db954" : "white"} strokeWidth="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>{mode === 2 && <text x="10" y="16" fontSize="10" fill="#1db954" stroke="none">1</text>}</svg>,
  Heart:      ({ filled }) => <svg width="22" height="22" viewBox="0 0 24 24" fill={filled ? "#1db954" : "none"} stroke={filled ? "#1db954" : "rgba(255,255,255,0.6)"} strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>,
  Download:   () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
  Lyrics:     () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
  Timer:      () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  AddAlbum:   () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>,
  Close:      () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  Check:      () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1db954" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>,
  Share:      () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>,
  Queue:      () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>,
  Artist:     () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  Copy:       () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>,
  Dots:       () => <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>,
};

function formatTime(s) {
  if (isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec < 10 ? '0' : ''}${sec}`;
}

export default function FullScreenPlayer({
  isOpen, onClose,
  currentSong, queue,
  isPlaying, onTogglePlay, onNext, onPrev,
  isShuffle, onToggleShuffle,
  repeatMode, onCycleRepeat,
  currentTime, duration, onSeek,
  volume, onVolumeChange,
  isLiked, onToggleLike,
  lyrics, activeLyricIndex,
  onShowLyrics, showLyrics, onHideLyrics,
  ytPlayerRef,
  onSelectSong,
  customPlaylists,
  onAddToPlaylist
}) {
  const [relatedSongs, setRelatedSongs] = useState([]);
  const [showSleepModal, setShowSleepModal] = useState(false);
  const [sleepTimer, setSleepTimer] = useState(null);
  const [sleepTimerSet, setSleepTimerSet] = useState(null);
  const [addedToLibrary, setAddedToLibrary] = useState(false);
  const [showArtistSongs, setShowArtistSongs] = useState(false);
  const [artistInfo, setArtistInfo] = useState(null);
  const [showOptionsMenu, setShowOptionsMenu] = useState(false);
  const [showPlaylistSelector, setShowPlaylistSelector] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const scrollRef = useRef(null);
  const sleepIntervalRef = useRef(null);
  const { startDownload } = useDownload();

  const SLEEP_OPTIONS = [5, 10, 15, 30, 45, 60];

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  // Find which playlist/context we're in
  const queueName = queue?.length > 0 ? 'Queue' : null;

  // Fetch related songs and artist info by artist when song changes
  useEffect(() => {
    if (!currentSong?.artist) return;
    setRelatedSongs([]);
    setArtistInfo(null);
    const artist = currentSong.artist.split(',')[0].trim();
    const encodedArtist = encodeURIComponent(artist);
    
    // Fetch related songs
    fetch(`${import.meta.env.VITE_API_URL}/api/because-you-listened?artist=${encodedArtist}`)
      .then(r => r.json())
      .then(d => setRelatedSongs((d.songs || []).filter(s => s.id !== currentSong.id).slice(0, 6)))
      .catch(() => {});
      
    // Fetch artist info
    fetch(`${import.meta.env.VITE_API_URL}/api/artist-info/${encodedArtist}`)
      .then(r => r.json())
      .then(d => {
        if (!d.error) setArtistInfo(d);
      })
      .catch(() => {});
  }, [currentSong?.artist, currentSong?.id]);

  // Reset scroll when song changes
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [currentSong?.id]);

  // Sleep timer
  const startSleepTimer = (minutes) => {
    setSleepTimerSet(minutes);
    setSleepTimer(minutes * 60); // store in seconds
    setShowSleepModal(false);
    clearInterval(sleepIntervalRef.current);
    sleepIntervalRef.current = setInterval(() => {
      setSleepTimer(prev => {
        if (prev <= 1) {
          clearInterval(sleepIntervalRef.current);
          // pause music
          onTogglePlay?.();
          return null;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const cancelSleepTimer = () => {
    clearInterval(sleepIntervalRef.current);
    setSleepTimer(null);
    setSleepTimerSet(null);
  };

  // Format sleep countdown
  const formatSleep = (s) => {
    if (!s) return '';
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec < 10 ? '0' : ''}${sec}`;
  };

  // Handle add to library feedback
  const handleAddToLibrary = () => {
    if (currentSong) {
      onToggleLike?.(currentSong);
      setAddedToLibrary(true);
      setTimeout(() => setAddedToLibrary(false), 2000);
    }
  };

  // Cleanup sleep timer on unmount
  useEffect(() => () => clearInterval(sleepIntervalRef.current), []);

  // Close lyrics when player closes
  useEffect(() => {
    if (!isOpen) onHideLyrics?.();
  }, [isOpen]);

  if (!currentSong) return null;

  const artistFirstName = currentSong.artist?.split(' ')[0];

  return (
    <div className={`fsp-overlay ${isOpen ? 'open' : ''}`}>
      {/* Full blurred album art background */}
      <div
        className="fsp-bg"
        style={{ backgroundImage: `url(${currentSong.cover || FALLBACK})` }}
      />
      <div className="fsp-bg-dim" />

      {/* Scrollable content */}
      <div className="fsp-scroll" ref={scrollRef}>

        {/* ── HERO SECTION ── */}
        <div className="fsp-hero">
          {/* Top bar */}
          <div className="fsp-topbar">
            <button className="fsp-icon-btn" onClick={onClose}>
              <Icons.Down />
            </button>
            <div className="fsp-topbar-center">
              {queueName && <div className="fsp-playing-from">PLAYING FROM {queueName.toUpperCase()}</div>}
              <div className="fsp-context-name">{currentSong.title}</div>
            </div>
            <button
              className="fsp-icon-btn"
              onClick={() => setShowOptionsMenu(true)}
            >
              <Icons.Dots />
            </button>
          </div>

          {/* Large album art — centred in hero */}
          <div className="fsp-artwork-wrap">
            <img
              src={currentSong.cover || FALLBACK}
              alt="cover"
              className="fsp-artwork"
              referrerPolicy="no-referrer"
            />
          </div>

          {/* Current lyric line over artwork */}
          {Array.isArray(lyrics) && activeLyricIndex >= 0 && (
            <div className="fsp-canvas-lyric">
              {lyrics[activeLyricIndex]?.text}
            </div>
          )}

          {/* Song info + actions */}
          <div className="fsp-song-row">
            <img
              src={currentSong.cover || FALLBACK}
              alt="cover"
              className="fsp-mini-cover"
              referrerPolicy="no-referrer"
            />
            <div className="fsp-song-text">
              <div className="fsp-song-title">{currentSong.title}</div>
              <div className="fsp-song-artist">{currentSong.artist}</div>
            </div>
            <button
              className={`fsp-action-btn ${isLiked ? 'liked' : ''}`}
              onClick={() => onToggleLike(currentSong)}
            >
              <Icons.Heart filled={isLiked} />
            </button>
          </div>

          {/* Progress bar */}
          <div className="fsp-progress-area">
            <div
              className="fsp-progress-bg"
              onClick={onSeek}
            >
              <div className="fsp-progress-fill" style={{ width: `${progressPercent}%` }}>
                <div className="fsp-progress-thumb" />
              </div>
            </div>
            <div className="fsp-progress-times">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* Playback controls */}
          <div className="fsp-controls">
            <button className="fsp-ctrl-btn" onClick={onToggleShuffle}>
              <Icons.Shuffle active={isShuffle} />
            </button>
            <button className="fsp-ctrl-btn fsp-ctrl-skip" onClick={onPrev}>
              <Icons.Prev />
            </button>
            <button className="fsp-play-btn" onClick={onTogglePlay}>
              {isPlaying ? <Icons.Pause /> : <Icons.Play />}
            </button>
            <button className="fsp-ctrl-btn fsp-ctrl-skip" onClick={onNext}>
              <Icons.Next />
            </button>
            <button className="fsp-ctrl-btn" onClick={onCycleRepeat}>
              <Icons.Repeat active={repeatMode > 0} mode={repeatMode} />
            </button>
          </div>

          {/* Bottom action row - Lyrics / Sleep / Add to Album */}
          <div className="fsp-bottom-row">
            <button
              className={`fsp-text-btn ${showLyrics ? 'active' : ''}`}
              onClick={showLyrics ? onHideLyrics : onShowLyrics}
            >
              <Icons.Lyrics />
              <span>Lyrics</span>
            </button>
            <button
              className={`fsp-text-btn ${sleepTimer ? 'active' : ''}`}
              onClick={() => sleepTimer ? cancelSleepTimer() : setShowSleepModal(true)}
            >
              <Icons.Timer />
              <span>{sleepTimer ? formatSleep(sleepTimer) : 'Sleep'}</span>
            </button>
            <button
              className={`fsp-text-btn ${isLiked ? 'active' : ''}`}
              onClick={handleAddToLibrary}
            >
              {isLiked ? <Icons.Check /> : <Icons.AddAlbum />}
              <span>{isLiked ? 'Saved' : 'Add'}</span>
            </button>
          </div>
        </div>

        {/* ── LYRICS CARD (inline, below hero) ── */}
        {Array.isArray(lyrics) && lyrics.length > 0 && (
          <div className="fsp-card fsp-lyrics-card">
            <div className="fsp-card-header">
              <span className="fsp-card-title">Lyrics preview</span>
            </div>
            <div className="fsp-lyrics-preview">
              {lyrics.slice(Math.max(0, activeLyricIndex - 1), activeLyricIndex + 4).map((line, i) => (
                <div
                  key={i}
                  className={`fsp-preview-line ${activeLyricIndex >= 0 && i === (activeLyricIndex > 0 ? 1 : 0) ? 'active' : ''}`}
                  onClick={() => { ytPlayerRef?.current?.seekTo(line.time); }}
                >
                  {line.text}
                </div>
              ))}
            </div>
            <button className="fsp-show-lyrics-btn" onClick={onShowLyrics}>
              Show lyrics
            </button>
          </div>
        )}

        {/* ── EXPLORE ARTIST CARD ── */}
        {relatedSongs.length > 0 && (
          <div className="fsp-card">
            <div className="fsp-card-header fsp-card-header-btn" onClick={() => setShowArtistSongs(true)}>
              <span className="fsp-card-title">Explore {currentSong.artist?.split(',')[0].trim()}</span>
              <span className="fsp-card-see-all">See all →</span>
            </div>
            <div className="fsp-explore-grid">
              {relatedSongs.slice(0, 3).map((song, i) => (
                <div
                  key={song.id || i}
                  className="fsp-explore-item"
                  onClick={() => { onSelectSong?.(song, relatedSongs); }}
                >
                  <img
                    src={song.cover || FALLBACK}
                    alt={song.title}
                    referrerPolicy="no-referrer"
                  />
                  <div className="fsp-explore-label">{song.title}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── ABOUT ARTIST CARD ── */}
        {artistInfo && (
          <div className="fsp-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ position: 'relative', height: 200 }}>
              <img 
                src={artistInfo.image || FALLBACK} 
                alt={artistInfo.name}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                referrerPolicy="no-referrer"
              />
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.9), transparent)' }} />
              <div style={{ position: 'absolute', bottom: 16, left: 16, right: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4, color: 'rgba(255,255,255,0.7)' }}>About the artist</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: 'white', marginBottom: 4 }}>{artistInfo.name}</div>
                <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
                  {artistInfo.monthlyListeners || `${artistInfo.subscribers || 'Unknown'} subscribers`}
                </div>
              </div>
            </div>
            {artistInfo.description && (
              <div style={{ padding: 16, fontSize: 14, color: 'rgba(255,255,255,0.8)', lineHeight: 1.5, maxHeight: 100, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical' }}>
                {artistInfo.description}
              </div>
            )}
          </div>
        )}

        <div style={{ height: 40 }} />
      </div>

      {/* ── OPTIONS MENU (three dots) ── */}
      {showOptionsMenu && (
        <div className="fsp-modal-backdrop" onClick={() => setShowOptionsMenu(false)}>
          <div className="fsp-options-sheet" onClick={e => e.stopPropagation()}>
            {/* Song identity header */}
            <div className="fsp-options-song-header">
              <img
                src={currentSong.cover || FALLBACK}
                alt="cover"
                className="fsp-options-cover"
                referrerPolicy="no-referrer"
              />
              <div className="fsp-options-song-info">
                <div className="fsp-options-song-title">{currentSong.title}</div>
                <div className="fsp-options-song-artist">{currentSong.artist}</div>
              </div>
            </div>

            <div className="fsp-options-divider" />

            {/* Actions */}
            <button className="fsp-option-item" onClick={() => {
              onToggleLike?.(currentSong);
              setShowOptionsMenu(false);
            }}>
              <span className="fsp-option-icon" style={{ color: isLiked ? '#1db954' : 'white' }}>
                <Icons.Heart filled={isLiked} />
              </span>
              <span>{isLiked ? 'Remove from liked songs' : 'Save to liked songs'}</span>
            </button>

            <button className="fsp-option-item" onClick={() => {
              if (!isLiked) onToggleLike?.(currentSong);
              startDownload(currentSong);
              setShowOptionsMenu(false);
            }}>
              <span className="fsp-option-icon">
                <Icons.Download />
              </span>
              <span>Download song</span>
            </button>

            {customPlaylists && customPlaylists.length > 0 && (
              <button className="fsp-option-item" onClick={() => {
                setShowOptionsMenu(false);
                setShowPlaylistSelector(true);
              }}>
                <span className="fsp-option-icon"><Icons.Queue /></span>
                <span>Add to playlist</span>
              </button>
            )}

            <button className="fsp-option-item" onClick={() => {
              // Add current song to end of queue (via onNext pre-queuing)
              // Just show artists songs for now
              setShowOptionsMenu(false);
              setShowArtistSongs(true);
            }}>
              <span className="fsp-option-icon"><Icons.Queue /></span>
              <span>Go to artist</span>
            </button>

            <button className="fsp-option-item" onClick={() => {
              setShowOptionsMenu(false);
              onShowLyrics?.();
            }}>
              <span className="fsp-option-icon"><Icons.Lyrics /></span>
              <span>View lyrics</span>
            </button>

            <button className="fsp-option-item" onClick={() => {
              setShowOptionsMenu(false);
              setShowSleepModal(true);
            }}>
              <span className="fsp-option-icon"><Icons.Timer /></span>
              <span>{sleepTimer ? `Sleep: ${formatSleep(sleepTimer)} left — cancel` : 'Sleep timer'}</span>
            </button>

            <button className="fsp-option-item" onClick={() => {
              const text = `${currentSong.title} — ${currentSong.artist}`;
              if (navigator.share) {
                navigator.share({ title: currentSong.title, text }).catch(() => {});
              } else {
                navigator.clipboard?.writeText(text).then(() => {
                  setCopyFeedback(true);
                  setTimeout(() => setCopyFeedback(false), 2000);
                });
              }
              setShowOptionsMenu(false);
            }}>
              <span className="fsp-option-icon"><Icons.Share /></span>
              <span>Share</span>
            </button>

            <button className="fsp-option-item" onClick={() => {
              navigator.clipboard?.writeText(
                `${currentSong.title} by ${currentSong.artist}`
              ).then(() => {
                setCopyFeedback(true);
                setTimeout(() => setCopyFeedback(false), 2000);
              });
              setShowOptionsMenu(false);
            }}>
              <span className="fsp-option-icon"><Icons.Copy /></span>
              <span>Copy song info</span>
            </button>

            <button className="fsp-options-cancel" onClick={() => setShowOptionsMenu(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Copy feedback toast */}
      {copyFeedback && (
        <div className="fsp-toast">Copied to clipboard ✓</div>
      )}

      {/* ── ARTIST SONGS OVERLAY ── */}
      {showArtistSongs && (
        <div className="fsp-artist-overlay">
          <div className="fsp-lyrics-header">
            <span className="fsp-lyrics-header-title">
              {currentSong.artist?.split(',')[0].trim()}
            </span>
            <button className="fsp-icon-btn" onClick={() => setShowArtistSongs(false)}>
              <Icons.Close />
            </button>
          </div>
          <div className="fsp-lyrics-scroll">
            {relatedSongs.length === 0 ? (
              <div className="fsp-lyric-plain" style={{ opacity: 0.4 }}>Loading…</div>
            ) : (
              relatedSongs.map((song, idx) => (
                <div
                  key={song.id || idx}
                  className="fsp-artist-song-row"
                  onClick={() => {
                    onSelectSong?.(song, relatedSongs);
                    setShowArtistSongs(false);
                  }}
                >
                  <img
                    src={song.cover || FALLBACK}
                    alt={song.title}
                    className="fsp-artist-song-cover"
                    referrerPolicy="no-referrer"
                  />
                  <div className="fsp-artist-song-info">
                    <div className="fsp-artist-song-title">{song.title}</div>
                    <div className="fsp-artist-song-artist">{song.artist}</div>
                  </div>
                  <div className="fsp-artist-song-play">
                    <Icons.Play />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ── SLEEP TIMER MODAL ── */}
      {showSleepModal && (
        <div className="fsp-modal-backdrop" onClick={() => setShowSleepModal(false)}>
          <div className="fsp-modal" onClick={e => e.stopPropagation()}>
            <div className="fsp-modal-header">
              <span className="fsp-modal-title">Sleep timer</span>
              <button className="fsp-icon-btn" onClick={() => setShowSleepModal(false)}>
                <Icons.Close />
              </button>
            </div>
            <p className="fsp-modal-sub">Music pauses after selected time</p>
            <div className="fsp-sleep-options">
              {SLEEP_OPTIONS.map(min => (
                <button
                  key={min}
                  className="fsp-sleep-option"
                  onClick={() => startSleepTimer(min)}
                >
                  {min} min
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── LYRICS FULL OVERLAY ── */}
      <div className={`fsp-lyrics-overlay ${showLyrics ? 'show' : ''}`}>
        <div className="fsp-lyrics-header">
          <span className="fsp-lyrics-header-title">{currentSong.title}</span>
          <button className="fsp-icon-btn" onClick={onHideLyrics}><Icons.Close /></button>
        </div>
        <div className="fsp-lyrics-scroll">
          {typeof lyrics === 'string'
            ? <div className="fsp-lyric-plain">{lyrics}</div>
            : Array.isArray(lyrics)
              ? lyrics.map((line, idx) => (
                  <div
                    key={idx}
                    className={`fsp-lyric-line ${idx === activeLyricIndex ? 'active' : ''}`}
                    onClick={() => { ytPlayerRef?.current?.seekTo(line.time); }}
                  >
                    {line.text}
                  </div>
                ))
              : <div className="fsp-lyric-plain" style={{ opacity: 0.4 }}>Loading lyrics…</div>
          }
        </div>
      </div>
    </div>
  );
}
