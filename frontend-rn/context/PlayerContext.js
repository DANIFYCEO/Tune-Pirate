import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../services/api';

// Safe dynamic loader for audio module to support modern Expo SDK
let ExpoAudioModule = null;
try {
  ExpoAudioModule = require('expo-audio');
} catch (e) {
  console.warn('expo-audio not available, trying expo-av fallback...');
  try {
    ExpoAudioModule = require('expo-av');
  } catch (err) {
    console.warn('No native audio module loaded:', err.message);
  }
}

const PlayerContext = createContext(null);

export function PlayerProvider({ children }) {
  const [currentSong, setCurrentSong] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [queue, setQueue] = useState([]);
  const [queueIndex, setQueueIndex] = useState(-1);
  const [positionMillis, setPositionMillis] = useState(0);
  const [durationMillis, setDurationMillis] = useState(0);
  const [isShuffle, setIsShuffle] = useState(false);
  const [repeatMode, setRepeatMode] = useState(0);
  const [isPlayerExpanded, setIsPlayerExpanded] = useState(false);

  const [likedSongs, setLikedSongs] = useState([]);
  const [history, setHistory] = useState([]);

  const playerRef = useRef(null);
  const timerRef = useRef(null);
  const playRequestIdRef = useRef(0);
  const currentSongRef = useRef(null);

  // Setup background audio mode
  useEffect(() => {
    async function initAudio() {
      if (ExpoAudioModule?.setAudioModeAsync) {
        try {
          await ExpoAudioModule.setAudioModeAsync({
            playsInSilentMode: true,
            staysActiveInBackground: true,
            shouldDuckAndroid: true,
          });
        } catch (e) {
          console.warn('AudioMode config:', e.message);
        }
      } else if (ExpoAudioModule?.Audio?.setAudioModeAsync) {
        try {
          await ExpoAudioModule.Audio.setAudioModeAsync({
            allowsRecordingIOS: false,
            staysActiveInBackground: true,
            playsInSilentModeIOS: true,
            shouldDuckAndroid: true,
          });
        } catch (e) {
          console.warn('Audio.setAudioModeAsync:', e.message);
        }
      }
    }
    initAudio();

    AsyncStorage.getItem('@tp_liked').then((val) => val && setLikedSongs(JSON.parse(val)));
    AsyncStorage.getItem('@tp_history').then((val) => val && setHistory(JSON.parse(val)));

    return () => {
      stopPlayback();
    };
  }, []);

  const stopPlayback = () => {
    // Invalidate any in-flight playback attempts
    playRequestIdRef.current++;
    if (timerRef.current) clearInterval(timerRef.current);
    if (playerRef.current) {
      try {
        if (playerRef.current.pause) playerRef.current.pause();
        if (playerRef.current.release) playerRef.current.release();
        if (playerRef.current.stopAsync) playerRef.current.stopAsync();
        if (playerRef.current.unloadAsync) playerRef.current.unloadAsync();
      } catch (e) {
        // ignore
      }
      playerRef.current = null;
    }
  };

  const toggleLike = async (song) => {
    if (!song || !song.id) return;
    const exists = likedSongs.some((s) => s.id === song.id);
    const updated = exists
      ? likedSongs.filter((s) => s.id !== song.id)
      : [song, ...likedSongs];
    setLikedSongs(updated);
    await AsyncStorage.setItem('@tp_liked', JSON.stringify(updated));
  };

  const isLiked = (songId) => likedSongs.some((s) => s.id === songId);

  const addToHistory = async (song) => {
    if (!song || !song.id) return;
    const filtered = history.filter((s) => s.id !== song.id);
    const updated = [song, ...filtered].slice(0, 30);
    setHistory(updated);
    await AsyncStorage.setItem('@tp_history', JSON.stringify(updated));
  };

  const playSong = async (song, newQueue = null) => {
    if (!song) return;

    // 1. Guard against duplicate rapid taps on the same song
    if (currentSongRef.current?.id === song.id) {
      if (isLoading) {
        // Already fetching or buffering this track — do not duplicate
        return;
      }
      if (isPlaying) {
        // Track is actively playing smoothly — do not restart or double-play
        return;
      }
      if (playerRef.current) {
        // Track is paused — simply resume playback
        togglePlay();
        return;
      }
    }

    // 2. Assign unique incrementing request ID token to cancel prior in-flight requests
    const requestId = ++playRequestIdRef.current;
    currentSongRef.current = song;

    // 3. Immediately stop any active audio player and timer
    if (timerRef.current) clearInterval(timerRef.current);
    if (playerRef.current) {
      try {
        if (playerRef.current.pause) playerRef.current.pause();
        if (playerRef.current.release) playerRef.current.release();
        if (playerRef.current.stopAsync) playerRef.current.stopAsync();
        if (playerRef.current.unloadAsync) playerRef.current.unloadAsync();
      } catch (e) {}
      playerRef.current = null;
    }

    try {
      setIsLoading(true);
      setCurrentSong(song);
      addToHistory(song);

      if (newQueue) {
        setQueue(newQueue);
        const idx = newQueue.findIndex((s) => s.id === song.id);
        setQueueIndex(idx >= 0 ? idx : 0);
      } else if (queue.length === 0) {
        setQueue([song]);
        setQueueIndex(0);
      }

      // 4. Fetch direct audio stream URL from backend
      const audioData = await api.getAudioUrl(song.id, song.title, song.artist);

      // CRITICAL CHECK: If user tapped another song while waiting for network response, abort!
      if (requestId !== playRequestIdRef.current) {
        return;
      }

      if (!audioData || !audioData.audioUrl) {
        throw new Error('Audio stream unavailable');
      }

      // Cleanup again right before creating new instance to guarantee 0 audio concurrency
      if (playerRef.current) {
        try {
          if (playerRef.current.pause) playerRef.current.pause();
          if (playerRef.current.release) playerRef.current.release();
          if (playerRef.current.stopAsync) playerRef.current.stopAsync();
          if (playerRef.current.unloadAsync) playerRef.current.unloadAsync();
        } catch (e) {}
        playerRef.current = null;
      }

      // 5. Try candidate audio URLs (direct CDN stream first, proxy fallback second)
      const targetUrls = [audioData.audioUrl];
      if (audioData.proxyUrl && audioData.proxyUrl !== audioData.audioUrl) {
        targetUrls.push(audioData.proxyUrl);
      }

      for (const uri of targetUrls) {
        if (requestId !== playRequestIdRef.current) return;
        try {
          // A. Try modern expo-audio API
          if (ExpoAudioModule?.createAudioPlayer) {
            const player = ExpoAudioModule.createAudioPlayer({ uri });

            if (requestId !== playRequestIdRef.current) {
              if (player.release) player.release();
              return;
            }

            playerRef.current = player;

            if (player.addListener) {
              player.addListener('playbackStatusUpdate', (status) => {
                if (requestId !== playRequestIdRef.current) return;
                if (status.duration) {
                  setDurationMillis(Math.round(status.duration * 1000));
                }
                if (status.currentTime !== undefined) {
                  setPositionMillis(Math.round(status.currentTime * 1000));
                }
                if (status.playing !== undefined) {
                  setIsPlaying(status.playing);
                }
                if (status.didJustFinish) {
                  handleNext();
                }
              });
            }

            player.play();
            setIsPlaying(true);
            setIsLoading(false);
            return;
          }

          // B. Try legacy expo-av API
          if (ExpoAudioModule?.Audio?.Sound) {
            const { sound } = await ExpoAudioModule.Audio.Sound.createAsync(
              { uri },
              { shouldPlay: true },
              (status) => {
                if (requestId !== playRequestIdRef.current) return;
                if (!status.isLoaded) return;
                setPositionMillis(status.positionMillis || 0);
                setDurationMillis(status.durationMillis || 0);
                setIsPlaying(status.isPlaying);
                if (status.didJustFinish && !status.isLooping) {
                  handleNext();
                }
              }
            );

            if (requestId !== playRequestIdRef.current) {
              try {
                await sound.unloadAsync();
              } catch (e) {}
              return;
            }

            playerRef.current = sound;
            setIsPlaying(true);
            setIsLoading(false);
            return;
          }
        } catch (uriErr) {
          console.warn(`Playback attempt failed for ${uri}:`, uriErr.message);
        }
      }

      // C. Fallback simulation mode
      if (requestId !== playRequestIdRef.current) return;

      console.warn('Playing in simulation mode (native audio not installed in this client)');
      setIsPlaying(true);
      setIsLoading(false);
      setDurationMillis(180 * 1000);
      setPositionMillis(0);

      timerRef.current = setInterval(() => {
        if (requestId !== playRequestIdRef.current) {
          if (timerRef.current) clearInterval(timerRef.current);
          return;
        }
        setPositionMillis((prev) => {
          if (prev >= 180 * 1000) {
            clearInterval(timerRef.current);
            handleNext();
            return 0;
          }
          return prev + 1000;
        });
      }, 1000);

    } catch (err) {
      if (requestId === playRequestIdRef.current) {
        console.warn('Playback error:', err.message);
        setIsLoading(false);
        setIsPlaying(false);
      }
    }
  };

  const togglePlay = async () => {
    if (playerRef.current) {
      if (playerRef.current.play && playerRef.current.pause) {
        if (isPlaying) {
          playerRef.current.pause();
          setIsPlaying(false);
        } else {
          playerRef.current.play();
          setIsPlaying(true);
        }
        return;
      }
      if (playerRef.current.pauseAsync && playerRef.current.playAsync) {
        if (isPlaying) {
          await playerRef.current.pauseAsync();
        } else {
          await playerRef.current.playAsync();
        }
        return;
      }
    }
    // Simulation fallback
    setIsPlaying(!isPlaying);
  };

  const seekTo = async (millis) => {
    if (playerRef.current) {
      if (playerRef.current.seekTo) {
        playerRef.current.seekTo(millis / 1000);
      } else if (playerRef.current.setPositionAsync) {
        await playerRef.current.setPositionAsync(millis);
      }
    }
    setPositionMillis(millis);
  };

  const handleNext = async () => {
    if (repeatMode === 2 && playerRef.current) {
      seekTo(0);
      if (playerRef.current.play) playerRef.current.play();
      return;
    }

    if (queue.length === 0) return;

    let nextIndex = queueIndex + 1;
    if (isShuffle) {
      nextIndex = Math.floor(Math.random() * queue.length);
    }

    if (nextIndex < queue.length) {
      setQueueIndex(nextIndex);
      await playSong(queue[nextIndex]);
    } else {
      // Reached end of queue — Autoplay infinite matching tracks!
      if (currentSong) {
        try {
          const autoData = await api.getInfiniteQueue(currentSong.id, 10);
          if (autoData.songs && autoData.songs.length > 0) {
            const extended = [...queue, ...autoData.songs];
            setQueue(extended);
            setQueueIndex(queueIndex + 1);
            await playSong(autoData.songs[0]);
            return;
          }
        } catch (e) {
          console.warn('Autoplay fetch error:', e);
        }
      }

      if (repeatMode === 1) {
        setQueueIndex(0);
        await playSong(queue[0]);
      } else {
        setIsPlaying(false);
      }
    }
  };

  const handlePrev = async () => {
    if (positionMillis > 3000) {
      seekTo(0);
      return;
    }

    if (queueIndex > 0) {
      const prevIndex = queueIndex - 1;
      setQueueIndex(prevIndex);
      await playSong(queue[prevIndex]);
    } else if (queue.length > 0) {
      await playSong(queue[0]);
    }
  };

  return (
    <PlayerContext.Provider
      value={{
        currentSong,
        isPlaying,
        isLoading,
        queue,
        queueIndex,
        positionMillis,
        durationMillis,
        isShuffle,
        repeatMode,
        isPlayerExpanded,
        likedSongs,
        history,
        setIsPlayerExpanded,
        playSong,
        togglePlay,
        seekTo,
        handleNext,
        handlePrev,
        setIsShuffle,
        setRepeatMode,
        toggleLike,
        isLiked,
      }}
    >
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used within PlayerProvider');
  return ctx;
}
