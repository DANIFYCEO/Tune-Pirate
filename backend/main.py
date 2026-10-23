"""
Tune Pirate Backend — FastAPI
Provides music search, streaming, downloads, and discovery via YouTube Music.
"""

import base64
import difflib
import html
import json
import logging
import os
import random
import re
import tempfile
import time
import urllib.parse
import urllib.request
from datetime import datetime
from functools import wraps
from typing import Optional
from urllib.parse import quote

import asyncio
import httpx
import yt_dlp
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel
from ytmusicapi import YTMusic

from neural_engine import pirate_brain

# ─── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("tunepirate")

# ─── App Setup ─────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Tune Pirate API",
    version="2.0.0",
    description="Music search, streaming, and discovery powered by YouTube Music.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

yt = YTMusic()

FFMPEG_PATH = "ffmpeg"

# ─── Pydantic Response Models ─────────────────────────────────────────────────
class Track(BaseModel):
    id: Optional[str] = None
    title: Optional[str] = None
    artist: str = "Unknown Artist"
    album: str = ""
    cover: str = ""
    duration: str = ""
    youtubeId: Optional[str] = None

class PlaylistItem(BaseModel):
    browseId: Optional[str] = None
    title: Optional[str] = None
    author: Optional[str] = None
    cover: str = ""
    songCount: Optional[str] = None

class ArtistInfo(BaseModel):
    id: Optional[str] = None
    name: Optional[str] = None
    subscribers: Optional[str] = None
    monthlyListeners: Optional[str] = None
    description: Optional[str] = None
    image: str = ""

# ─── TTL Cache ─────────────────────────────────────────────────────────────────
_cache: dict[str, tuple[float, any]] = {}

def cached(ttl_seconds: int = 3600):
    """Simple in-memory TTL cache decorator for expensive endpoints."""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            key = f"{func.__name__}:{args}:{sorted(kwargs.items())}"
            now = time.time()
            if key in _cache:
                timestamp, value = _cache[key]
                if now - timestamp < ttl_seconds:
                    logger.debug(f"Cache hit: {func.__name__}")
                    return value
            result = func(*args, **kwargs)
            _cache[key] = (now, result)
            return result
        return wrapper
    return decorator

@app.delete("/api/cache")
def clear_cache():
    """Clear all cached data (admin/debug endpoint)."""
    _cache.clear()
    return {"status": "ok", "message": "Cache cleared"}


# ─── Helpers ───────────────────────────────────────────────────────────────────
def _get_cover_url(item: dict) -> str:
    """Safely extract and upscale cover URL from a YouTube Music item."""
    thumbnails = item.get("thumbnails") or item.get("thumbnail") or []
    if not thumbnails:
        return ""
    cover_url = thumbnails[-1].get("url", "")
    if cover_url and "googleusercontent.com" in cover_url:
        base = cover_url.split("=")[0] if "=" in cover_url else cover_url
        return f"{base}=w600-h600-l90-rj"
    return cover_url


def _get_artist_name(item: dict) -> str:
    """Safely extract primary artist name."""
    artists = item.get("artists") or []
    if artists and isinstance(artists, list) and len(artists) > 0:
        return artists[0].get("name", "Unknown Artist")
    return "Unknown Artist"


def format_track(track: dict) -> dict:
    """Format a YouTube Music track into a consistent Track shape."""
    vid = track.get("videoId")
    return {
        "id": vid,
        "title": track.get("title"),
        "artist": _get_artist_name(track),
        "album": (track.get("album") or {}).get("name", ""),
        "cover": _get_cover_url(track),
        "duration": track.get("duration", ""),
        "youtubeId": vid,
    }


def _format_playlist(item: dict) -> dict:
    """Format a YouTube Music playlist search result."""
    return {
        "browseId": item.get("browseId"),
        "title": item.get("title"),
        "author": item.get("author"),
        "cover": _get_cover_url(item),
        "songCount": item.get("itemCount"),
    }


def _current_year() -> int:
    return datetime.now().year


def parse_duration_seconds(duration_str: str) -> int:
    """Convert duration string (e.g. '3:45', '1:02:15') into integer seconds."""
    if not duration_str:
        return 0
    parts = duration_str.strip().split(":")
    try:
        if len(parts) == 1:
            return int(parts[0])
        elif len(parts) == 2:
            return int(parts[0]) * 60 + int(parts[1])
        elif len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
    except ValueError:
        return 0
    return 0


def is_full_song(track: dict, allow_long: bool = False) -> bool:
    """Ensure track is a full song version (not short snippet/ringtone or huge podcast)."""
    dur_str = track.get("duration") or ""
    dur_sec = parse_duration_seconds(dur_str)
    title_lower = (track.get("title") or "").lower()

    # Reject obvious preview/snippet terms
    junk_snip = ["snippet", "ringtone", "preview", "teaser", "shorts", "sample sound"]
    if any(s in title_lower for s in junk_snip):
        return False

    if dur_sec > 0:
        # Full song must be at least 70 seconds (filters out previews, shorts, ringtones)
        if dur_sec < 70:
            return False
        # Filter out 1+ hour mixes unless allow_long is requested
        if not allow_long and dur_sec > 660:
            return False

    return True


def normalize_title_for_dedup(title: str) -> str:
    """Normalize title to catch duplicate recordings/uploads of the same song."""
    t = (title or "").lower()
    t = re.sub(r"\s*[\(\[\{].*?[\)\]\}]", "", t)
    t = re.sub(r"[^a-z0-9]", "", t)
    return t


def search_songs(query: str, limit: int = 8, allow_long: bool = False) -> list[dict]:
    """Search YouTube Music for songs with duration validation and deduplication."""
    try:
        # Check if user explicitly searched for long formats
        q_lower = query.lower()
        allow_long = allow_long or any(w in q_lower for w in ["mix", "album", "set", "podcast", "full", "live"])

        results = yt.search(query, filter="songs", limit=limit * 2 + 6)
        seen_ids = set()
        seen_titles = set()
        unique = []

        for t in results:
            vid = t.get("videoId")
            if not vid or vid in seen_ids:
                continue

            formatted = format_track(t)
            if not is_full_song(formatted, allow_long=allow_long):
                continue

            norm_key = (normalize_title_for_dedup(formatted["title"]), formatted["artist"].lower())
            if norm_key in seen_titles and len(unique) >= 3:
                continue

            seen_ids.add(vid)
            seen_titles.add(norm_key)
            unique.append(formatted)

            if len(unique) >= limit:
                break

        return unique
    except Exception as e:
        logger.error(f"Search error for '{query}': {e}")
        return []


# ─── yt-dlp Audio Extraction ──────────────────────────────────────────────────
YDL_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.youtube.com/",
}

VIDEO_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_-]{11}$")

# In-memory stream URL cache: video_id -> (timestamp, audio_url, title, duration)
# YouTube googlevideo URLs stay valid for ~6 hours; we cache for 4 hours (14400s)
_stream_cache: dict[str, tuple[float, str, str, int]] = {}
STREAM_CACHE_TTL = 14400

_cookie_file_path: Optional[str] = None


def _get_cookie_file() -> Optional[str]:
    """
    Returns path to a valid Netscape cookies file if available.
    Supports:
    1. YOUTUBE_COOKIES_B64 env var (base64-encoded Netscape cookie file, e.g. Azure secret)
    2. YOUTUBE_COOKIES env var (raw Netscape cookies text)
    3. YOUTUBE_COOKIES_FILE env var
    4. Local cookies.txt in backend or project directory
    5. Previously written /tmp/youtube_cookies.txt (e.g. via /api/admin/cookies)
    """
    global _cookie_file_path

    target = os.path.join(tempfile.gettempdir(), "youtube_cookies.txt")

    # 1. Base64 environment variable (e.g. from Azure Container Apps secret)
    b64_content = os.environ.get("YOUTUBE_COOKIES_B64")
    if b64_content and len(b64_content.strip()) > 10:
        try:
            decoded = base64.b64decode(b64_content.strip()).decode("utf-8", errors="ignore")
            if len(decoded) > 10:
                needs_write = True
                if os.path.exists(target):
                    try:
                        with open(target, "r", encoding="utf-8") as f:
                            if f.read() == decoded:
                                needs_write = False
                    except Exception:
                        pass
                if needs_write:
                    with open(target, "w", encoding="utf-8") as f:
                        f.write(decoded)
                    logger.info(f"Loaded YouTube cookies from YOUTUBE_COOKIES_B64 -> {target} ({len(decoded)} bytes)")
                _cookie_file_path = target
                return _cookie_file_path
        except Exception as e:
            logger.error(f"Failed to decode YOUTUBE_COOKIES_B64: {e}")

    # 2. Raw text environment variable
    raw_content = os.environ.get("YOUTUBE_COOKIES")
    if raw_content and len(raw_content.strip()) > 10:
        try:
            with open(target, "w", encoding="utf-8") as f:
                f.write(raw_content.strip())
            logger.info(f"Loaded YouTube cookies from YOUTUBE_COOKIES -> {target}")
            _cookie_file_path = target
            return _cookie_file_path
        except Exception as e:
            logger.error(f"Failed to write YOUTUBE_COOKIES: {e}")

    if _cookie_file_path and os.path.exists(_cookie_file_path) and os.path.getsize(_cookie_file_path) > 10:
        return _cookie_file_path

    env_file = os.environ.get("YOUTUBE_COOKIES_FILE")
    if env_file and os.path.exists(env_file) and os.path.getsize(env_file) > 10:
        _cookie_file_path = env_file
        return _cookie_file_path

    script_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(script_dir, "cookies.txt"),
        os.path.abspath("cookies.txt"),
        os.path.abspath("backend/cookies.txt"),
    ]
    for candidate in candidates:
        if os.path.exists(candidate) and os.path.getsize(candidate) > 10:
            logger.info(f"Using local YouTube cookie file: {candidate}")
            _cookie_file_path = candidate
            return _cookie_file_path

    if os.path.exists(target) and os.path.getsize(target) > 10:
        _cookie_file_path = target
        return _cookie_file_path

    return None


def _get_base_url(request: Request) -> str:
    """Determine the public base URL of the API for proxy link generation."""
    env_public = os.environ.get("PUBLIC_API_URL", "").strip().rstrip("/")
    if env_public:
        return env_public
    proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    host = request.headers.get("x-forwarded-host", request.headers.get("host", request.url.netloc))
    return f"{proto}://{host}".rstrip("/")


def _validate_video_id(video_id: str) -> str:
    """Validate and sanitize a YouTube video ID."""
    vid = video_id.strip()
    if not VIDEO_ID_PATTERN.match(vid):
        raise HTTPException(status_code=400, detail="Invalid video_id format")
    return vid


# ─── Multi-Source Audio Engine (mp3.pm, JioSaavn, SoundCloud, YouTube Music) ───

def _clean_search_query(query: str) -> str:
    """Clean video/audio noise to maximize music metadata hit rate."""
    q = re.sub(r"[\(\[\{].*?[\)\]\}]", " ", query)
    q = re.sub(r"\b(official|music|video|audio|lyrics|visualizer|explicit|hd|4k|feat|ft)\b", " ", q, flags=re.I)
    q = re.sub(r"\s+", " ", q).strip()
    return q


def _verify_stream_url(url: str, referer: Optional[str] = None, timeout: float = 2.0) -> bool:
    """Rapidly verify stream URL responds with 200 or 206 before handing off to player."""
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Range": "bytes=0-100",
        }
        if referer:
            headers["Referer"] = referer
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status in (200, 206)
    except Exception:
        return False


def _search_mp3_pm(query: str) -> Optional[tuple[str, str, int]]:
    """
    Search mp3.pm for high-fidelity direct MP3 stream.
    Zero bot blocks, byte-range seeking supported, CORS enabled.
    """
    cleaned = _clean_search_query(query)
    safe_q = re.sub(r"[^a-zA-Z0-9]+", "+", cleaned.lower()).strip("+")
    if not safe_q:
        return None
    url = f"https://mp3.pm/s/f/{safe_q}/"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=7) as resp:
            page = resp.read().decode("utf-8", errors="ignore")

        pattern = re.compile(
            r'class="cplayer-sound-item"[^>]*?data-sound-url="([^"]+)"[^>]*?>'
            r'.*?<i class="cplayer-data-sound-author">([^<]*)</i>.*?'
            r'<b class="cplayer-data-sound-title">([^<]*)</b>',
            re.DOTALL | re.IGNORECASE,
        )
        items = pattern.findall(page)
        if not items:
            urls = re.findall(r'data-sound-url="([^"]+)"', page)
            for u in urls[:3]:
                if _verify_stream_url(u, referer="https://mp3.pm/"):
                    return u, query, 180
            return None

        target_words = set(re.findall(r"\w+", cleaned.lower()))
        ranked = []
        for sound_url, auth, title in items:
            clean_auth = html.unescape(auth).strip()
            clean_title = html.unescape(title).strip()
            item_text = f"{clean_auth} {clean_title}".lower()

            score = 100
            overlap = len(target_words.intersection(re.findall(r"\w+", item_text)))
            score += overlap * 25

            # Penalize unwanted edits / parodies
            if any(j in item_text for j in JUNK_TERMS):
                score -= 80

            sim = difflib.SequenceMatcher(None, cleaned.lower(), item_text).ratio()
            score += int(sim * 60)
            ranked.append((score, sound_url, f"{clean_auth} - {clean_title}"))

        ranked.sort(key=lambda x: x[0], reverse=True)
        for _, sound_url, full_title in ranked[:4]:
            if _verify_stream_url(sound_url, referer="https://mp3.pm/"):
                logger.info(f"mp3.pm found verified stream for '{query}': {full_title}")
                return sound_url, full_title, 180
            logger.info(f"mp3.pm candidate dead, verifying next: {full_title}")
        return None
    except Exception as e:
        logger.warning(f"mp3.pm search failed for '{query}': {e}")
        return None


def _search_saavn(query: str) -> Optional[tuple[str, str, int]]:
    """
    Search JioSaavn for 320kbps Akamai/Azure CDN MP4 stream with DES decryption.
    """
    try:
        from Crypto.Cipher import DES
    except ImportError:
        return None

    cleaned = _clean_search_query(query)
    url = f"https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&_marker=0&api_version=4&ctx=web6dot0&p=1&n=5&q={quote(cleaned)}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=6) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            results = data.get("results", [])
            if not results:
                return None

            # Score and rank candidates to prioritize original studio release over karaoke
            target_words = set(re.findall(r"\w+", cleaned.lower()))
            ranked_results = []
            for item in results:
                title = item.get("title", "")
                subtitle = item.get("subtitle", "")
                text = f"{subtitle} {title}".lower()
                score = 100
                score += len(target_words.intersection(re.findall(r"\w+", text))) * 25
                if any(j in text for j in JUNK_TERMS):
                    score -= 90
                sim = difflib.SequenceMatcher(None, cleaned.lower(), text).ratio()
                score += int(sim * 60)
                ranked_results.append((score, item))

            ranked_results.sort(key=lambda x: x[0], reverse=True)

            for _, best in ranked_results:
                enc = best.get("more_info", {}).get("encrypted_media_url")
                if not enc:
                    continue
                raw = base64.b64decode(enc)
                cipher = DES.new(b"38346591", DES.MODE_ECB)
                dec = cipher.decrypt(raw)
                pad_len = dec[-1]
                base_url = dec[:-pad_len].decode("utf-8")
                hq_url = base_url.replace("_96.mp4", "_320.mp4")
                chosen_url = hq_url if _verify_stream_url(hq_url, referer="https://www.jiosaavn.com/") else base_url
                if _verify_stream_url(chosen_url, referer="https://www.jiosaavn.com/"):
                    dur = int(best.get("more_info", {}).get("duration") or 180)
                    title = best.get("title", query)
                    artist = best.get("subtitle", "")
                    full_title = f"{artist} - {title}" if artist else title
                    logger.info(f"JioSaavn found verified stream for '{query}': {full_title}")
                    return chosen_url, full_title, dur
    except Exception as e:
        logger.warning(f"JioSaavn search failed for '{query}': {e}")
    return None


def _search_soundcloud(query: str) -> Optional[tuple[str, str, int]]:
    """
    Search SoundCloud via yt-dlp scsearch1:.
    """
    cleaned = _clean_search_query(query)
    try:
        ydl_opts = {
            "format": "bestaudio/best",
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "socket_timeout": 8,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            res = ydl.extract_info(f"scsearch1:{cleaned}", download=False)
            if res and "entries" in res and res["entries"]:
                entry = res["entries"][0]
                audio_url = entry.get("url")
                if not audio_url and "requested_formats" in entry:
                    for f in entry["requested_formats"]:
                        if f.get("acodec") != "none" and f.get("url"):
                            audio_url = f.get("url")
                            break
                if audio_url:
                    title = entry.get("title", query)
                    dur = int(entry.get("duration") or 180)
                    logger.info(f"SoundCloud found match for '{query}': {title}")
                    return audio_url, title, dur
    except Exception as e:
        logger.warning(f"SoundCloud search failed for '{query}': {e}")
    return None


def _extract_audio_url(video_id: str, query_hint: str = "", force_refresh: bool = False) -> tuple[str, str, int]:
    """Rapidly extract a direct audio URL using multi-source cascade (mp3.pm -> JioSaavn -> SoundCloud -> YouTube)."""
    now = time.time()
    if not force_refresh and video_id in _stream_cache:
        ts, cached_url, cached_title, cached_dur = _stream_cache[video_id]
        if now - ts < STREAM_CACHE_TTL:
            return cached_url, cached_title, cached_dur

    # Resolve track metadata if query hint not supplied
    hint = (query_hint or "").strip()
    if not hint:
        try:
            meta = yt.get_song(video_id)
            details = meta.get("videoDetails", {})
            author = details.get("author", "")
            song_title = details.get("title", "")
            hint = f"{author} {song_title}".strip()
        except Exception:
            pass

    # Unauthenticated open metadata fallback via YouTube oEmbed
    if not hint:
        try:
            oembed_url = f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={video_id}&format=json"
            req = urllib.request.Request(oembed_url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=4) as resp:
                data = json.loads(resp.read().decode("utf-8", errors="ignore"))
                raw_title = data.get("title", "")
                raw_author = re.sub(r" - Topic$", "", data.get("author_name", "")).strip()
                hint = f"{raw_author} {raw_title}".strip()
        except Exception as oe_err:
            logger.debug(f"oEmbed title lookup failed for {video_id}: {oe_err}")

    # 1. Primary Provider: mp3.pm (fast direct MP3, byte ranges, zero bot detection)
    if hint:
        mp3_res = _search_mp3_pm(hint)
        if mp3_res:
            audio_url, title, dur = mp3_res
            _stream_cache[video_id] = (time.time(), audio_url, title, dur)
            return audio_url, title, dur

    # 2. Secondary Provider: JioSaavn 320kbps Akamai CDN stream
    if hint:
        saavn_res = _search_saavn(hint)
        if saavn_res:
            audio_url, title, dur = saavn_res
            _stream_cache[video_id] = (time.time(), audio_url, title, dur)
            return audio_url, title, dur

    # 3. Tertiary Provider: SoundCloud via yt-dlp
    if hint:
        sc_res = _search_soundcloud(hint)
        if sc_res:
            audio_url, title, dur = sc_res
            _stream_cache[video_id] = (time.time(), audio_url, title, dur)
            return audio_url, title, dur

    # 4. Quaternary Provider: YouTube Music direct & ytsearch fallback
    url = f"https://music.youtube.com/watch?v={video_id}"
    cookie_path = _get_cookie_file()
    po_token = os.environ.get("YOUTUBE_PO_TOKEN", "").strip()
    format_selector = "bestaudio/best"
    fast_strategies = [[], ["web"], ["mweb"], ["android_vr"], ["android"]]
    last_error = None

    for clients in fast_strategies:
        skip_cookie = any(c == "android" for c in clients)
        current_cookie = None if skip_cookie else cookie_path

        ydl_opts = {
            "format": format_selector,
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "socket_timeout": 15,
            "retries": 1,
            "fragment_retries": 1,
            "js_runtimes": {"node": {}},
            "plugin_dirs": ["/pot", "/app", "/root/.yt-dlp-plugins", "default"],
        }
        if not any(c in ("android_vr", "android", "android_music", "ios") for c in clients):
            ydl_opts["http_headers"] = YDL_HEADERS

        if current_cookie and os.path.exists(current_cookie):
            ydl_opts["cookiefile"] = current_cookie

        extractor_youtube = {}
        if clients:
            extractor_youtube["player_client"] = clients
        if po_token:
            extractor_youtube["po_token"] = [po_token if "+" in po_token else f"web+{po_token}"]
        if extractor_youtube:
            ydl_opts["extractor_args"] = {"youtube": extractor_youtube}

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)
                audio_url = info.get("url")
                if not audio_url and "requested_formats" in info:
                    for f in info["requested_formats"]:
                        if f.get("acodec") != "none" and f.get("url"):
                            audio_url = f.get("url")
                            break
                title = info.get("title", "audio")
                duration = info.get("duration", 0)
                if audio_url:
                    _stream_cache[video_id] = (time.time(), audio_url, title, duration)
                    return audio_url, title, duration
        except Exception as e:
            last_error = e
            logger.info(f"Direct yt-dlp extract failed for {video_id} (clients={clients}, cookie={bool(current_cookie)}): {e}")

    # Instant Fallback: YouTube search
    if hint:
        logger.info(f"Direct extract failed for {video_id}. Instant search fallback with hint: '{hint}'")
        for fallback_client in [["web"], ["mweb"], ["android_vr"], []]:
            try:
                skip_cookie = any(c == "android" for c in fallback_client)
                search_opts = {
                    "format": format_selector,
                    "quiet": True,
                    "no_warnings": True,
                    "skip_download": True,
                    "socket_timeout": 15,
                    "retries": 1,
                    "js_runtimes": {"node": {}},
                    "plugin_dirs": ["/pot", "/app", "/root/.yt-dlp-plugins", "default"],
                }
                if fallback_client:
                    search_opts["extractor_args"] = {"youtube": {"player_client": fallback_client}}
                if not any(c in ("android_vr", "android") for c in fallback_client):
                    search_opts["http_headers"] = YDL_HEADERS

                if not skip_cookie and cookie_path and os.path.exists(cookie_path):
                    search_opts["cookiefile"] = cookie_path
                if po_token:
                    if "extractor_args" not in search_opts:
                        search_opts["extractor_args"] = {"youtube": {}}
                    search_opts["extractor_args"]["youtube"]["po_token"] = [
                        po_token if "+" in po_token else f"web+{po_token}"
                    ]

                with yt_dlp.YoutubeDL(search_opts) as ydl:
                    search_info = ydl.extract_info(f"ytsearch1:{hint} audio", download=False)
                    if search_info and "entries" in search_info and search_info["entries"]:
                        entry = search_info["entries"][0]
                        audio_url = entry.get("url")
                        if not audio_url and "requested_formats" in entry:
                            for f in entry["requested_formats"]:
                                if f.get("acodec") != "none" and f.get("url"):
                                    audio_url = f.get("url")
                                    break
                        title = entry.get("title", "audio")
                        duration = entry.get("duration", 0)
                        if audio_url:
                            logger.info(f"Search fallback succeeded for {video_id} -> {entry.get('id')} ({title})")
                            _stream_cache[video_id] = (time.time(), audio_url, title, duration)
                            return audio_url, title, duration
            except Exception as fallback_err:
                logger.warning(f"Fallback search failed for '{hint}' (clients={fallback_client}): {fallback_err}")

    raise last_error or Exception("All audio extraction strategies failed")


# Shared httpx client for connection reuse
_http_client: Optional[httpx.AsyncClient] = None

async def _get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        # read=None allows infinite streaming without timing out mid-song
        timeout = httpx.Timeout(connect=10.0, read=None, write=15.0, pool=15.0)
        _http_client = httpx.AsyncClient(timeout=timeout, follow_redirects=True)
    return _http_client

@app.on_event("shutdown")
async def _shutdown():
    global _http_client
    if _http_client and not _http_client.is_closed:
        await _http_client.aclose()


# ═══════════════════════════════════════════════════════════════════════════════
#  TIER 1 — FIXED EXISTING ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

# ─── Search Ranking Engine ───────────────────────────────────────────────────
JUNK_TERMS = {
    "karaoke", "instrumental", "cover", "slowed", "reverb", "sped up",
    "nightcore", "tribute", "parody", "reaction", "remake", "ringtone",
    "snippet", "teaser", "8d audio", "bass boosted", "guitar cover",
    "piano cover", "piano tutorial", "acoustic cover", "live at",
    "live in concert", "audience", "fan cam", "reaction video"
}

def rank_search_results(query: str, raw_songs: list[dict], limit: int) -> list[dict]:
    """
    Score and rank search results like Spotify:
    - Fuzzy matching & typo tolerance (SequenceMatcher).
    - Prioritizes official studio album versions.
    - Heavily penalizes karaoke, covers, live concert phone recordings, instrumentals.
    - Drops shorts, snippets, and ringtones.
    - Promotes verified official artist releases.
    """
    q_lower = query.lower().strip()
    q_words = set(re.findall(r"\w+", q_lower))
    allow_junk = any(term in q_lower for term in JUNK_TERMS)
    allow_long = any(w in q_lower for w in ["mix", "album", "set", "podcast", "full", "live"])

    scored_tracks = []
    seen_ids = set()
    seen_canonical = set()

    for item in raw_songs:
        vid = item.get("videoId") or item.get("id")
        if not vid or vid in seen_ids:
            continue

        title = item.get("title") or ""
        artist = _get_artist_name(item) if "artists" in item else item.get("artist", "")
        formatted = format_track(item) if "videoId" in item else item

        if not is_full_song(formatted, allow_long=allow_long):
            continue

        title_lower = title.lower()
        artist_lower = artist.lower()
        score = 100.0

        # Exact title match boost
        if q_lower == title_lower:
            score += 160
        elif title_lower.startswith(q_lower):
            score += 90
        elif q_lower in title_lower:
            score += 60

        # Exact artist match boost
        if q_lower == artist_lower or q_lower in artist_lower:
            score += 70

        # Fuzzy string similarity (handles typos e.g. 'buran boy', 'asake peac')
        title_sim = difflib.SequenceMatcher(None, q_lower, title_lower).ratio()
        if title_sim > 0.8:
            score += 120 * title_sim
        elif title_sim > 0.6:
            score += 60 * title_sim

        artist_sim = difflib.SequenceMatcher(None, q_lower, artist_lower).ratio()
        if artist_sim > 0.8:
            score += 80 * artist_sim

        # Word overlap
        track_words = set(re.findall(r"\w+", f"{title_lower} {artist_lower}"))
        overlap = len(q_words.intersection(track_words))
        score += overlap * 30

        # Penalize non-studio junk unless explicitly queried
        if not allow_junk:
            for term in JUNK_TERMS:
                if term in title_lower:
                    score -= 140

        # Official Studio Album Boost (+35)
        if formatted.get("album"):
            score += 35

        # Canonical deduplication (keep the highest scoring release)
        canon_key = (normalize_title_for_dedup(title), artist_lower)
        if canon_key in seen_canonical:
            score -= 75

        seen_ids.add(vid)
        seen_canonical.add(canon_key)
        scored_tracks.append((score, formatted))

    scored_tracks.sort(key=lambda x: x[0], reverse=True)
    return [t[1] for t in scored_tracks[:limit]]


# ─── Search ────────────────────────────────────────────────────────────────────
@app.get("/api/search")
def search(
    q: str = "",
    limit: int = Query(default=20, le=50),
    user_id: Optional[str] = Query(None),
):
    """Search for songs with Spotify-grade relevance ranking & neural personalization."""
    if not q.strip():
        return {"songs": [], "query": ""}
    try:
        # Fetch extra candidates for intelligent re-ranking and junk filtering
        results = yt.search(q.strip(), filter="songs", limit=limit * 2 + 10)
        songs = rank_search_results(q.strip(), results, limit=limit * 2)
        # Apply neural personalization if user_id or profile is active
        if user_id:
            songs = pirate_brain.rerank_search_results(q.strip(), songs, user_id=user_id, limit=limit)
        else:
            songs = songs[:limit]
        return {"songs": songs, "query": q}
    except Exception as e:
        logger.error(f"Search error: {e}")
        raise HTTPException(status_code=502, detail="Search temporarily unavailable")


# ─── Search Suggestions (Autocomplete) ─────────────────────────────────────────
@app.get("/api/search-suggestions")
def search_suggestions(q: str = ""):
    """Instant search suggestions as user types (Spotify-like autocomplete)."""
    if not q.strip():
        return {"query": "", "suggestions": []}
    try:
        suggestions = yt.get_search_suggestions(q.strip())
        return {"query": q, "suggestions": suggestions}
    except Exception as e:
        logger.error(f"Search suggestions error: {e}")
        return {"query": q, "suggestions": []}


# ─── Audio Stream Proxy (HTTP Range support for native mobile buffering) ──────
@app.api_route("/api/stream-proxy/{video_id}", methods=["GET", "HEAD"])
async def stream_audio_proxy(
    video_id: str,
    request: Request,
    title: Optional[str] = Query(None),
    artist: Optional[str] = Query(None),
):
    """
    Streaming audio proxy with HTTP Range support (RFC 7233).
    Bypasses YouTube's IP-bound googlevideo.com URLs and datacenter IP blocks,
    enabling native mobile players (expo-av, ExoPlayer, AVPlayer) to buffer and seek.
    """
    vid = _validate_video_id(video_id)
    hint = f"{artist or ''} {title or ''}".strip()

    # 1. Resolve audio stream URL
    try:
        audio_url, _, _ = _extract_audio_url(vid, query_hint=hint)
    except Exception as e:
        logger.error(f"Stream proxy failed to extract audio for {vid}: {e}")
        raise HTTPException(status_code=502, detail="Failed to extract audio stream")

    client = await _get_http_client()

    # Forward client's Range header if present
    req_headers = {
        "User-Agent": YDL_HEADERS["User-Agent"],
        "Accept": "*/*",
    }
    if "googlevideo.com" in audio_url:
        req_headers["Referer"] = "https://www.youtube.com/"
    elif "mp3.pm" in audio_url:
        req_headers["Referer"] = "https://mp3.pm/"
    elif "saavncdn.com" in audio_url or "jiosaavn.com" in audio_url:
        req_headers["Referer"] = "https://www.jiosaavn.com/"

    range_header = request.headers.get("range")
    if range_header:
        req_headers["Range"] = range_header

    # Helper to send request to upstream googlevideo
    async def _send_upstream(url: str):
        upstream_req = client.build_request("GET", url, headers=req_headers)
        return await client.send(upstream_req, stream=True)

    try:
        upstream_resp = await _send_upstream(audio_url)
    except Exception as e:
        logger.warning(f"Upstream stream connection error for {vid}: {e}. Retrying fresh extraction...")
        _stream_cache.pop(vid, None)
        audio_url, _, _ = _extract_audio_url(vid, query_hint=hint, force_refresh=True)
        upstream_resp = await _send_upstream(audio_url)

    # If YouTube returns 403 Forbidden (URL expired or IP mismatch), invalidate cache and re-extract once
    if upstream_resp.status_code in (403, 410):
        await upstream_resp.aclose()
        logger.warning(f"Upstream returned {upstream_resp.status_code} for {vid}. Re-extracting fresh URL...")
        _stream_cache.pop(vid, None)
        try:
            audio_url, _, _ = _extract_audio_url(vid, query_hint=hint, force_refresh=True)
            upstream_resp = await _send_upstream(audio_url)
        except Exception as retry_err:
            logger.error(f"Re-extraction retry failed for {vid}: {retry_err}")
            raise HTTPException(status_code=502, detail="Upstream audio stream unavailable")

    # If still not 200 or 206, close and raise
    if upstream_resp.status_code not in (200, 206):
        status = upstream_resp.status_code
        await upstream_resp.aclose()
        logger.error(f"Upstream returned error {status} for {vid}")
        raise HTTPException(status_code=status if status < 500 else 502, detail="Upstream audio stream error")

    # Build response headers to stream back to client
    resp_headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=14400",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
    }
    for h in ("Content-Type", "Content-Length", "Content-Range"):
        val = upstream_resp.headers.get(h)
        if val:
            resp_headers[h] = val

    if "Content-Type" not in resp_headers:
        if ".mp3" in audio_url.lower():
            resp_headers["Content-Type"] = "audio/mpeg"
        else:
            resp_headers["Content-Type"] = "audio/mp4"

    # If HEAD request, return headers immediately without streaming body
    if request.method == "HEAD":
        await upstream_resp.aclose()
        return Response(status_code=upstream_resp.status_code, headers=resp_headers)

    async def _body_streamer():
        try:
            async for chunk in upstream_resp.aiter_bytes(chunk_size=65536):
                yield chunk
        except (asyncio.CancelledError, GeneratorExit):
            # Client disconnected / stopped playback — clean exit
            pass
        except Exception as stream_err:
            logger.debug(f"Stream interrupted for {vid}: {stream_err}")
        finally:
            await upstream_resp.aclose()

    return StreamingResponse(
        _body_streamer(),
        status_code=upstream_resp.status_code,
        headers=resp_headers,
    )


# ─── Audio URL (NEW — for Expo native playback) ───────────────────────────────
@app.get("/api/audio-url/{video_id}")
def get_audio_url(
    video_id: str,
    request: Request,
    title: Optional[str] = Query(None),
    artist: Optional[str] = Query(None),
    direct: bool = Query(False),
    user_id: Optional[str] = Query(None),
):
    """Returns an audio stream URL for native playback (expo-av / expo-audio).
    External CDNs (mp3.pm, JioSaavn, SoundCloud) stream directly with zero latency & CORS.
    YouTube googlevideo streams fallback through the streaming proxy to bypass IP-lockouts.
    """
    vid = _validate_video_id(video_id)
    hint = f"{artist or ''} {title or ''}".strip()
    try:
        audio_url, extracted_title, duration = _extract_audio_url(vid, query_hint=hint)
        base_url = _get_base_url(request)

        # Passive neural telemetry: register listen start event
        resolved_artist = artist or (extracted_title.split("-")[0].strip() if "-" in extracted_title else "")
        resolved_title = title or (extracted_title.split("-")[1].strip() if "-" in extracted_title else extracted_title)
        if resolved_title:
            try:
                pirate_brain.record_interaction(
                    user_id=user_id or "default_user",
                    track_id=vid,
                    title=resolved_title,
                    artist=resolved_artist or "Unknown",
                    action="listen_start",
                    total_duration=duration or 180,
                )
            except Exception:
                pass

        params = []
        if title:
            params.append(f"title={quote(title)}")
        if artist:
            params.append(f"artist={quote(artist)}")
        if user_id:
            params.append(f"user_id={quote(user_id)}")
        qs = f"?{'&'.join(params)}" if params else ""

        proxy_url = f"{base_url}/api/stream-proxy/{vid}{qs}"

        is_external_cdn = any(
            cdn in audio_url
            for cdn in ["mp3.pm", "saavncdn.com", "jiosaavn.com", "sndcdn.com", "soundcloud.cloud"]
        )

        source_name = "youtube"
        if "mp3.pm" in audio_url:
            source_name = "mp3.pm"
        elif "saavncdn.com" in audio_url or "jiosaavn.com" in audio_url:
            source_name = "jiosaavn"
        elif "sndcdn.com" in audio_url or "soundcloud.cloud" in audio_url:
            source_name = "soundcloud"

        return {
            "videoId": vid,
            "audioUrl": audio_url if (direct or is_external_cdn) else proxy_url,
            "directAudioUrl": audio_url,
            "proxyUrl": proxy_url,
            "title": extracted_title or title or "audio",
            "duration": duration,
            "proxied": not (direct or is_external_cdn),
            "source": source_name,
        }
    except Exception as e:
        logger.error(f"Audio URL extraction failed for {vid} (hint='{hint}'): {e}")
        raise HTTPException(status_code=502, detail="Failed to extract audio URL")


class CookiePayload(BaseModel):
    content: Optional[str] = None
    b64_content: Optional[str] = None


@app.post("/api/admin/cookies")
def update_cookies(payload: CookiePayload):
    """Dynamically upload or replace YouTube cookies on the running instance."""
    global _cookie_file_path, _stream_cache
    text = payload.content
    if not text and payload.b64_content:
        try:
            text = base64.b64decode(payload.b64_content.strip()).decode("utf-8", errors="ignore")
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid base64: {e}")
    if not text or len(text.strip()) < 10:
        raise HTTPException(status_code=400, detail="Cookie content is empty or too short")

    target = os.path.join(tempfile.gettempdir(), "youtube_cookies.txt")
    with open(target, "w", encoding="utf-8") as f:
        f.write(text.strip())
    _cookie_file_path = target
    _stream_cache.clear()
    lines = [l.strip() for l in text.strip().splitlines() if l.strip() and not l.startswith("#")]
    names = [l.split("\t")[5] for l in lines if len(l.split("\t")) >= 6]
    logger.info(f"Admin updated cookies: {len(names)} cookies ({len(text)} bytes)")
    return {
        "status": "ok",
        "file": target,
        "size": len(text),
        "count": len(names),
        "cookies": names,
    }


@app.get("/api/admin/cookies/reload")
def reload_cookies():
    """Force re-reading YOUTUBE_COOKIES_B64 or disk cookies."""
    global _cookie_file_path, _stream_cache
    _cookie_file_path = None
    _stream_cache.clear()
    cookie_file = _get_cookie_file()
    names = []
    if cookie_file and os.path.exists(cookie_file):
        with open(cookie_file, "r", encoding="utf-8") as f:
            lines = [l.strip() for l in f if l.strip() and not l.startswith("#")]
            names = [l.split("\t")[5] for l in lines if len(l.split("\t")) >= 6]
    return {
        "status": "ok",
        "cookie_file": cookie_file,
        "cookie_count": len(names),
        "cookie_names": names,
    }


@app.get("/api/debug/extract/{video_id}")
def debug_extract(video_id: str, title: Optional[str] = Query(None), artist: Optional[str] = Query(None)):
    """Diagnostic endpoint to inspect extraction behavior directly on Azure."""
    results = {"video_id": video_id}
    cookie_file = _get_cookie_file()
    results["cookie_file"] = cookie_file
    results["cookie_exists"] = bool(cookie_file and os.path.exists(cookie_file))
    if results["cookie_exists"]:
        results["cookie_size"] = os.path.getsize(cookie_file)
        try:
            with open(cookie_file, "r", encoding="utf-8") as f:
                lines = [l.strip() for l in f if l.strip() and not l.startswith("#")]
                results["cookie_count"] = len(lines)
                results["cookie_names"] = [l.split("\t")[5] for l in lines if len(l.split("\t")) >= 6]
        except Exception as ce:
            results["cookie_read_error"] = str(ce)

    # Check if local POT provider server is responding on 127.0.0.1:4416
    try:
        import urllib.request
        req = urllib.request.urlopen("http://127.0.0.1:4416/ping", timeout=2)
        results["pot_provider_status"] = req.read().decode("utf-8").strip()
    except Exception as pe:
        results["pot_provider_status"] = str(pe)

    # Check formats available with default client
    results["pot_plugins_found"] = os.path.exists("/app/yt_dlp_plugins") or os.path.exists("/pot/plugin/yt_dlp_plugins")
    try:
        ydl_opts_all = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "socket_timeout": 15,
            "plugin_dirs": ["/pot", "/app", "/root/.yt-dlp-plugins", "default"],
        }
        if cookie_file and os.path.exists(cookie_file):
            ydl_opts_all["cookiefile"] = cookie_file
        with yt_dlp.YoutubeDL(ydl_opts_all) as ydl:
            all_info = ydl.extract_info(f"https://music.youtube.com/watch?v={video_id}", download=False)
            results["available_formats"] = [
                {
                    "id": f.get("format_id"),
                    "ext": f.get("ext"),
                    "vcodec": f.get("vcodec"),
                    "acodec": f.get("acodec"),
                    "has_url": bool(f.get("url")),
                    "protocol": f.get("protocol"),
                }
                for f in all_info.get("formats", [])
            ]
    except Exception as fe:
        results["available_formats_error"] = str(fe)

    format_sel = "bestaudio[ext=m4a]/bestaudio/best[height<=360]/best[height<=480]/best"
    for client in ["default", "web", "mweb", "android_vr", "ios", "android"]:
        try:
            ydl_opts = {
                "format": format_sel,
                "quiet": True,
                "no_warnings": True,
                "skip_download": True,
                "socket_timeout": 15,
                "plugin_dirs": ["/pot", "/app", "/root/.yt-dlp-plugins", "default"],
            }
            if client != "default":
                ydl_opts["extractor_args"] = {"youtube": {"player_client": [client]}}
            # Only 'android' client must not receive cookies; all other clients support cookies
            if client != "android" and cookie_file and os.path.exists(cookie_file):
                ydl_opts["cookiefile"] = cookie_file
            if client not in ("android", "android_vr", "ios"):
                ydl_opts["http_headers"] = YDL_HEADERS
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(f"https://music.youtube.com/watch?v={video_id}", download=False)
                audio_url = info.get("url")
                if not audio_url and "requested_formats" in info:
                    for f in info["requested_formats"]:
                        if f.get("acodec") != "none" and f.get("url"):
                            audio_url = f.get("url")
                            break
                results[client] = {
                    "success": bool(audio_url),
                    "url": (audio_url or "")[:70] + "..." if audio_url else None,
                    "format_id": info.get("format_id"),
                    "ext": info.get("ext"),
                }
        except Exception as e:
            results[client] = {
                "success": False,
                "error": str(e),
            }
    return results


# ─── Stream URL (kept for backward compat) ────────────────────────────────────
@app.get("/api/stream/{video_id}")
def get_stream_url(video_id: str):
    """Returns YouTube embed/watch URLs for a video."""
    vid = _validate_video_id(video_id)
    return {
        "videoId": vid,
        "embedUrl": f"https://www.youtube.com/embed/{vid}?autoplay=1&controls=0",
        "watchUrl": f"https://music.youtube.com/watch?v={vid}",
    }


# ─── Download ──────────────────────────────────────────────────────────────────
@app.get("/api/download/{video_id}")
def download_song(
    video_id: str,
    title: Optional[str] = Query(None),
    artist: Optional[str] = Query(None),
):
    """Extracts audio and streams it as MP3 via ffmpeg pipe."""
    vid = _validate_video_id(video_id)
    hint = f"{artist or ''} {title or ''}".strip()

    try:
        audio_url, resolved_title, _ = _extract_audio_url(vid, query_hint=hint)
    except Exception as e:
        logger.error(f"Download extract error for {vid}: {e}")
        raise HTTPException(status_code=502, detail="Failed to extract audio")

    safe_title = re.sub(r'[<>:"/\\|?*\r\n]', '', resolved_title or title or vid).strip() or vid
    filename = f"{safe_title}.mp3"

    ffmpeg_headers = f"User-Agent: {YDL_HEADERS['User-Agent']}\r\n"
    if "googlevideo.com" in audio_url:
        ffmpeg_headers += "Referer: https://www.youtube.com/\r\n"
    elif "mp3.pm" in audio_url:
        ffmpeg_headers += "Referer: https://mp3.pm/\r\n"
    elif "saavncdn.com" in audio_url or "jiosaavn.com" in audio_url:
        ffmpeg_headers += "Referer: https://www.jiosaavn.com/\r\n"

    ffmpeg_cmd = [
        FFMPEG_PATH,
        "-reconnect", "1",
        "-reconnect_streamed", "1",
        "-reconnect_delay_max", "5",
        "-headers", ffmpeg_headers,
        "-i", audio_url,
        "-vn",
        "-ar", "44100",
        "-ac", "2",
        "-b:a", "192k",
        "-f", "mp3",
        "pipe:1",
    ]

    async def stream_audio():
        proc = await asyncio.create_subprocess_exec(
            *ffmpeg_cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            while True:
                chunk = await proc.stdout.read(65536)
                if not chunk:
                    break
                yield chunk
        finally:
            try:
                proc.kill()
            except Exception:
                pass
            await proc.wait()

    return StreamingResponse(
        stream_audio(),
        media_type="audio/mpeg",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ─── Synced Lyrics Engine (Spotify-Grade LRCLIB + YTMusic Fallback) ───────────
def parse_lrc_lines(lrc_text: str) -> list[dict]:
    """Parse standard LRC synchronized lyrics into a list of {time: float, text: str}."""
    lines = []
    pattern = re.compile(r"\[(\d{1,2}):(\d{2}(?:\.\d{1,3})?)\](.*)")
    for raw_line in lrc_text.splitlines():
        match = pattern.match(raw_line.strip())
        if match:
            minutes = int(match.group(1))
            seconds = float(match.group(2))
            total_seconds = round(minutes * 60 + seconds, 2)
            text = match.group(3).strip()
            lines.append({"time": total_seconds, "text": text})
    return lines

@app.get("/api/lyrics/{video_id}")
async def get_lyrics(
    video_id: str,
    title: Optional[str] = Query(default=None),
    artist: Optional[str] = Query(default=None),
    duration: Optional[int] = Query(default=None),
):
    """
    Fetch lyrics for a track:
    1. Queries LRCLIB for Spotify-grade millisecond-synced line-by-line lyrics.
    2. Falls back to YouTube Music lyrics (plain text).
    """
    vid = _validate_video_id(video_id)

    # 1. Resolve track and artist title if not provided by client
    song_title = title
    artist_name = artist
    if not song_title or not artist_name:
        try:
            watch = yt.get_watch_playlist(vid)
            tracks = watch.get("tracks", [])
            if tracks:
                first = tracks[0]
                song_title = song_title or first.get("title", "")
                artist_name = artist_name or _get_artist_name(first)
        except Exception as e:
            logger.warning(f"Metadata lookup for lyrics failed: {e}")

    # 2. Query LRCLIB for millisecond-synced lyrics
    if song_title and artist_name:
        clean_title = re.sub(r"\s*[\(\[\{].*?[\)\]\}]", "", song_title).strip()
        try:
            client = await _get_http_client()
            params = {
                "track_name": clean_title,
                "artist_name": artist_name,
            }
            if duration and duration > 0:
                params["duration"] = duration

            resp = await client.get("https://lrclib.net/api/get", params=params, timeout=5.0)
            if resp.status_code == 200:
                data = resp.json()
                synced_raw = data.get("syncedLyrics")
                if synced_raw:
                    parsed_lines = parse_lrc_lines(synced_raw)
                    return {
                        "lyrics": data.get("plainLyrics") or synced_raw,
                        "syncedLyrics": parsed_lines,
                        "hasTimestamps": True,
                        "source": "lrclib",
                        "trackName": data.get("trackName"),
                        "artistName": data.get("artistName"),
                    }
                elif data.get("plainLyrics"):
                    return {
                        "lyrics": data.get("plainLyrics"),
                        "syncedLyrics": [],
                        "hasTimestamps": False,
                        "source": "lrclib",
                        "trackName": data.get("trackName"),
                        "artistName": data.get("artistName"),
                    }
        except Exception as e:
            logger.warning(f"LRCLIB synced lyrics lookup failed for '{clean_title}': {e}")

    # 3. Fallback to YouTube Music lyrics
    try:
        next_data = yt.get_watch_playlist(vid)
        lyrics_browse_id = next_data.get("lyrics")
        if lyrics_browse_id:
            lyrics_data = yt.get_lyrics(lyrics_browse_id)
            if lyrics_data and lyrics_data.get("lyrics"):
                return {
                    "lyrics": lyrics_data.get("lyrics", ""),
                    "syncedLyrics": [],
                    "source": lyrics_data.get("source", "ytmusic"),
                    "hasTimestamps": False,
                }
    except Exception as e:
        logger.error(f"YTMusic fallback lyrics error for {vid}: {e}")

    return {
        "lyrics": None,
        "syncedLyrics": [],
        "hasTimestamps": False,
        "source": None,
    }


# ─── Recommendations ──────────────────────────────────────────────────────────
@app.get("/api/recommendations")
def get_recommendations(time_of_day: str = "afternoon"):
    """Get song recommendations based on time of day."""
    year = _current_year()
    queries = {
        "morning": ["Morning acoustic songs", "Wake up happy hits", "Morning coffee pop"],
        "afternoon": ["Top 50 global hits", "Current pop hits", f"Trending music {year}"],
        "night": ["Late night lofi", "Midnight chill R&B", "Sleep vibes songs"],
    }
    time_key = time_of_day.lower() if time_of_day.lower() in queries else "afternoon"
    query = random.choice(queries[time_key])
    songs = search_songs(query, 10)
    return {"time": time_key, "query": query, "songs": songs}


# ─── Moods ─────────────────────────────────────────────────────────────────────
@app.get("/api/moods")
@cached(ttl_seconds=3600)
def get_moods():
    """Get mood-based playlists. Cached for 1 hour."""
    year = _current_year()
    mood_queries = [
        {"label": "Workout",    "emoji": "💪", "query": "gym workout motivation hits"},
        {"label": "Party",      "emoji": "🎉", "query": f"party hits {year}"},
        {"label": "Focus",      "emoji": "🎧", "query": "study focus deep work music"},
        {"label": "Romance",    "emoji": "❤️", "query": "romantic love songs"},
        {"label": "Throwbacks", "emoji": "⏪", "query": "2000s throwback hits"},
        {"label": "Gaming",     "emoji": "🎮", "query": "gaming montage EDM trap"},
        {"label": "Acoustic",   "emoji": "🎸", "query": "acoustic covers chill"},
        {"label": "Late Night", "emoji": "🌃", "query": "late night drive lo-fi"},
        {"label": "Upbeat",     "emoji": "✨", "query": "feel good happy pop hits"},
    ]
    result = []
    for mood in mood_queries:
        songs = search_songs(mood["query"], 6)
        if songs:
            result.append({
                "label": mood["label"],
                "emoji": mood["emoji"],
                "cover": songs[0]["cover"] if songs else "",
                "songs": songs,
            })
    return {"moods": result}


# ─── Trending ──────────────────────────────────────────────────────────────────
@app.get("/api/trending")
@cached(ttl_seconds=1800)
def get_trending(country: str = "US"):
    """Get trending songs. Cached for 30 minutes."""
    year = _current_year()
    country_keyword = "Nigeria" if country == "NG" else ("UK" if country == "GB" else country)
    query = f"trending music {country_keyword} {year}" if country != "US" else f"trending songs {year} hits"
    try:
        songs = search_songs(query, 15)
        if songs:
            return {"songs": songs}
    except Exception as e:
        logger.error(f"Trending query error: {e}")

    # Fallback to general trending hits
    songs = search_songs("top hits trending songs", 15)
    return {"songs": songs}


# ─── Check These Out ──────────────────────────────────────────────────────────
@app.get("/api/check-these-out")
@cached(ttl_seconds=3600)
def get_check_these_out():
    """Get curated playlist suggestions. Cached for 1 hour."""
    year = _current_year()
    try:
        results = yt.search(f"popular mix {year} hits", filter="playlists", limit=6)
        playlists = [_format_playlist(r) for r in results]
        return {"playlists": playlists}
    except Exception as e:
        logger.error(f"Check these out error: {e}")
        raise HTTPException(status_code=502, detail="Could not load playlists")


# ─── Spotify Playlists ────────────────────────────────────────────────────────
@app.get("/api/spotify-playlists")
@cached(ttl_seconds=3600)
def get_spotify_playlists():
    """Get Spotify-curated playlists from YouTube Music. Cached for 1 hour."""
    try:
        results = yt.search("spotify top 50 viral", filter="playlists", limit=8)
        playlists = [_format_playlist(r) for r in results]
        return {"playlists": playlists}
    except Exception as e:
        logger.error(f"Spotify playlists error: {e}")
        raise HTTPException(status_code=502, detail="Could not load playlists")


# ─── Playlist Details ─────────────────────────────────────────────────────────
@app.get("/api/playlist/{browse_id}")
def get_playlist(browse_id: str, title: str = ""):
    """Get tracks in a playlist by its browse ID."""
    try:
        clean_id = browse_id.replace("VLPL", "PL") if browse_id.startswith("VLPL") else browse_id
        playlist = yt.get_playlist(clean_id)
        songs = []
        for track in playlist.get("tracks", []):
            vid = track.get("videoId")
            if not vid:
                continue
            songs.append(format_track(track))
        if songs:
            return {"songs": songs}
    except Exception as e:
        logger.error(f"Playlist error for {browse_id}: {e}")

    if title:
        try:
            fallback_songs = search_songs(title + " playlist", 20)
            if fallback_songs:
                return {"songs": fallback_songs}
        except Exception as e:
            logger.error(f"Playlist fallback search failed: {e}")

    return {"songs": []}


# ─── Artist Info ───────────────────────────────────────────────────────────────
@app.get("/api/artist-info/{artist_name}")
def get_artist_info(artist_name: str):
    """Get artist profile info (image, bio, subscribers)."""
    try:
        search_results = yt.search(artist_name, filter="artists", limit=1)
        if not search_results:
            raise HTTPException(status_code=404, detail="Artist not found")
        artist_id = search_results[0].get("browseId")
        if not artist_id:
            raise HTTPException(status_code=404, detail="Artist not found")
        artist_data = yt.get_artist(artist_id)
        return {
            "id": artist_id,
            "name": artist_data.get("name"),
            "subscribers": artist_data.get("subscribers"),
            "monthlyListeners": artist_data.get("monthlyListeners"),
            "description": artist_data.get("description"),
            "image": _get_cover_url(artist_data),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Artist info error for '{artist_name}': {e}")
        raise HTTPException(status_code=502, detail="Could not load artist info")


# ─── Because You Listened ─────────────────────────────────────────────────────
@app.get("/api/because-you-listened")
def because_you_listened(artist: str = ""):
    """Get recommendations based on an artist."""
    if not artist:
        return {"songs": []}
    songs = search_songs(f"songs similar to {artist}", 8)
    return {"artist": artist, "songs": songs}


# ─── New Releases ─────────────────────────────────────────────────────────────
@app.get("/api/new-releases")
@cached(ttl_seconds=3600)
def new_releases():
    """Get new music releases. Cached for 1 hour."""
    year = _current_year()
    songs = search_songs(f"new music releases {year}", 10)
    return {"songs": songs}


# ─── Search Playlists ─────────────────────────────────────────────────────────
@app.get("/api/search-playlists")
def search_playlists(q: str = ""):
    """Search for playlists by query."""
    if not q:
        return {"playlists": []}
    try:
        results = yt.search(q, filter="playlists", limit=12)
        playlists = [_format_playlist(r) for r in results]
        return {"playlists": playlists}
    except Exception as e:
        logger.error(f"Playlist search error: {e}")
        raise HTTPException(status_code=502, detail="Playlist search unavailable")


# ─── AI Playlist ──────────────────────────────────────────────────────────────
@app.get("/api/ai-playlist")
def ai_playlist(prompt: str = ""):
    """Generate a playlist from a natural language prompt."""
    if not prompt:
        return {"songs": [], "prompt": ""}
    songs = search_songs(f"{prompt} playlist", 50)
    return {"prompt": prompt, "songs": songs}


# ─── Artist Discography ───────────────────────────────────────────────────────
@app.get("/api/artist")
def get_artist_songs(name: str = ""):
    """Get an artist's top songs."""
    if not name:
        return {"songs": []}
    songs = search_songs(f"{name} songs", 50)
    return {"artist": name, "songs": songs}


# ─── Image Proxy (SSRF-safe) ──────────────────────────────────────────────────
ALLOWED_IMAGE_DOMAINS = [
    "lh3.googleusercontent.com",
    "i.ytimg.com",
    "yt3.ggpht.com",
    "yt3.googleusercontent.com",
    "music.youtube.com",
    "i.scdn.co",
]

MAX_IMAGE_SIZE = 5 * 1024 * 1024


@app.get("/api/proxy-image")
async def proxy_image(url: str = ""):
    """Proxy images to avoid CORS issues. Only allows trusted domains."""
    if not url:
        raise HTTPException(status_code=400, detail="Missing url parameter")

    from urllib.parse import urlparse
    parsed = urlparse(url)
    if parsed.hostname not in ALLOWED_IMAGE_DOMAINS:
        raise HTTPException(status_code=403, detail="Domain not allowed")
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="Invalid URL scheme")

    try:
        client = await _get_http_client()
        resp = await client.get(url, headers={"User-Agent": "Mozilla/5.0"})
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail="Failed to fetch image")
        content_length = resp.headers.get("content-length")
        if content_length and int(content_length) > MAX_IMAGE_SIZE:
            raise HTTPException(status_code=413, detail="Image too large")
        if len(resp.content) > MAX_IMAGE_SIZE:
            raise HTTPException(status_code=413, detail="Image too large")
        content_type = resp.headers.get("content-type", "image/jpeg")
        return Response(content=resp.content, media_type=content_type)
    except HTTPException:
        raise
    except httpx.RequestError as e:
        logger.error(f"Image proxy error: {e}")
        raise HTTPException(status_code=502, detail="Image fetch error")


# ═══════════════════════════════════════════════════════════════════════════════
#  TIER 2 — NEW ENDPOINTS FOR SCREEN DESIGNS
# ═══════════════════════════════════════════════════════════════════════════════

# ─── Search Albums ─────────────────────────────────────────────────────────────
@app.get("/api/search-albums")
def search_albums(q: str = ""):
    """Search for albums by query (for Search screen Albums tab)."""
    if not q:
        return {"albums": []}
    try:
        results = yt.search(q, filter="albums", limit=12)
        albums = []
        for r in results:
            albums.append({
                "browseId": r.get("browseId"),
                "title": r.get("title"),
                "artist": _get_artist_name(r),
                "year": r.get("year"),
                "cover": _get_cover_url(r),
                "type": r.get("type", "Album"),
            })
        return {"albums": albums}
    except Exception as e:
        logger.error(f"Album search error: {e}")
        raise HTTPException(status_code=502, detail="Album search unavailable")


# ─── Album Details ─────────────────────────────────────────────────────────────
@app.get("/api/album/{album_id}")
def get_album(album_id: str):
    """Get full album tracklist and metadata (for Album Page screen)."""
    try:
        album = yt.get_album(album_id)
        tracks = []
        for track in album.get("tracks", []):
            vid = track.get("videoId")
            if not vid:
                continue
            tracks.append(format_track(track))

        # Get artist name from the album's artist list
        album_artists = album.get("artists", [])
        artist_name = album_artists[0].get("name", "Unknown Artist") if album_artists else "Unknown Artist"

        return {
            "id": album_id,
            "title": album.get("title"),
            "artist": artist_name,
            "year": album.get("year"),
            "cover": _get_cover_url(album),
            "description": album.get("description", ""),
            "trackCount": len(tracks),
            "duration": album.get("duration", ""),
            "tracks": tracks,
        }
    except Exception as e:
        logger.error(f"Album error for {album_id}: {e}")
        raise HTTPException(status_code=502, detail="Could not load album")


# ─── Song Info (Song World — About tab) ───────────────────────────────────────
@app.get("/api/song-info/{video_id}")
def get_song_info(video_id: str):
    """Get detailed song information (for Song World screen About tab)."""
    vid = _validate_video_id(video_id)
    try:
        watch = yt.get_watch_playlist(vid)
        tracks = watch.get("tracks", [])
        song_data = tracks[0] if tracks else {}

        lyrics_browse = watch.get("lyrics")
        lyrics_source = None
        if lyrics_browse:
            try:
                ld = yt.get_lyrics(lyrics_browse)
                lyrics_source = ld.get("source", "")
            except Exception:
                pass

        return {
            "id": vid,
            "title": song_data.get("title"),
            "artist": _get_artist_name(song_data),
            "album": (song_data.get("album") or {}).get("name", ""),
            "cover": _get_cover_url(song_data),
            "duration": song_data.get("length", ""),
            "year": song_data.get("year", ""),
            "lyricsSource": lyrics_source,
        }
    except Exception as e:
        logger.error(f"Song info error for {vid}: {e}")
        raise HTTPException(status_code=502, detail="Could not load song info")


# ─── Similar Songs (Song World — Similar tab) ─────────────────────────────────
@app.get("/api/similar/{video_id}")
def get_similar(video_id: str):
    """Get similar songs via YouTube Music radio/watch playlist."""
    vid = _validate_video_id(video_id)
    try:
        watch = yt.get_watch_playlist(vid, limit=20)
        tracks = watch.get("tracks", [])
        songs = [format_track(t) for t in tracks[1:] if t.get("videoId")]
        return {"songs": songs}
    except Exception as e:
        logger.error(f"Similar songs error for {vid}: {e}")
        raise HTTPException(status_code=502, detail="Could not load similar songs")


# ─── Artist Albums (Artist Page — Albums tab) ─────────────────────────────────
@app.get("/api/artist-albums/{artist_id}")
def get_artist_albums(artist_id: str):
    """Get an artist's album discography (for Artist Page Albums tab)."""
    try:
        artist_data = yt.get_artist(artist_id)
        albums_section = artist_data.get("albums", {})
        albums_list = albums_section.get("results", [])

        albums = []
        for a in albums_list:
            albums.append({
                "browseId": a.get("browseId"),
                "title": a.get("title"),
                "year": a.get("year"),
                "cover": _get_cover_url(a),
                "type": a.get("type", "Album"),
            })

        singles_section = artist_data.get("singles", {})
        singles_list = singles_section.get("results", [])
        singles = []
        for s in singles_list:
            singles.append({
                "browseId": s.get("browseId"),
                "title": s.get("title"),
                "year": s.get("year"),
                "cover": _get_cover_url(s),
                "type": "Single",
            })

        return {
            "artistId": artist_id,
            "albums": albums,
            "singles": singles,
        }
    except Exception as e:
        logger.error(f"Artist albums error for {artist_id}: {e}")
        raise HTTPException(status_code=502, detail="Could not load artist albums")


# ─── Genres (Discover — Genres tab) ───────────────────────────────────────────
@app.get("/api/genres")
@cached(ttl_seconds=7200)
def get_genres():
    """Get genre categories with sample tracks. Cached 2 hours."""
    genre_list = [
        {"label": "Afrobeats", "query": "afrobeats hits"},
        {"label": "Hip Hop", "query": "hip hop hits"},
        {"label": "R&B", "query": "r&b soul hits"},
        {"label": "Pop", "query": "pop hits"},
        {"label": "Amapiano", "query": "amapiano hits"},
        {"label": "Highlife", "query": "highlife music"},
        {"label": "Rock", "query": "rock classics"},
        {"label": "Jazz", "query": "jazz smooth"},
        {"label": "Gospel", "query": "gospel praise worship"},
        {"label": "EDM", "query": "electronic dance music hits"},
        {"label": "Latin", "query": "latin reggaeton hits"},
        {"label": "Country", "query": "country hits"},
    ]
    result = []
    for genre in genre_list:
        songs = search_songs(genre["query"], 6)
        if songs:
            result.append({
                "label": genre["label"],
                "cover": songs[0]["cover"] if songs else "",
                "songs": songs,
            })
    return {"genres": result}


# ─── Trending by Location (Discover — Locations tab) ──────────────────────────
@app.get("/api/trending-by-location")
@cached(ttl_seconds=1800)
def trending_by_location(country: str = "US"):
    """Get trending charts for a specific country."""
    country_names = {
        "NG": "Nigeria",
        "US": "United States",
        "GB": "United Kingdom",
        "GH": "Ghana",
        "ZA": "South Africa",
        "KE": "Kenya",
        "CA": "Canada",
        "FR": "France",
        "DE": "Germany",
        "JP": "Japan",
        "KR": "South Korea",
        "BR": "Brazil",
        "IN": "India",
        "AU": "Australia",
    }
    c_name = country_names.get(country.upper(), country)
    year = _current_year()
    try:
        songs = search_songs(f"top songs {c_name} {year}", 20)
        if not songs:
            songs = search_songs(f"trending hits {c_name}", 20)
        return {"country": country, "countryName": c_name, "songs": songs}
    except Exception as e:
        logger.error(f"Trending by location error for {country}: {e}")
        return {"country": country, "countryName": c_name, "songs": []}


# ─── Available Countries ──────────────────────────────────────────────────────
@app.get("/api/locations")
def get_locations():
    """Get available countries for the Locations tab."""
    locations = [
        {"code": "NG", "name": "Nigeria", "emoji": "🇳🇬"},
        {"code": "US", "name": "United States", "emoji": "🇺🇸"},
        {"code": "GB", "name": "United Kingdom", "emoji": "🇬🇧"},
        {"code": "GH", "name": "Ghana", "emoji": "🇬🇭"},
        {"code": "ZA", "name": "South Africa", "emoji": "🇿🇦"},
        {"code": "KE", "name": "Kenya", "emoji": "🇰🇪"},
        {"code": "CA", "name": "Canada", "emoji": "🇨🇦"},
        {"code": "FR", "name": "France", "emoji": "🇫🇷"},
        {"code": "DE", "name": "Germany", "emoji": "🇩🇪"},
        {"code": "JP", "name": "Japan", "emoji": "🇯🇵"},
        {"code": "KR", "name": "South Korea", "emoji": "🇰🇷"},
        {"code": "BR", "name": "Brazil", "emoji": "🇧🇷"},
        {"code": "IN", "name": "India", "emoji": "🇮🇳"},
        {"code": "AU", "name": "Australia", "emoji": "🇦🇺"},
    ]
    return {"locations": locations}


# ─── AI Chat / Music Concierge ─────────────────────────────────────────────────
@app.get("/api/ai-chat")
def ai_chat(message: str = ""):
    """AI Music Concierge — conversational prompt to curated playlist."""
    if not message:
        return {"response": "", "songs": [], "playlistTitle": ""}

    msg_lower = message.lower()
    query = message
    playlist_title = ""

    mood_map = {
        "stress": ("calm relaxing acoustic", "Stress Relief"),
        "sad": ("uplifting feel good happy", "Mood Lifter"),
        "happy": ("happy upbeat dance", "Happy Vibes"),
        "workout": ("gym workout high energy", "Workout Beast"),
        "sleep": ("sleep calm ambient", "Sleep Sounds"),
        "focus": ("focus study lo-fi", "Deep Focus"),
        "party": ("party dance hits", "Party Starter"),
        "drive": ("driving road trip", "Road Trip"),
        "chill": ("chill vibes lo-fi", "Chill Mode"),
        "romantic": ("romantic love songs", "Love Songs"),
        "energetic": ("high energy pump up", "Energy Boost"),
    }

    for keyword, (search_query, title) in mood_map.items():
        if keyword in msg_lower:
            query = search_query
            playlist_title = title
            break

    if not playlist_title:
        playlist_title = f"For You: {message[:40]}"

    songs = search_songs(query, 20)

    response = f"I made a {len(songs)}-track journey based on your vibe. "
    if "stress" in msg_lower or "calm" in msg_lower:
        response += "These tracks blend calm Afrobeats with atmospheric R&B to help you unwind."
    elif "sad" in msg_lower:
        response += "Here's something to lift your spirits — upbeat vibes incoming."
    elif "party" in msg_lower or "dance" in msg_lower:
        response += "Let's get the energy up! These tracks will keep the vibe going."
    elif "drive" in msg_lower:
        response += "Perfect soundtrack for the road ahead."
    else:
        response += "Curated with care — hit play and enjoy."

    return {
        "response": response,
        "songs": songs,
        "playlistTitle": playlist_title,
    }


# ─── Neural Feedback & Personalization Endpoints ──────────────────────────────
class FeedbackPayload(BaseModel):
    user_id: Optional[str] = None
    userId: Optional[str] = None
    track_id: Optional[str] = None
    trackId: Optional[str] = None
    title: Optional[str] = ""
    artist: Optional[str] = ""
    action: Optional[str] = "completed"
    duration_listened: Optional[float] = None
    durationListened: Optional[float] = None
    total_duration: Optional[float] = None
    totalDuration: Optional[float] = None

    def get_user_id(self) -> str:
        return (self.user_id or self.userId or "default_user").strip()

    def get_track_id(self) -> str:
        return (self.track_id or self.trackId or "unknown_track").strip()

    def get_duration_listened(self) -> float:
        val = self.duration_listened if self.duration_listened is not None else self.durationListened
        return float(val or 0.0)

    def get_total_duration(self) -> float:
        val = self.total_duration if self.total_duration is not None else self.totalDuration
        return float(val or 180.0)


@app.post("/api/recommend/feedback")
def submit_feedback(payload: FeedbackPayload):
    """
    Real-Time Online Telemetry:
    Receives user interaction events and updates the neural taste profile immediately.
    Accepts both camelCase (userId, trackId, etc.) and snake_case (user_id, track_id, etc.).
    """
    user_id = payload.get_user_id()
    track_id = payload.get_track_id()
    res = pirate_brain.record_interaction(
        user_id=user_id,
        track_id=track_id,
        title=payload.title or "Track",
        artist=payload.artist or "Artist",
        action=payload.action or "completed",
        duration_listened=payload.get_duration_listened(),
        total_duration=payload.get_total_duration(),
    )
    pirate_brain.save_profiles()
    return res


@app.get("/api/recommend/profile/{user_id}")
def get_user_profile(user_id: str):
    """Inspect learned neural profile, top genres, artists, and interaction counts."""
    profile = pirate_brain.get_or_create_profile(user_id)
    return {
        "userId": user_id,
        "totalInteractions": profile.total_interactions,
        "likesCount": profile.likes_count,
        "skipsCount": profile.skips_count,
        "topGenres": [{"genre": g, "affinity": round(a, 4)} for g, a in profile.get_top_genres(5)],
        "topArtists": [{"artist": a, "affinity": round(s, 4)} for a, s in profile.get_top_artists(5)],
        "recentTracks": profile.history[-10:],
    }


# ─── Tonight's Frequency (Neural Personalized Vibe Feed) ──────────────────────
@app.get("/api/frequency")
def get_frequency(user_id: Optional[str] = Query(None)):
    """Tonight's Frequency — personalized neural playlist based on user taste & time of day."""
    hour = datetime.now().hour

    profile = pirate_brain.get_or_create_profile(user_id or "default_user")
    top_genres = profile.get_top_genres(2)
    top_genre = top_genres[0][0] if top_genres and top_genres[0][1] > 0.1 else None

    if 5 <= hour < 12:
        mood = "Morning"
        description = "Calm, Energetic, Fresh"
        query = f"morning {top_genre} feel good acoustic" if top_genre else "morning feel good acoustic"
    elif 12 <= hour < 17:
        mood = "Afternoon"
        description = "Upbeat, Focused, Vibrant"
        query = f"afternoon {top_genre} upbeat hits" if top_genre else "afternoon upbeat pop hits"
    elif 17 <= hour < 21:
        mood = "Evening"
        description = "Smooth, Atmospheric, Warm"
        query = f"evening {top_genre} smooth vibe" if top_genre else "evening smooth r&b jazz"
    else:
        mood = "Late Night"
        description = "Calm, Atmospheric, Late-night"
        query = f"late night {top_genre} chill lo-fi vibes" if top_genre else "late night chill lo-fi vibes"

    songs = search_songs(query, 20)
    if user_id and songs:
        songs = pirate_brain.rank_tracks_bart(user_id, songs, limit=15)
    else:
        songs = songs[:15]

    cover = songs[0]["cover"] if songs else ""

    return {
        "mood": mood,
        "description": description,
        "cover": cover,
        "songs": songs,
        "personalized": bool(top_genre),
    }


# ─── Spotify-Style Song Radio (Neural BaRT Powered) ───────────────────────────
@app.get("/api/radio/{video_id}")
def get_song_radio(
    video_id: str,
    limit: int = Query(default=30, le=50),
    user_id: Optional[str] = Query(None),
):
    """
    Spotify-Style Song Radio:
    Given any song, generates an endless seamless station of matching vibe tracks,
    refined and sequenced by PirateBrain BaRT bandit.
    """
    vid = _validate_video_id(video_id)
    try:
        watch = yt.get_watch_playlist(vid, radio=True, limit=limit + 15)
        tracks = watch.get("tracks", [])
        songs = []
        seen = set([vid])
        for t in tracks:
            t_vid = t.get("videoId")
            if not t_vid or t_vid in seen:
                continue
            formatted = format_track(t)
            if is_full_song(formatted):
                seen.add(t_vid)
                songs.append(formatted)

        if user_id and songs:
            songs = pirate_brain.rank_tracks_bart(user_id, songs, limit=limit)
        else:
            songs = songs[:limit]

        return {"seedId": vid, "songs": songs}
    except Exception as e:
        logger.error(f"Song radio error for {vid}: {e}")
        raise HTTPException(status_code=502, detail="Could not generate song radio")


# ─── Infinite Autoplay Queue (Session Deduplicated & Neural Ranked) ───────────
@app.get("/api/infinite-queue")
def infinite_queue(
    video_id: str,
    count: int = Query(default=15, le=30),
    exclude_ids: str = Query(default=""),
    user_id: Optional[str] = Query(None),
):
    """
    Infinite Autoplay:
    Returns the next batch of songs matching the current playing track when the queue runs out.
    Uses exclude_ids to prevent song repeats within the same listening session,
    and applies PirateBrain BaRT bandit to personalize playback flow.
    """
    vid = _validate_video_id(video_id)
    exclude_set = set(e.strip() for e in exclude_ids.split(",") if e.strip())
    exclude_set.add(vid)

    try:
        watch = yt.get_watch_playlist(vid, radio=True, limit=count + 15)
        tracks = watch.get("tracks", [])
        songs = []
        seen = set(exclude_set)

        for t in tracks:
            t_vid = t.get("videoId")
            if not t_vid or t_vid in seen:
                continue
            formatted = format_track(t)
            if is_full_song(formatted):
                seen.add(t_vid)
                songs.append(formatted)

        if user_id and songs:
            songs = pirate_brain.rank_tracks_bart(user_id, songs, limit=count)
        else:
            songs = songs[:count]

        return {"songs": songs}
    except Exception as e:
        logger.error(f"Infinite queue error for {vid}: {e}")
        return {"songs": []}


# ─── Multi-Daily Mixes (Spotify Daily Mix 1 - 6 with Neural Adaptation) ───────
DAILY_MIX_GENRES = [
    {
        "id": "daily-mix-1",
        "title": "Daily Mix 1",
        "genre": "Afrobeats & Amapiano",
        "description": "Burna Boy, Asake, Tyla, and modern African rhythms.",
        "seeds": ["Burna Boy", "Asake", "Rema", "Wizkid", "Tyla", "Ayra Starr", "Omah Lay"],
        "color": "#00F0FF",
    },
    {
        "id": "daily-mix-2",
        "title": "Daily Mix 2",
        "genre": "Hip Hop & Trap",
        "description": "Drake, Kendrick Lamar, Travis Scott, and heavy 808s.",
        "seeds": ["Drake", "Travis Scott", "Kendrick Lamar", "Future", "Gunna", "21 Savage"],
        "color": "#FF007A",
    },
    {
        "id": "daily-mix-3",
        "title": "Daily Mix 3",
        "genre": "R&B & Soul",
        "description": "SZA, The Weeknd, Brent Faiyaz, and late-night smooth vocals.",
        "seeds": ["SZA", "The Weeknd", "Brent Faiyaz", "Frank Ocean", "Giveon"],
        "color": "#9D00FF",
    },
    {
        "id": "daily-mix-4",
        "title": "Daily Mix 4",
        "genre": "Global Pop & Dance",
        "description": "Dua Lipa, Billie Eilish, Bruno Mars, and chart-topping hits.",
        "seeds": ["Dua Lipa", "Billie Eilish", "Bruno Mars", "Post Malone", "Sabrina Carpenter"],
        "color": "#00FF66",
    },
    {
        "id": "daily-mix-5",
        "title": "Daily Mix 5",
        "genre": "Chill & Lo-Fi",
        "description": "Daniel Caesar, Steve Lacy, and mellow acoustic chords.",
        "seeds": ["Daniel Caesar", "Steve Lacy", "Mac DeMarco", "Rex Orange County"],
        "color": "#FFE600",
    },
    {
        "id": "daily-mix-6",
        "title": "Daily Mix 6",
        "genre": "Electronic & House",
        "description": "Calvin Harris, Fred again.., and infectious club beats.",
        "seeds": ["Calvin Harris", "Fred again..", "Peggy Gou", "Disclosure", "Black Coffee"],
        "color": "#FF5500",
    },
]

@app.get("/api/daily-mixes")
def get_daily_mixes(
    top_artists: str = Query(default=""),
    limit_per_mix: int = Query(default=10, le=25),
    user_id: Optional[str] = Query(None),
):
    """
    Generate 6 distinct personalized Daily Mixes like Spotify:
    - Clusters tracks by sonic identity (Afro, Hip Hop, R&B, Pop, Chill, Electronic).
    - Injects user's learned favorite artists from PirateBrain profile.
    - 70% familiar tracks + 30% discovery tracks.
    """
    profile = pirate_brain.get_or_create_profile(user_id or "default_user")
    learned_artists = [a[0] for a in profile.get_top_artists(5)]

    user_artists = [a.strip().lower() for a in top_artists.split(",") if a.strip()]
    for la in learned_artists:
        if la.lower() not in user_artists:
            user_artists.append(la.lower())

    mixes = []

    for cluster in DAILY_MIX_GENRES:
        matched_user_artists = [a for a in cluster["seeds"] if a.lower() in user_artists]
        chosen_seeds = matched_user_artists[:2] if matched_user_artists else random.sample(cluster["seeds"], min(2, len(cluster["seeds"])))
        primary_seed = chosen_seeds[0]

        cluster_songs = search_songs(f"{primary_seed} hits essentials", limit=limit_per_mix + 5)
        if cluster_songs:
            if user_id:
                cluster_songs = pirate_brain.rank_tracks_bart(user_id, cluster_songs, limit=limit_per_mix)
            else:
                cluster_songs = cluster_songs[:limit_per_mix]

            mixes.append({
                "id": cluster["id"],
                "title": cluster["title"],
                "genre": cluster["genre"],
                "description": cluster["description"],
                "color": cluster["color"],
                "cover": cluster_songs[0]["cover"] if cluster_songs else "",
                "primaryArtist": primary_seed,
                "tracks": cluster_songs,
            })

    return {"mixes": mixes}


# ─── Spotify-Grade Personalized Discovery Feed ────────────────────────────────
@app.get("/api/discover")
def get_discover_feed(
    recent_ids: str = Query(default=""),
    top_artists: str = Query(default=""),
    time_of_day: str = Query(default=""),
    user_id: Optional[str] = Query(None),
):
    """
    Ever-Changing Personalized Discovery Engine (Spotify-like):
    Dynamically evolves based on user history, time of day, and seed artists.
    """
    recent_list = [v.strip() for v in recent_ids.split(",") if v.strip() and VIDEO_ID_PATTERN.match(v.strip())]
    artists_list = [a.strip() for a in top_artists.split(",") if a.strip()]

    profile = pirate_brain.get_or_create_profile(user_id or "default_user")
    learned_artists = [a[0] for a in profile.get_top_artists(4)]
    for la in learned_artists:
        if la not in artists_list:
            artists_list.append(la)

    hour = datetime.now().hour
    day_name = datetime.now().strftime("%A")

    if 5 <= hour < 12:
        vibe_title = f"{day_name} Morning Rise"
        vibe_query = "morning acoustic positive energy"
    elif 12 <= hour < 17:
        vibe_title = f"{day_name} Afternoon Flow"
        vibe_query = "afternoon upbeat focus motivation"
    elif 17 <= hour < 22:
        if day_name in ["Friday", "Saturday"]:
            vibe_title = "Weekend Night Hype"
            vibe_query = "party dance afrobeat bangers"
        else:
            vibe_title = "Evening Wind Down"
            vibe_query = "chill r&b evening soul"
    else:
        vibe_title = "Midnight Frequency"
        vibe_query = "late night lo-fi chill aesthetic"

    time_mix_songs = search_songs(vibe_query, 16)
    if user_id and time_mix_songs:
        time_mix_songs = pirate_brain.rank_tracks_bart(user_id, time_mix_songs, limit=12)
    else:
        time_mix_songs = time_mix_songs[:12]

    for_you_songs = []
    if recent_list:
        try:
            watch = yt.get_watch_playlist(recent_list[0], radio=True, limit=18)
            for t in watch.get("tracks", []):
                t_vid = t.get("videoId")
                if t_vid and t_vid not in recent_list:
                    formatted = format_track(t)
                    if is_full_song(formatted):
                        for_you_songs.append(formatted)
        except Exception as e:
            logger.warning(f"Failed to generate radio for {recent_list[0]}: {e}")

    if not for_you_songs:
        if artists_list:
            for_you_songs = search_songs(f"songs similar to {artists_list[0]}", 16)
        else:
            for_you_songs = search_songs("top viral hits today", 16)

    if user_id and for_you_songs:
        for_you_songs = pirate_brain.rank_tracks_bart(user_id, for_you_songs, limit=10)
    else:
        for_you_songs = for_you_songs[:10]

    artist_mixes = []
    sample_artists = artists_list[:2] if artists_list else ["Burna Boy", "The Weeknd"]
    for art in sample_artists:
        songs = search_songs(f"{art} essential hits", 12)
        if songs:
            if user_id:
                songs = pirate_brain.rank_tracks_bart(user_id, songs, limit=8)
            else:
                songs = songs[:8]
            artist_mixes.append({
                "artist": art,
                "title": f"Daily Mix: {art}",
                "cover": songs[0]["cover"] if songs else "",
                "songs": songs,
            })

    radar_query = f"new releases {artists_list[0]}" if artists_list else "new music trending chart"
    discovery_radar = search_songs(radar_query, 14)
    if user_id and discovery_radar:
        discovery_radar = pirate_brain.rank_tracks_bart(user_id, discovery_radar, limit=10, exploration_ratio=0.50)
    else:
        discovery_radar = discovery_radar[:10]

    return {
        "timestamp": datetime.now().isoformat(),
        "headlineMix": {
            "title": vibe_title,
            "cover": time_mix_songs[0]["cover"] if time_mix_songs else "",
            "songs": time_mix_songs,
        },
        "forYou": {
            "title": "Made For You",
            "songs": for_you_songs,
        },
        "discoveryRadar": {
            "title": "Discover Radar",
            "songs": discovery_radar,
        },
        "artistMixes": artist_mixes,
    }


# ─── Health Check ──────────────────────────────────────────────────────────────
@app.get("/api/health")
def health_check():
    """Simple health check endpoint."""
    return {
        "status": "ok",
        "timestamp": datetime.now().isoformat(),
        "neuralEngine": "PirateBrain v2.0",
        "activeProfiles": len(pirate_brain.profiles),
    }
