import { useState, useCallback } from 'react';

const STORAGE_KEY = 'tp_liked_songs';
const PLAYLIST_STORAGE_KEY = 'tp_liked_playlists';

export function useLibrary() {
  // Liked Songs State
  const [likedSongs, setLikedSongs] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch {
      return [];
    }
  });

  // Liked Playlists State
  const [likedPlaylists, setLikedPlaylists] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(PLAYLIST_STORAGE_KEY)) || [];
    } catch {
      return [];
    }
  });

  // Song Like Toggle
  const toggleLike = useCallback((song) => {
    setLikedSongs(prev => {
      const isLiked = prev.some(s => s.id === song.id);
      let updated;
      if (isLiked) {
        updated = prev.filter(s => s.id !== song.id);
      } else {
        updated = [song, ...prev];
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const isLiked = useCallback((songId) => {
    return likedSongs.some(s => s.id === songId);
  }, [likedSongs]);

  // Playlist Like Toggle
  const toggleLikePlaylist = useCallback((playlist) => {
    setLikedPlaylists(prev => {
      // Use title as unique identifier
      const isLiked = prev.some(p => p.title === playlist.title);
      let updated;
      if (isLiked) {
        updated = prev.filter(p => p.title !== playlist.title);
      } else {
        updated = [playlist, ...prev];
      }
      localStorage.setItem(PLAYLIST_STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const isPlaylistLiked = useCallback((playlistTitle) => {
    return likedPlaylists.some(p => p.title === playlistTitle);
  }, [likedPlaylists]);

  // Remove a song from a saved playlist by title
  const removeSongFromPlaylist = useCallback((playlistTitle, songId) => {
    setLikedPlaylists(prev => {
      const updated = prev.map(p => {
        if (p.title !== playlistTitle) return p;
        return { ...p, songs: p.songs.filter(s => s.id !== songId) };
      });
      localStorage.setItem(PLAYLIST_STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const createPlaylist = useCallback((title) => {
    setLikedPlaylists(prev => {
      if (prev.some(p => p.title === title)) return prev; // Already exists
      const updated = [{
        title,
        description: "Custom playlist",
        cover: "",
        songs: []
      }, ...prev];
      localStorage.setItem(PLAYLIST_STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const addSongToPlaylist = useCallback((playlistTitle, song) => {
    setLikedPlaylists(prev => {
      const updated = prev.map(p => {
        if (p.title !== playlistTitle) return p;
        // Avoid duplicates
        if (p.songs.some(s => s.id === song.id)) return p;
        const newSongs = [...p.songs, song];
        return { 
          ...p, 
          songs: newSongs,
          cover: newSongs.length === 1 ? song.cover : p.cover // Set cover to first song if empty
        };
      });
      localStorage.setItem(PLAYLIST_STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  // Create permanent Liked Songs playlist object
  const likedSongsPlaylist = {
    title: "Liked Songs",
    description: "Your favorite tracks, saved in one place.",
    cover: likedSongs.length > 0 ? likedSongs[0].cover : "",
    songs: likedSongs
  };

  return { 
    likedSongs, 
    toggleLike, 
    isLiked,
    likedPlaylists,
    toggleLikePlaylist,
    isPlaylistLiked,
    removeSongFromPlaylist,
    createPlaylist,
    addSongToPlaylist,
    likedSongsPlaylist
  };
}
