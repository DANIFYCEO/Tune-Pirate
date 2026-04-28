import { useState, useCallback } from 'react';

const MAX_HISTORY = 20;
const STORAGE_KEY = 'tp_listen_history';

export function useListenHistory() {
  const [history, setHistory] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch {
      return [];
    }
  });

  const addToHistory = useCallback((song) => {
    setHistory(prev => {
      // Move to front if already exists, else add
      const filtered = prev.filter(s => s.id !== song.id);
      const updated = [song, ...filtered].slice(0, MAX_HISTORY);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  // Most played artists from history
  const topArtists = useCallback(() => {
    const counts = {};
    history.forEach(s => {
      if (s.artist && s.artist !== 'Unknown Artist') {
        counts[s.artist] = (counts[s.artist] || 0) + 1;
      }
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([artist]) => artist);
  }, [history]);

  return { history, addToHistory, topArtists };
}
