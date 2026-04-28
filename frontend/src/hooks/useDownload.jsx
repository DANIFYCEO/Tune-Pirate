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

        if (!response.ok) throw new Error('Network response was not ok');

        // To track progress, we need to read the body manually
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
            // Fake progress if no content-length
            setDownloads(prev => prev.map(d => d.id === song.id ? { ...d, progress: Math.min(d.progress + 10, 95) } : d));
          }
        }

        const blob = new Blob(chunks, { type: 'audio/mpeg' });
        
        // Fetch Cover Image
        let coverBlob = null;
        try {
          if (song.cover) {
            const coverRes = await fetch(song.cover);
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
