// src/hooks/useOfflineStorage.js

const DB_NAME = 'TunePirateDB';
const STORE_NAME = 'offline_audio';
const DB_VERSION = 2;

let dbPromise = null;

function initDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = (e) => reject('IndexedDB error: ' + e.target.error);
      request.onsuccess = (e) => resolve(e.target.result);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
    });
  }
  return dbPromise;
}

export async function saveOfflineData(songId, data) {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(data, songId);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('Failed to save offline data:', err);
    return false;
  }
}

export async function getOfflineData(songId) {
  try {
    const db = await initDB();
    const data = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(songId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return data || null;
  } catch (err) {
    console.error('Failed to retrieve offline data:', err);
    return null;
  }
}

export async function isSongDownloaded(songId) {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      // count() is faster than get() just to check existence
      const request = store.count(songId);
      request.onsuccess = () => resolve(request.result > 0);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return false;
  }
}
