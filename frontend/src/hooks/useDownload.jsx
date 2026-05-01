import React, { createContext, useContext, useState, useRef } from 'react';
import { saveOfflineData } from './useOfflineStorage';

const DownloadContext = createContext();

export function DownloadProvider({ children }) {
  const [downloads, setDownloads] = useState([]);
  const abortControllers = useRef(new Map());

  // saveBlob helper removed for native app behavior

  const startDownload = (song, onComplete) => {
    return new Promise(async (resolve, reject) => {
      // Prevent duplicate downloads
      if (downloads.some(d => d.id === song.id && d.status === 'downloading')) {
        resolve();
        return;
      }

      const controller = new AbortController();
      abortControllers.current.set(song.id, controller);

      setDownloads(prev => [...prev.filter(d => d.id !== song.id), {
        id: song.id,
        title: song.title,
        artist: song.artist,
        progress: 0,
        status: 'downloading',
        cover: song.cover
      }]);

      try {
        const videoId = song.youtubeId || song.id;
        const response = await fetch(`${import.meta.env.VITE_API_URL}/api/download/${videoId}`, {
          signal: controller.signal
        });

        if (!response.ok) throw new Error(`Server error: ${response.status}`);

        let blob;

        // Try streaming read for progress; fall back to arrayBuffer on Android WebViews that don't support it
        try {
          const contentLength = response.headers.get('content-length');
          const total = parseInt(contentLength, 10);
          let loaded = 0;

          const reader = response.body.getReader();
          const chunks = [];

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            loaded += value.length;
            if (total) {
              const progress = Math.round((loaded / total) * 100);
              setDownloads(prev => prev.map(d => d.id === song.id ? { ...d, progress } : d));
            } else {
              setDownloads(prev => prev.map(d => d.id === song.id ? { ...d, progress: Math.min(d.progress + 5, 90) } : d));
            }
          }

          blob = new Blob(chunks, { type: 'audio/mpeg' });
        } catch (streamErr) {
          if (streamErr.name === 'AbortError') throw streamErr;
          // Streaming not supported — fall back to arrayBuffer
          console.warn('Streaming read failed, falling back to arrayBuffer:', streamErr);
          const fallbackRes = await fetch(`${import.meta.env.VITE_API_URL}/api/download/${videoId}`, {
            signal: controller.signal
          });
          if (!fallbackRes.ok) throw new Error(`Server error: ${fallbackRes.status}`);
          setDownloads(prev => prev.map(d => d.id === song.id ? { ...d, progress: 50 } : d));
          const buffer = await fallbackRes.arrayBuffer();
          blob = new Blob([buffer], { type: 'audio/mpeg' });
        }
        
        // Fetch Cover Image — proxy through backend to avoid CORS on Android
        let coverBlob = null;
        try {
          if (song.cover) {
            const coverUrl = `${import.meta.env.VITE_API_URL}/api/proxy-image?url=${encodeURIComponent(song.cover)}`;
            const coverRes = await fetch(coverUrl);
            if (coverRes.ok) coverBlob = await coverRes.blob();
          }
        } catch (e) { console.warn("Failed to fetch cover for offline:", e); }

        // Fetch Lyrics
        let lyrics = null;
        try {
          const title = encodeURIComponent(song.title.split('(')[0].trim());
          const artist = encodeURIComponent(song.artist.split(',')[0].trim());
          const lrRes = await fetch(`https://lrclib.net/api/search?track_name=${title}&artist_name=${artist}`);
          if (lrRes.ok) {
            const data = await lrRes.json();
            if (data?.length) {
              const track = data[0];
              if (track.syncedLyrics) {
                lyrics = track.syncedLyrics.split('\n').map(line => {
                  const match = line.match(/\[(\d+):(\d+\.\d+)\](.*)/);
                  return match ? { time: parseInt(match[1]) * 60 + parseFloat(match[2]), text: match[3].trim() } : null;
                }).filter(l => l?.text);
              } else if (track.plainLyrics) {
                lyrics = track.plainLyrics;
              }
            }
          }
        } catch (e) { console.warn("Failed to fetch lyrics for offline:", e); }

        // Save to IndexedDB for offline playback
        await saveOfflineData(song.id, {
          audio: blob,
          cover: coverBlob,
          lyrics: lyrics
        });
        
        // Browser OS-level download prompt disabled for native mobile app integration
        
        setDownloads(prev => prev.map(d => d.id === song.id ? { ...d, status: 'completed', progress: 100 } : d));
        
        if (onComplete) onComplete(song);
        resolve(song);
        
        // Auto-remove completed download from UI after 3 seconds
        setTimeout(() => {
          setDownloads(prev => prev.filter(d => d.id !== song.id));
        }, 3000);

      } catch (err) {
        if (err.name === 'AbortError') {
          setDownloads(prev => prev.filter(d => d.id !== song.id));
          reject(err);
        } else {
          console.error('Download error:', err);
          setDownloads(prev => prev.map(d => d.id === song.id ? { ...d, status: 'error' } : d));
          setTimeout(() => {
            setDownloads(prev => prev.filter(d => d.id !== song.id));
          }, 5000);
          reject(err);
        }
      } finally {
        abortControllers.current.delete(song.id);
      }
    });
  };

  const cancelDownload = (songId) => {
    const controller = abortControllers.current.get(songId);
    if (controller) {
      controller.abort();
    }
  };

  return (
    <DownloadContext.Provider value={{ downloads, startDownload, cancelDownload }}>
      {children}
    </DownloadContext.Provider>
  );
}

export function useDownload() {
  return useContext(DownloadContext);
}
