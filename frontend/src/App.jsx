import { useState, useEffect, useCallback, useRef } from 'react';
import './index.css';
import './App.css';
import './lyrics.css';
import { useListenHistory } from './hooks/useListenHistory';
import { useLibrary } from './hooks/useLibrary';
import { getOfflineData } from './hooks/useOfflineStorage';
import { useDownload } from './hooks/useDownload';
import HomePage from './pages/HomePage';
import SearchPage from './pages/SearchPage';
import AIPage from './pages/AIPage';
import TrackCard from './components/TrackCard';
import PlaylistPage from './pages/PlaylistPage';
import CompactPlaylistCard from './components/CompactPlaylistCard';
import FullScreenPlayer from './components/FullScreenPlayer';
import './components/FullScreenPlayer.css';
import SplashScreen from './components/SplashScreen';
import { App as CapApp } from '@capacitor/app';

const Icons = {
  Home:     () => <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>,
  Search:   () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  Library:  () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>,
  AI:       () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
  Play:     () => <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>,
  Pause:    () => <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>,
  SkipBack: () => <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><polygon points="19 20 9 12 19 4 19 20"/></svg>,
  SkipFwd:  () => <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 4 15 12 5 20 5 4"/></svg>,
  Lyrics:   () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
  Download: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
  ChevronDown: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"></polyline></svg>,
  Close:    () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>,
  Repeat:   ({ active, mode }) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={active ? "#1db954" : "currentColor"} strokeWidth="2"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path>{mode === 2 && <text x="10" y="16" fontSize="10" fill="#1db954" stroke="none">1</text>}</svg>,
  Shuffle:  ({ active }) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={active ? "#1db954" : "currentColor"} strokeWidth="2"><polyline points="16 3 21 3 21 8"></polyline><line x1="4" y1="20" x2="21" y2="3"></line><polyline points="21 16 21 21 16 21"></polyline><line x1="15" y1="15" x2="21" y2="21"></line><line x1="4" y1="4" x2="9" y2="9"></line></svg>,
  Volume:   () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>,
  Heart:    ({ filled }) => <svg width="24" height="24" viewBox="0 0 24 24" fill={filled ? "#1db954" : "none"} stroke={filled ? "#1db954" : "currentColor"} strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>,
};

const FALLBACK = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Crect width='300' height='300' fill='%23222'/%3E%3Ccircle cx='150' cy='150' r='60' fill='%23444'/%3E%3Ccircle cx='150' cy='150' r='20' fill='%23222'/%3E%3C/svg%3E";

const NAV_ITEMS = [
  { key: 'home',    label: 'Home',    Icon: Icons.Home },
  { key: 'search',  label: 'Search',  Icon: Icons.Search },
  { key: 'library', label: 'Library', Icon: Icons.Library },
  { key: 'ai',      label: 'AI',      Icon: Icons.AI },
];

function DownloadOverlay() {
  const { downloads, cancelDownload } = useDownload();
  if (!downloads || downloads.length === 0) return null;

  return (
    <div className="download-overlay">
      {downloads.map(d => (
        <div key={d.id} className="download-toast">
          <img src={d.cover} alt="" className="download-toast-cover" />
          <div className="download-toast-info">
            <div className="download-toast-title">{d.title}</div>
            {d.status === 'downloading' ? (
              <div className="download-toast-progress-bg">
                <div className="download-toast-progress-fill" style={{ width: `${d.progress}%` }} />
              </div>
            ) : d.status === 'completed' ? (
              <div style={{ color: '#1db954', fontSize: 12 }}>Completed</div>
            ) : (
              <div style={{ color: '#ff4444', fontSize: 12 }}>Error</div>
            )}
          </div>
          {d.status === 'downloading' && (
            <button className="download-toast-cancel" onClick={() => cancelDownload(d.id)}>
              <Icons.Close />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function formatTime(seconds) {
  if (isNaN(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export default function App() {
  const [showSplash, setShowSplash] = useState(true);
  const [currentSong, setCurrentSong]   = useState(null);
  const [isPlaying, setIsPlaying]       = useState(false);
  const [isPlayerExpanded, setIsPlayerExpanded] = useState(false);
  const [activeNav, setActiveNav]       = useState('home');
  const [searchQuery, setSearchQuery]   = useState("");
  const [activePlaylist, setActivePlaylist] = useState(null);
  const [showCreatePlaylist, setShowCreatePlaylist] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  
  const { history, addToHistory, topArtists } = useListenHistory();
  const { 
    likedSongs, 
    toggleLike, 
    isLiked, 
    likedPlaylists, 
    likedSongsPlaylist,
    isPlaylistLiked,
    toggleLikePlaylist,
    removeSongFromPlaylist,
    createPlaylist
  } = useLibrary();
  
  // Queue State
  const [queue, setQueue] = useState([]);
  const [queueIndex, setQueueIndex] = useState(-1);
  const [isShuffle, setIsShuffle] = useState(false);
  const [repeatMode, setRepeatMode] = useState(0); // 0: off, 1: all, 2: one

  // YouTube Player State
  const [ytPlayer, setYtPlayer] = useState(null);
  const ytPlayerRef = useRef(null); // ref so callbacks always see latest player
  const iframeContainerRef = useRef(null);
  
  // Offline Player State
  const audioRef = useRef(null);
  const [isOfflinePlayer, setIsOfflinePlayer] = useState(false);
  const [offlineCover, setOfflineCover] = useState(null);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(100);
  const volumeRef = useRef(100);
  const handleNextRef = useRef(null); // ref to avoid stale closure in YT callback
  useEffect(() => { volumeRef.current = volume; }, [volume]);

  // Lyrics State
  const [showLyrics, setShowLyrics] = useState(false);
  const [lyrics, setLyrics] = useState(null);
  const lyricsContainerRef = useRef(null);
  
  // Background State
  const [homeBgImages, setHomeBgImages] = useState([]);
  const [bgIndex, setBgIndex] = useState(0);

  // Fetch ambient background images
  useEffect(() => {
    fetch(`${import.meta.env.VITE_API_URL}/api/trending`)
      .then(res => res.json())
      .then(data => {
        if (data.songs?.length) setHomeBgImages(data.songs.map(s => s.cover).filter(Boolean));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (isPlayerExpanded || !homeBgImages.length) return;
    const interval = setInterval(() => setBgIndex(p => (p + 1) % homeBgImages.length), 6000);
    return () => clearInterval(interval);
  }, [homeBgImages, isPlayerExpanded]);

  useEffect(() => {
    const bg = document.querySelector('.ambient-background');
    if (!bg) return;
    if (isPlayerExpanded && (offlineCover || currentSong?.cover)) bg.style.backgroundImage = `url(${offlineCover || currentSong.cover})`;
    else if (homeBgImages.length) bg.style.backgroundImage = `url(${homeBgImages[bgIndex]})`;
  }, [isPlayerExpanded, currentSong, bgIndex, homeBgImages, offlineCover]);

  // ── Android Back Button Handler ──
  useEffect(() => {
    const handler = CapApp.addListener('backButton', () => {
      if (isPlayerExpanded) {
        setIsPlayerExpanded(false);
      } else if (showLyrics) {
        setShowLyrics(false);
      } else if (activePlaylist) {
        setActivePlaylist(null);
      } else if (activeNav !== 'home') {
        setActiveNav('home');
        setSearchQuery('');
      }
      // If already on home with nothing open, do nothing (don't exit app)
    });
    return () => { handler.then(h => h.remove()); };
  }, [isPlayerExpanded, showLyrics, activePlaylist, activeNav]);

  // Fetch Lyrics logic moved to loadSong effect

  // Progress Loop
  useEffect(() => {
    let interval;
    if (isPlaying && ytPlayer && !isOfflinePlayer) {
      interval = setInterval(async () => {
        try { setCurrentTime(await ytPlayer.getCurrentTime()); } catch {}
      }, 500);
    }
    return () => clearInterval(interval);
  }, [isPlaying, ytPlayer, isOfflinePlayer]);

  // Sync Lyrics Scroll
  useEffect(() => {
    if (!showLyrics || !Array.isArray(lyrics) || !lyricsContainerRef.current) return;
    const activeIdx = lyrics.findIndex((l, i) => {
      const next = lyrics[i + 1];
      return currentTime >= l.time && (!next || currentTime < next.time);
    });
    if (activeIdx !== -1) {
      const activeEl = lyricsContainerRef.current.children[activeIdx];
      if (activeEl) activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentTime, showLyrics, lyrics]);

  // ── QUEUE & AUTO-PLAY LOGIC ──
  
  const handleSongSelect = useCallback((song, sourceList = []) => {
    setCurrentSong(song);
    setIsPlaying(true);
    addToHistory(song);
    
    // Set queue context
    if (sourceList.length > 0) {
      setQueue(sourceList);
      setQueueIndex(sourceList.findIndex(s => s.id === song.id));
    } else {
      setQueue([song]);
      setQueueIndex(0);
    }
    
    setSearchQuery("");
    if (activeNav === 'search') setActiveNav('home');
  }, [addToHistory, activeNav]);

  const handleNext = useCallback(() => {
    if (queue.length === 0) return;
    if (repeatMode === 2) {
      ytPlayerRef.current?.seekTo(0);
      return;
    }
    let nextIdx = queueIndex + 1;
    if (isShuffle) {
      nextIdx = Math.floor(Math.random() * queue.length);
    } else if (nextIdx >= queue.length) {
      if (repeatMode === 1) nextIdx = 0;
      else return; // end of queue
    }
    setQueueIndex(nextIdx);
    const nextSong = queue[nextIdx];
    setCurrentSong(nextSong);
    addToHistory(nextSong);
  }, [queue, queueIndex, isShuffle, repeatMode, addToHistory]);

  // Keep refs pointing to latest handlers for async APIs (YT, MediaSession)
  const handlePrevRef = useRef(null);
  const togglePlayRef = useRef(null);
  
  useEffect(() => { handleNextRef.current = handleNext; }, [handleNext]);

  const handlePrev = useCallback(() => {
    if (currentTime > 3) {
      ytPlayer?.seekTo(0);
      return;
    }
    if (queue.length === 0) return;
    let prevIdx = queueIndex - 1;
    if (prevIdx < 0) prevIdx = queue.length - 1;
    setQueueIndex(prevIdx);
    const prevSong = queue[prevIdx];
    setCurrentSong(prevSong);
    addToHistory(prevSong);
  }, [queue, queueIndex, currentTime, ytPlayer, addToHistory]);

  useEffect(() => { handlePrevRef.current = handlePrev; }, [handlePrev]);

  // onPlayerStateChange is now handled inside the direct IFrame API hook above

  const togglePlay = (e) => {
    e?.stopPropagation();
    if (isOfflinePlayer && audioRef.current) {
      if (isPlaying) audioRef.current.pause();
      else audioRef.current.play();
      setIsPlaying(!isPlaying);
      return;
    }

    if (!ytPlayer) return;
    if (isPlaying) ytPlayer.pauseVideo();
    else ytPlayer.playVideo();
    setIsPlaying(!isPlaying);
  };

  useEffect(() => { togglePlayRef.current = togglePlay; }, [togglePlay]);

  const handleSeek = (e) => {
    if (!duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    const newTime = percent * duration;
    
    if (isOfflinePlayer && audioRef.current) {
      audioRef.current.currentTime = newTime;
    } else if (ytPlayer) {
      ytPlayer.seekTo(newTime);
    }
    setCurrentTime(newTime);
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  // Lyrics sync: offset to compensate for audio stream latency
  const LYRIC_OFFSET = 0.5;
  let activeLyricIndex = -1;
  if (Array.isArray(lyrics)) {
    const adjustedTime = currentTime + LYRIC_OFFSET;
    activeLyricIndex = lyrics.findIndex((l, i) => {
      const next = lyrics[i + 1];
      return adjustedTime >= l.time && (!next || adjustedTime < next.time);
    });
  }

  // Volume handler
  useEffect(() => {
    if (isOfflinePlayer && audioRef.current) {
      audioRef.current.volume = volume / 100;
    } else {
      try { if (ytPlayer) ytPlayer.setVolume(volume); } catch {}
    }
  }, [volume, ytPlayer, isOfflinePlayer]);

  // ── Media Session API (OS Notification Player) ──
  useEffect(() => {
    if ('mediaSession' in navigator && currentSong) {
      const activeCover = offlineCover || currentSong.cover;
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentSong.title,
        artist: currentSong.artist,
        album: 'Tune Pirate',
        artwork: [
          { src: activeCover, sizes: '96x96', type: 'image/jpeg' },
          { src: activeCover, sizes: '128x128', type: 'image/jpeg' },
          { src: activeCover, sizes: '192x192', type: 'image/jpeg' },
          { src: activeCover, sizes: '256x256', type: 'image/jpeg' },
          { src: activeCover, sizes: '384x384', type: 'image/jpeg' },
          { src: activeCover, sizes: '512x512', type: 'image/jpeg' },
        ]
      });

      try {
        navigator.mediaSession.setActionHandler('play', () => togglePlayRef.current && togglePlayRef.current());
        navigator.mediaSession.setActionHandler('pause', () => togglePlayRef.current && togglePlayRef.current());
        navigator.mediaSession.setActionHandler('previoustrack', () => handlePrevRef.current && handlePrevRef.current());
        navigator.mediaSession.setActionHandler('nexttrack', () => handleNextRef.current && handleNextRef.current());
      } catch (error) {
        console.warn("MediaSession API actions not fully supported.", error);
      }
    }
  }, [currentSong, offlineCover]);

  // ── Direct YouTube IFrame API Hook ──
  useEffect(() => {
    // Load the YouTube IFrame API script once
    if (!window.YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.body.appendChild(tag);
    }

    const initPlayer = () => {
      if (!iframeContainerRef.current) return;
      const player = new window.YT.Player(iframeContainerRef.current, {
        height: '0',
        width: '0',
        videoId: 'M7lc1UVf-VE',
        playerVars: {
          autoplay: 0,
          controls: 0,
          playsinline: 1,
          modestbranding: 1,
          origin: window.location.origin,
          enablejsapi: 1,
        },
        events: {
          onReady: (e) => {
            ytPlayerRef.current = e.target;
            setYtPlayer(e.target);
            try { e.target.setVolume(volumeRef.current); } catch {}
          },
          onStateChange: (e) => {
            if (e.data === 1) {
              setIsPlaying(true);
              try { setDuration(e.target.getDuration()); } catch {}
            } else if (e.data === 2) {
              setIsPlaying(false);
            } else if (e.data === 0) {
              // Use ref so we always call the latest handleNext (avoids stale closure)
              handleNextRef.current?.();
            }
          },
        },
      });
    };

    if (window.YT && window.YT.Player) {
      initPlayer();
    } else {
      window.onYouTubeIframeAPIReady = initPlayer;
    }

    // Cleanup: destroy player on unmount
    return () => {
      try { ytPlayerRef.current?.destroy(); } catch {}
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load a new video or offline audio whenever currentSong changes
  useEffect(() => {
    const loadSong = async () => {
      const player = ytPlayerRef.current;
      if (!currentSong) {
        if (player) try { player.stopVideo(); } catch {}
        if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; }
        return;
      }

      // Check offline storage first
      const offlineData = await getOfflineData(currentSong.id);
      if (offlineData && offlineData.audio && audioRef.current) {
        setIsOfflinePlayer(true);
        if (player) try { player.pauseVideo(); } catch {}
        audioRef.current.src = URL.createObjectURL(offlineData.audio);
        audioRef.current.play();
        setIsPlaying(true);
        
        if (offlineData.cover) setOfflineCover(URL.createObjectURL(offlineData.cover));
        else setOfflineCover(null);
        
        if (offlineData.lyrics) setLyrics(offlineData.lyrics);
        else setLyrics("Lyrics not available.");
      } else {
        setIsOfflinePlayer(false);
        setOfflineCover(null);
        if (audioRef.current) audioRef.current.pause();
        if (player) {
          try { player.loadVideoById(currentSong.id); } catch {}
        }
        
        // Fetch Lyrics normally
        setLyrics(null);
        try {
          const title = encodeURIComponent(currentSong.title.split('(')[0].trim());
          const artist = encodeURIComponent(currentSong.artist.split(',')[0].trim());
          const lrRes = await fetch(`https://lrclib.net/api/search?track_name=${title}&artist_name=${artist}`);
          if (lrRes.ok) {
            const data = await lrRes.json();
            if (data?.length) {
              const track = data[0];
              if (track.syncedLyrics) {
                const lines = track.syncedLyrics.split('\n').map(line => {
                  const match = line.match(/\[(\d+):(\d+\.\d+)\](.*)/);
                  return match ? { time: parseInt(match[1]) * 60 + parseFloat(match[2]), text: match[3].trim() } : null;
                }).filter(l => l?.text);
                setLyrics(lines);
              } else if (track.plainLyrics) {
                setLyrics(track.plainLyrics);
              } else setLyrics("Lyrics not available.");
            } else setLyrics("Lyrics not available.");
          } else setLyrics("Lyrics not available.");
        } catch { setLyrics("Lyrics not available."); }
      }
    };
    loadSong();
  }, [currentSong]);

  return (
    <>
      {showSplash && <SplashScreen onComplete={() => setShowSplash(false)} />}
      <DownloadOverlay />
      
      <div className={`app-container ${showSplash ? 'hidden' : ''}`}>
        <div className="ambient-background" />
        <div className="ambient-overlay" />

      {/* Hidden YouTube IFrame API Player - managed directly to prevent postMessage race conditions */}
      <div style={{ display: 'none' }}>
        <div ref={iframeContainerRef} />
      </div>

      {/* Offline Audio Player */}
      <audio 
        ref={audioRef} 
        onTimeUpdate={() => setCurrentTime(audioRef.current.currentTime)}
        onDurationChange={() => setDuration(audioRef.current.duration)}
        onEnded={() => handleNextRef.current?.()}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        style={{ display: 'none' }}
      />

      {/* Mobile Header */}
      {!activePlaylist && (
        <div className="mobile-header">
          <div className="logo">
            <img src="/logo.png" alt="Tune Pirate" style={{ width: 28, height: 28, borderRadius: 8 }} />
            Tune Pirate
          </div>
        </div>
      )}

      <div className="app-layout">
        {/* Desktop Sidebar */}
        <aside className="desktop-sidebar glass-panel">
          <div className="logo"><img src="/logo.png" alt="Tune Pirate" style={{ width: 34, height: 34, borderRadius: 10 }} />Tune Pirate</div>
          <nav className="nav-menu">
            {NAV_ITEMS.map(({ key, label, Icon }) => (
              <div key={key} className={`nav-link ${activeNav === key ? 'active' : ''}`} style={key === 'ai' ? { marginTop: 16 } : {}}
                onClick={() => { setActiveNav(key); setActivePlaylist(null); if (key !== 'search') setSearchQuery(''); }}>
                <Icon /> {label}
              </div>
            ))}
          </nav>
        </aside>

        {/* Main Content */}
        <main className="main-view" style={{ position: 'relative' }}>
          {!activePlaylist && (
            <div className="search-container">
              <input className="search-input" placeholder="Search songs, artists, lyrics…" type="text" value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setActiveNav('search'); setActivePlaylist(null); }} />
            </div>
          )}

          {!activePlaylist && activeNav === 'home' && <HomePage onSelectSong={handleSongSelect} onSelectPlaylist={setActivePlaylist} currentSong={currentSong} history={history} topArtists={topArtists} likedSongsPlaylist={likedSongsPlaylist} />}
          {!activePlaylist && activeNav === 'search' && <SearchPage searchQuery={searchQuery} onSelectSong={handleSongSelect} onSelectPlaylist={setActivePlaylist} currentSong={currentSong} />}
          {!activePlaylist && activeNav === 'ai' && <AIPage onSelectSong={handleSongSelect} onSelectPlaylist={setActivePlaylist} currentSong={currentSong} />}

          {/* Library Tab with Liked Songs */}
          {!activePlaylist && activeNav === 'library' && (
            <div style={{ paddingTop: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
                <h1 className="page-title" style={{ margin: 0 }}>Your Library</h1>
                <button 
                  onClick={() => setShowCreatePlaylist(true)}
                  style={{ background: 'var(--text-primary)', color: 'black', border: 'none', padding: '8px 16px', borderRadius: 20, fontWeight: 700, cursor: 'pointer' }}
                >
                  + Create Playlist
                </button>
              </div>
              
              {/* Liked Songs — always visible */}
              <div style={{ marginBottom: 32 }}>
                <div className="section-header"><span>Liked Songs</span></div>
                <div className="grid-horizontal">
                  <CompactPlaylistCard 
                    playlist={likedSongsPlaylist} 
                    onClick={() => setActivePlaylist(likedSongsPlaylist)} 
                  />
                </div>
              </div>

              {likedPlaylists.length > 0 && (
                <div style={{ marginBottom: 32 }}>
                  <div className="section-header"><span>Saved Playlists</span></div>
                  <div className="grid-horizontal">
                    {likedPlaylists.map(playlist => (
                      <CompactPlaylistCard 
                        key={playlist.title} 
                        playlist={playlist} 
                        onClick={() => setActivePlaylist(playlist)} 
                      />
                    ))}
                  </div>
                </div>
              )}

              {history.length > 0 && (
                <>
                  <div className="section-header"><span>Recently Played</span></div>
                  <div className="grid-horizontal">
                    {history.map(song => (
                      <TrackCard key={`lib-${song.id}`} song={song} isActive={currentSong?.id === song.id} onClick={() => handleSongSelect(song, history)} />
                    ))}
                  </div>
                </>
              )}

              {history.length === 0 && likedSongs.length === 0 && (
                <p style={{ color: 'var(--text-secondary)' }}>Your library is empty. Start playing or liking songs!</p>
              )}
            </div>
          )}
          
          {activePlaylist && (
            <PlaylistPage 
              playlist={activePlaylist} 
              onClose={() => setActivePlaylist(null)} 
              onSelectSong={handleSongSelect} 
              currentSong={currentSong} 
              isPlaylistLiked={isPlaylistLiked(activePlaylist.title)}
              onToggleLikePlaylist={() => toggleLikePlaylist(activePlaylist)}
              onRemoveSong={(song) => {
                if (activePlaylist.title === 'Liked Songs') {
                  // Unliking removes from Liked Songs
                  toggleLike(song);
                } else if (isPlaylistLiked(activePlaylist.title)) {
                  // Saved playlist — persist removal
                  removeSongFromPlaylist(activePlaylist.title, song.id);
                }
                // Also update the active playlist view immediately
                setActivePlaylist(prev => ({
                  ...prev,
                  songs: prev.songs.filter(s => s.id !== song.id)
                }));
              }}
            />
          )}
        </main>
      </div>

      {/* Desktop Player (Mini) */}
      <div className={`desktop-player glass-panel ${currentSong && !isPlayerExpanded ? 'visible' : ''}`} onClick={() => currentSong && setIsPlayerExpanded(true)}>
        <div className="now-playing">
          {currentSong && <img src={offlineCover || currentSong.cover} alt="cover" className="now-playing-cover" referrerPolicy="no-referrer" onError={e => e.target.src = FALLBACK} />}
          <div>
            <div style={{ fontWeight: 600, fontSize: 15, color: 'white', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentSong?.title}</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 2 }}>{currentSong?.artist}</div>
          </div>
          {currentSong && (
            <div style={{ marginLeft: 8, cursor: 'pointer', zIndex: 10 }} onClick={(e) => { e.stopPropagation(); toggleLike(currentSong); }}>
              <Icons.Heart filled={isLiked(currentSong.id)} />
            </div>
          )}
        </div>

        <div className="player-controls">
          <div className="control-buttons">
            <button className="btn-control" onClick={(e) => { e.stopPropagation(); setIsShuffle(!isShuffle); }} title="Shuffle"><Icons.Shuffle active={isShuffle} /></button>
            <button className="btn-control" onClick={(e) => { e.stopPropagation(); handlePrev(); }}><Icons.SkipBack /></button>
            <button className="btn-control btn-play" onClick={togglePlay}>{isPlaying ? <Icons.Pause /> : <Icons.Play />}</button>
            <button className="btn-control" onClick={(e) => { e.stopPropagation(); handleNext(); }}><Icons.SkipFwd /></button>
            <button className="btn-control" onClick={(e) => { e.stopPropagation(); setRepeatMode((repeatMode + 1) % 3); }} title="Repeat"><Icons.Repeat active={repeatMode > 0} mode={repeatMode} /></button>
          </div>
          <div className="progress-container">
            <span>{formatTime(currentTime)}</span>
            <div className="progress-bar-bg" onClick={(e) => { e.stopPropagation(); handleSeek(e); }} style={{ cursor: 'pointer' }}>
              <div className="progress-bar-fill" style={{ width: `${progressPercent}%` }} />
            </div>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        <div className="player-actions" style={{ alignItems: 'center' }}>
          <Icons.Volume />
          <input type="range" min="0" max="100" value={volume} onClick={(e) => e.stopPropagation()} onChange={(e) => setVolume(e.target.value)} style={{ width: 80, cursor: 'pointer' }} />
          <button className="btn-control" title="Lyrics" onClick={(e) => { e.stopPropagation(); setIsPlayerExpanded(true); setShowLyrics(true); }}><Icons.Lyrics /></button>
        </div>

        <button className="mobile-play-btn" onClick={togglePlay}>{isPlaying ? <Icons.Pause /> : <Icons.Play />}</button>
      </div>

      {/* Full Screen Player - Spotify Canvas Style */}
      <FullScreenPlayer
        isOpen={isPlayerExpanded}
        onClose={() => setIsPlayerExpanded(false)}
        currentSong={currentSong ? { ...currentSong, cover: offlineCover || currentSong.cover } : null}
        queue={queue}
        isPlaying={isPlaying}
        onTogglePlay={togglePlay}
        onNext={handleNext}
        onPrev={handlePrev}
        isShuffle={isShuffle}
        onToggleShuffle={() => setIsShuffle(!isShuffle)}
        repeatMode={repeatMode}
        onCycleRepeat={() => setRepeatMode((repeatMode + 1) % 3)}
        currentTime={currentTime}
        duration={duration}
        onSeek={handleSeek}
        volume={volume}
        onVolumeChange={(v) => setVolume(v)}
        isLiked={isLiked(currentSong?.id)}
        onToggleLike={toggleLike}
        lyrics={lyrics}
        activeLyricIndex={activeLyricIndex}
        showLyrics={showLyrics}
        onShowLyrics={() => setShowLyrics(true)}
        onHideLyrics={() => setShowLyrics(false)}
        ytPlayerRef={ytPlayerRef}
        onSelectSong={handleSongSelect}
        customPlaylists={likedPlaylists.filter(p => p.title !== 'Liked Songs')}
        onAddToPlaylist={(playlistTitle, song) => addSongToPlaylist(playlistTitle, song)}
      />

      {/* Create Playlist Modal */}
      {showCreatePlaylist && (
        <div className="fsp-modal-backdrop" onClick={() => setShowCreatePlaylist(false)} style={{ zIndex: 10000 }}>
          <div className="fsp-options-sheet" style={{ bottom: 'auto', top: '50%', transform: 'translateY(-50%)', width: 300, borderRadius: 16 }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: 20 }}>Create Playlist</h3>
            <input 
              type="text" 
              placeholder="Playlist name" 
              value={newPlaylistName}
              onChange={e => setNewPlaylistName(e.target.value)}
              autoFocus
              style={{ width: '100%', padding: '12px 16px', borderRadius: 8, border: 'none', background: 'rgba(255,255,255,0.1)', color: 'white', fontSize: 16, marginBottom: 16, outline: 'none' }}
              onKeyDown={e => {
                if (e.key === 'Enter' && newPlaylistName.trim()) {
                  createPlaylist(newPlaylistName.trim());
                  setShowCreatePlaylist(false);
                  setNewPlaylistName("");
                }
              }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button 
                onClick={() => setShowCreatePlaylist(false)}
                style={{ background: 'transparent', border: 'none', color: 'white', padding: '8px 16px', borderRadius: 20, cursor: 'pointer' }}
              >Cancel</button>
              <button 
                onClick={() => {
                  if (newPlaylistName.trim()) {
                    createPlaylist(newPlaylistName.trim());
                    setShowCreatePlaylist(false);
                    setNewPlaylistName("");
                  }
                }}
                style={{ background: 'var(--text-primary)', border: 'none', color: 'black', padding: '8px 16px', borderRadius: 20, fontWeight: 700, cursor: 'pointer' }}
              >Create</button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Nav */}
      <nav className="mobile-nav glass-panel">
        {NAV_ITEMS.map(({ key, label, Icon }) => (
          <div key={key} className={`mobile-nav-item ${activeNav === key ? 'active' : ''}`} onClick={() => { setActiveNav(key); setActivePlaylist(null); if (key !== 'search') setSearchQuery(''); }}>
            <Icon /><span>{label}</span>
          </div>
        ))}
      </nav>
      </div>
    </>
  );
}
