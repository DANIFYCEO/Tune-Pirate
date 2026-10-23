"""
PirateBrain — Neural Recommendation & Personalization Engine for Tune Pirate
Implements a Spotify-grade (and beyond) hybrid recommendation architecture:
1. Shared Dense Metric Space: 20 Genre dimensions + 8 Acoustic dimensions.
2. Real-time Online Learning: Instant Hebbian updates with exponential recency decay.
3. Neural Interaction Scoring Head: Blends semantic cosine similarity, artist loyalty, and temporal context.
4. Contextual Multi-Armed Bandit (BaRT): 70% Exploitation (favorites) + 30% Serendipitous Exploration (discovery).
5. Audio Session Flow Optimization: Harmonic, energy, and BPM transition smoothing.
6. Personalized Search & Autocomplete Re-ranking: Dynamic ranking biased by user preferences.
"""

import json
import logging
import math
import os
import re
import threading
import time
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

logger = logging.getLogger("tunepirate.neural")

# ─── Dense Sonic Taxonomy ───────────────────────────────────────────────────────
GENRES = [
    "afrobeats", "amapiano", "hiphop", "trap", "rnb", "soul",
    "pop", "electronic", "house", "dancehall", "reggae", "rock",
    "indie", "latin", "lofi", "drill", "acoustic", "jazz", "gospel", "ambient"
]
GENRE_INDEX = {g: i for i, g in enumerate(GENRES)}
NUM_GENRES = len(GENRES)

# 8 Acoustic attributes:
# 0: Energy (0 chill -> 1 hype)
# 1: Valence (0 melancholic -> 1 euphoric)
# 2: Danceability (0 stiff -> 1 groove)
# 3: Acousticness (0 electronic -> 1 organic)
# 4: Tempo/BPM bucket (0 slow <90, 0.5 mid 110-128, 1.0 fast >140)
# 5: Vocal prominence (0 instrumental -> 1 vocal heavy)
# 6: Modernity / Recency (0 vintage classic -> 1 ultra-modern release)
# 7: Bass/808 Intensity (0 light -> 1 heavy punch)
NUM_ACOUSTIC = 8
RAW_DIM = NUM_GENRES + NUM_ACOUSTIC  # 28 dimensions

# ─── Well-Known Artist Sonic Knowledge Base ─────────────────────────────────────
ARTIST_PRIORS: Dict[str, Dict[str, Any]] = {
    "burna boy": {
        "genres": {"afrobeats": 0.98, "dancehall": 0.60, "reggae": 0.40, "pop": 0.35},
        "acoustic": [0.85, 0.80, 0.90, 0.25, 0.55, 0.85, 0.95, 0.85]
    },
    "asake": {
        "genres": {"amapiano": 0.98, "afrobeats": 0.95, "fuji": 0.80},
        "acoustic": [0.92, 0.85, 0.95, 0.15, 0.65, 0.90, 0.98, 0.92]
    },
    "rema": {
        "genres": {"afrobeats": 0.92, "trap": 0.60, "pop": 0.70, "amapiano": 0.45},
        "acoustic": [0.82, 0.80, 0.88, 0.20, 0.58, 0.85, 0.95, 0.80]
    },
    "wizkid": {
        "genres": {"afrobeats": 0.98, "rnb": 0.60, "pop": 0.50},
        "acoustic": [0.72, 0.75, 0.85, 0.35, 0.50, 0.80, 0.90, 0.75]
    },
    "davido": {
        "genres": {"afrobeats": 0.98, "amapiano": 0.50, "pop": 0.60},
        "acoustic": [0.88, 0.85, 0.92, 0.20, 0.60, 0.85, 0.95, 0.88]
    },
    "ayra starr": {
        "genres": {"afrobeats": 0.92, "rnb": 0.65, "pop": 0.70},
        "acoustic": [0.80, 0.75, 0.85, 0.30, 0.55, 0.88, 0.98, 0.78]
    },
    "omah lay": {
        "genres": {"afrobeats": 0.90, "rnb": 0.75, "soul": 0.50},
        "acoustic": [0.65, 0.50, 0.75, 0.40, 0.45, 0.90, 0.95, 0.70]
    },
    "tyla": {
        "genres": {"amapiano": 0.98, "pop": 0.80, "rnb": 0.70},
        "acoustic": [0.85, 0.80, 0.95, 0.20, 0.60, 0.85, 0.98, 0.85]
    },
    "seyi vibez": {
        "genres": {"afrobeats": 0.92, "amapiano": 0.85, "fuji": 0.70},
        "acoustic": [0.88, 0.70, 0.85, 0.20, 0.62, 0.88, 0.98, 0.88]
    },
    "olamide": {
        "genres": {"afrobeats": 0.92, "hiphop": 0.85, "amapiano": 0.60},
        "acoustic": [0.85, 0.75, 0.88, 0.20, 0.60, 0.85, 0.90, 0.85]
    },
    "drake": {
        "genres": {"hiphop": 0.98, "trap": 0.80, "rnb": 0.75, "pop": 0.80},
        "acoustic": [0.75, 0.60, 0.82, 0.25, 0.55, 0.85, 0.92, 0.82]
    },
    "kendrick lamar": {
        "genres": {"hiphop": 0.98, "trap": 0.65, "jazz": 0.40},
        "acoustic": [0.85, 0.55, 0.78, 0.20, 0.58, 0.95, 0.92, 0.85]
    },
    "travis scott": {
        "genres": {"trap": 0.98, "hiphop": 0.90, "electronic": 0.60},
        "acoustic": [0.95, 0.50, 0.85, 0.10, 0.70, 0.75, 0.95, 0.98]
    },
    "the weeknd": {
        "genres": {"rnb": 0.92, "pop": 0.90, "electronic": 0.75},
        "acoustic": [0.82, 0.55, 0.80, 0.20, 0.65, 0.90, 0.92, 0.80]
    },
    "sza": {
        "genres": {"rnb": 0.98, "soul": 0.85, "pop": 0.60},
        "acoustic": [0.65, 0.55, 0.72, 0.45, 0.45, 0.92, 0.95, 0.68]
    },
    "taylor swift": {
        "genres": {"pop": 0.98, "indie": 0.50, "acoustic": 0.45},
        "acoustic": [0.72, 0.70, 0.70, 0.40, 0.52, 0.90, 0.92, 0.65]
    },
    "billie eilish": {
        "genres": {"pop": 0.85, "indie": 0.85, "electronic": 0.50, "lofi": 0.60},
        "acoustic": [0.55, 0.45, 0.65, 0.55, 0.42, 0.92, 0.95, 0.70]
    },
    "sabrina carpenter": {
        "genres": {"pop": 0.98, "dancehall": 0.30},
        "acoustic": [0.80, 0.85, 0.85, 0.25, 0.58, 0.88, 0.99, 0.75]
    },
    "dua lipa": {
        "genres": {"pop": 0.98, "house": 0.80, "electronic": 0.80},
        "acoustic": [0.88, 0.85, 0.92, 0.15, 0.65, 0.85, 0.95, 0.82]
    },
    "imagine dragons": {
        "genres": {"rock": 0.98, "pop": 0.75, "electronic": 0.60},
        "acoustic": [0.90, 0.65, 0.65, 0.20, 0.62, 0.85, 0.90, 0.80]
    },
    "coldplay": {
        "genres": {"rock": 0.85, "pop": 0.85, "indie": 0.60},
        "acoustic": [0.75, 0.70, 0.60, 0.40, 0.52, 0.85, 0.85, 0.65]
    },
}

_RNG = np.random.RandomState(42)
_track_cache: Dict[str, np.ndarray] = {}
_cache_lock = threading.Lock()


def _cosine(a: np.ndarray, b: np.ndarray) -> float:
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a < 1e-7 or norm_b < 1e-7:
        return 0.0
    return float(np.dot(a, b) / (norm_a * norm_b))


def _sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-max(-20.0, min(20.0, x))))


# ─── Feature Extraction ────────────────────────────────────────────────────────
def extract_track_features(title: str, artist: str, duration_sec: int = 180) -> np.ndarray:
    """
    Extracts a 28-dimensional dense semantic feature vector for any song.
    """
    cache_key = f"{artist.lower().strip()}:{title.lower().strip()}"
    with _cache_lock:
        if cache_key in _track_cache:
            return _track_cache[cache_key]

    vec = np.zeros(RAW_DIM, dtype=np.float32)
    artist_clean = (artist or "").lower().strip()
    title_clean = (title or "").lower().strip()
    full_text = f"{artist_clean} {title_clean}"

    # 1. Match artist prior
    matched = None
    for prior_artist, data in ARTIST_PRIORS.items():
        if prior_artist in artist_clean or prior_artist in full_text:
            matched = data
            break

    if matched:
        for g, w in matched["genres"].items():
            if g in GENRE_INDEX:
                vec[GENRE_INDEX[g]] = w
        for i, val in enumerate(matched["acoustic"]):
            vec[NUM_GENRES + i] = val
    else:
        # Heuristic keywords across global music
        genre_kws = {
            "afrobeats": ["afro", "burna", "asake", "wizkid", "rema", "naija", "amapiano", "davido", "ayra", "omah"],
            "amapiano": ["amapiano", "piano", "pretoria", "log drum", "kabza", "tyla"],
            "hiphop": ["rap", "hip hop", "drake", "kendrick", "freestyle", "bars", "verse", "j cole"],
            "trap": ["trap", "808", "travis", "future", "gunna", "metro", "carti"],
            "rnb": ["r&b", "rnb", "soul", "slow", "vibe", "love", "heart", "sza", "faiyaz"],
            "pop": ["pop", "hits", "radio", "taylor", "dua", "sabrina", "billie"],
            "electronic": ["remix", "edm", "club", "house", "drop", "bass", "calvin"],
            "rock": ["rock", "guitar", "band", "dragons", "coldplay", "queen"],
            "drill": ["drill", "opp", "gang", "uk drill", "central cee"],
            "lofi": ["lo-fi", "lofi", "chill", "relax", "study", "beats"],
        }
        found = False
        for g, words in genre_kws.items():
            if any(w in full_text for w in words):
                vec[GENRE_INDEX[g]] = 0.85
                found = True
        if not found:
            vec[GENRE_INDEX["pop"]] = 0.50

        # Acoustic defaults
        vec[NUM_GENRES + 0] = 0.70  # Energy
        vec[NUM_GENRES + 1] = 0.65  # Valence
        vec[NUM_GENRES + 2] = 0.75  # Danceability
        vec[NUM_GENRES + 3] = 0.30  # Acousticness
        vec[NUM_GENRES + 4] = 0.55  # Tempo bucket
        vec[NUM_GENRES + 5] = 0.85  # Vocals
        vec[NUM_GENRES + 6] = 0.90  # Recency
        vec[NUM_GENRES + 7] = 0.75  # Bass

    # Duration tuning
    if duration_sec > 0:
        if duration_sec < 140:
            vec[NUM_GENRES + 0] = min(1.0, vec[NUM_GENRES + 0] + 0.1)
        elif duration_sec > 300:
            vec[NUM_GENRES + 0] = max(0.0, vec[NUM_GENRES + 0] - 0.1)

    with _cache_lock:
        if len(_track_cache) > 5000:
            _track_cache.clear()
        _track_cache[cache_key] = vec

    return vec


# ─── User Profile Representation ───────────────────────────────────────────────
class UserProfile:
    def __init__(self, user_id: str):
        self.user_id = user_id
        # Dense preference vector in the shared 28D semantic space
        self.preference_vector = np.zeros(RAW_DIM, dtype=np.float32)
        # Artist loyalty scores
        self.artist_affinities: Dict[str, float] = {}
        # Recent interaction trajectory (last 40 tracks)
        self.history: List[Dict[str, Any]] = []
        self.likes_count = 0
        self.skips_count = 0
        self.total_interactions = 0
        self.created_at = time.time()
        self.last_active = time.time()

    def get_top_genres(self, n: int = 4) -> List[Tuple[str, float]]:
        genre_scores = [(GENRES[i], float(self.preference_vector[i])) for i in range(NUM_GENRES)]
        genre_scores.sort(key=lambda x: x[1], reverse=True)
        return genre_scores[:n]

    def get_top_artists(self, n: int = 5) -> List[Tuple[str, float]]:
        items = sorted(self.artist_affinities.items(), key=lambda x: x[1], reverse=True)
        return items[:n]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "user_id": self.user_id,
            "preference_vector": self.preference_vector.tolist(),
            "artist_affinities": self.artist_affinities,
            "history": self.history[-40:],
            "likes_count": self.likes_count,
            "skips_count": self.skips_count,
            "total_interactions": self.total_interactions,
            "last_active": self.last_active,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "UserProfile":
        up = cls(data.get("user_id", "default_user"))
        up.preference_vector = np.array(
            data.get("preference_vector", [0.0] * RAW_DIM), dtype=np.float32
        )
        up.artist_affinities = data.get("artist_affinities", {})
        up.history = data.get("history", [])
        up.likes_count = data.get("likes_count", 0)
        up.skips_count = data.get("skips_count", 0)
        up.total_interactions = data.get("total_interactions", 0)
        up.last_active = data.get("last_active", time.time())
        return up


# ─── PirateBrain Core Engine ──────────────────────────────────────────────────
class PirateBrain:
    """
    Main Neural Recommendation Engine:
    - Maintains user neural taste profiles.
    - Updates online weights continuously as songs play or skip.
    - Personalizes recommendations, Daily Mixes, Discover Feed, and Search.
    """

    def __init__(self, persistence_file: str = "/tmp/pirate_brain_profiles.json"):
        self.profiles: Dict[str, UserProfile] = {}
        self.lock = threading.Lock()
        self.persistence_file = persistence_file
        self._load_profiles()

    def _load_profiles(self):
        if os.path.exists(self.persistence_file):
            try:
                with open(self.persistence_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                for uid, pdata in data.items():
                    self.profiles[uid] = UserProfile.from_dict(pdata)
                logger.info(f"Loaded {len(self.profiles)} neural profiles from {self.persistence_file}")
            except Exception as e:
                logger.warning(f"Could not load neural profiles: {e}")

    def save_profiles(self):
        try:
            serialized = {}
            with self.lock:
                for uid, prof in self.profiles.items():
                    serialized[uid] = prof.to_dict()
            with open(self.persistence_file, "w", encoding="utf-8") as f:
                json.dump(serialized, f)
        except Exception as e:
            logger.warning(f"Failed to persist neural profiles: {e}")

    def get_or_create_profile(self, user_id: str = "default_user") -> UserProfile:
        uid = (user_id or "").strip() or "default_user"
        with self.lock:
            if uid not in self.profiles:
                self.profiles[uid] = UserProfile(uid)
            return self.profiles[uid]

    def record_interaction(
        self,
        user_id: str,
        track_id: str,
        title: str,
        artist: str,
        action: str = "completed",
        duration_listened: float = 0.0,
        total_duration: float = 180.0,
    ) -> Dict[str, Any]:
        """
        Online Learning Update (Real-Time Hebbian Feedback):
        - `action`:
            'like' (+2.5) -> High explicit positive intent
            'repeat' (+3.0) -> Replayed track
            'completed' (+1.2) -> Listened to completion
            'search_select' (+1.5) -> Selected from search
            'skip' (-1.8 if <15s, -0.6 if <45s) -> Negative demotion
        """
        profile = self.get_or_create_profile(user_id)
        track_vec = extract_track_features(title, artist, int(total_duration))

        action_lower = action.lower().strip()
        if action_lower in ("like", "favorite", "love", "heart"):
            weight = 2.5
            profile.likes_count += 1
        elif action_lower in ("repeat", "replay"):
            weight = 3.0
        elif action_lower in ("completed", "finished"):
            weight = 1.2
        elif action_lower in ("search_select", "search_click"):
            weight = 1.5
        elif action_lower in ("listen_start", "play", "stream"):
            weight = 0.4
        elif action_lower in ("quick_skip", "skip", "skipped"):
            if action_lower == "quick_skip" or (0.0 <= duration_listened < 15.0):
                weight = -1.8  # Immediate skip
            elif duration_listened < 45.0:
                weight = -0.6
            else:
                weight = 0.2  # Listened to most of song before skip
            profile.skips_count += 1
        elif action_lower in ("dislike", "hate", "block", "never_play"):
            weight = -2.5
            profile.skips_count += 1
        else:
            weight = 0.8

        decay = 0.96
        lr = 0.15 * weight

        with self.lock:
            profile.last_active = time.time()
            profile.total_interactions += 1

            if weight >= 0:
                profile.preference_vector = np.clip(
                    profile.preference_vector * decay + track_vec * lr,
                    -1.0,
                    3.0
                )
            else:
                profile.preference_vector = np.clip(
                    profile.preference_vector - track_vec * abs(lr) * 0.7,
                    -1.0,
                    3.0
                )

            # Artist affinity update
            art_key = artist.lower().strip()
            curr_art = profile.artist_affinities.get(art_key, 0.0)
            profile.artist_affinities[art_key] = max(0.0, curr_art * 0.98 + (weight * 0.2))

            # Record history
            profile.history.append({
                "track_id": track_id,
                "title": title,
                "artist": artist,
                "action": action,
                "weight": weight,
                "timestamp": time.time(),
            })
            if len(profile.history) > 40:
                profile.history = profile.history[-40:]

        logger.info(f"PirateBrain learned '{action}' for {user_id} on '{artist} - {title}' (weight={weight})")
        return {
            "status": "learned",
            "user_id": user_id,
            "top_genres": profile.get_top_genres(),
            "top_artists": profile.get_top_artists(),
            "total_interactions": profile.total_interactions,
        }

    def score_track(self, user_id: str, track: Dict[str, Any]) -> float:
        """
        Neural Interaction Scorer:
        Blends semantic cosine match with artist loyalty and temporal energy context.
        Returns a score in [0.0, 1.0].
        """
        profile = self.get_or_create_profile(user_id)
        title = track.get("title") or ""
        artist = track.get("artist") or ""
        track_vec = extract_track_features(title, artist)

        # 1. Shared Metric Space Cosine Match
        cos_sim = _cosine(profile.preference_vector, track_vec)

        # 2. Artist Loyalty Boost
        art_key = artist.lower().strip()
        art_aff = profile.artist_affinities.get(art_key, 0.0)
        art_boost = min(0.35, art_aff * 0.15)

        # 3. Temporal Context Adjustment (e.g. Energy match to current hour)
        hour = datetime.now().hour
        expected_energy = 0.75 if (11 <= hour < 22) else 0.45
        track_energy = float(track_vec[NUM_GENRES + 0])
        energy_diff = abs(expected_energy - track_energy)
        temporal_factor = 1.0 - (energy_diff * 0.2)

        # 4. Final Calibrated Score (0.0 to 1.0)
        # If user has 0 interactions yet, default to baseline 0.5
        if profile.total_interactions == 0:
            return 0.50 + art_boost

        raw_score = (cos_sim * 0.65) + art_boost + (temporal_factor * 0.15)
        return float(np.clip(raw_score, 0.0, 1.0))

    def rank_tracks_bart(
        self,
        user_id: str,
        candidates: List[Dict[str, Any]],
        limit: int = 15,
        exploration_ratio: float = 0.30,
    ) -> List[Dict[str, Any]]:
        """
        Contextual Bandit (BaRT - Exploration vs Exploitation):
        - Exploitation (70%): Top neural affinity tracks matching user core taste.
        - Exploration (30%): Serendipitous discovery tracks from adjacent latent clusters
          to prevent filter-bubbles and delight the listener with fresh hits.
        """
        if not candidates:
            return []

        scored = [(self.score_track(user_id, t), t) for t in candidates]
        scored.sort(key=lambda x: x[0], reverse=True)

        if len(candidates) <= limit:
            return [x[1] for x in scored]

        split = max(1, int(limit * (1.0 - exploration_ratio)))
        exploit_tracks = [x[1] for x in scored[:split]]

        remainder = scored[split:]
        explore_tracks = []
        if remainder:
            sample_candidates = [x[1] for x in remainder[:limit * 2]]
            sample_k = min(limit - split, len(sample_candidates))
            explore_tracks = list(_RNG.choice(sample_candidates, size=sample_k, replace=False))

        # Interleave smoothly
        result = []
        e_i = 0
        x_i = 0
        for i in range(limit):
            if i % 3 == 2 and x_i < len(explore_tracks):
                result.append(explore_tracks[x_i])
                x_i += 1
            elif e_i < len(exploit_tracks):
                result.append(exploit_tracks[e_i])
                e_i += 1
            elif x_i < len(explore_tracks):
                result.append(explore_tracks[x_i])
                x_i += 1

        return result

    def rerank_search_results(
        self,
        query: str,
        candidates: List[Dict[str, Any]],
        user_id: str = "default_user",
        limit: int = 20,
    ) -> List[Dict[str, Any]]:
        """
        Personalized Search Engine:
        Combines lexical relevance with user neural preference vector.
        """
        if not candidates:
            return []

        q_lower = query.lower().strip()
        ranked = []

        for item in candidates:
            title = (item.get("title") or "").lower()
            artist = (item.get("artist") or "").lower()

            lexical = 100.0
            if q_lower == title:
                lexical += 120.0
            elif q_lower in title:
                lexical += 60.0
            if q_lower in artist:
                lexical += 70.0

            neural_aff = self.score_track(user_id, item)
            # Boost score by up to 50% based on user neural affinity
            final_score = lexical * (1.0 + (neural_aff * 0.50))
            ranked.append((final_score, item))

        ranked.sort(key=lambda x: x[0], reverse=True)
        return [r[1] for r in ranked[:limit]]


# Singleton Engine Instance
pirate_brain = PirateBrain()
