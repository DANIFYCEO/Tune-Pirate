from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from starlette.background import BackgroundTask
from ytmusicapi import YTMusic
import yt_dlp
import imageio_ffmpeg
import asyncio
import random
import tempfile
import os
import httpx

# Resolve bundled ffmpeg binary path once at startup
FFMPEG_PATH = imageio_ffmpeg.get_ffmpeg_exe()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

yt = YTMusic()

def format_track(track):
    thumbnails = track.get("thumbnails", [])
    cover_url = thumbnails[-1]["url"] if thumbnails else ""
    if cover_url and "googleusercontent.com" in cover_url and "=" in cover_url:
        cover_url = cover_url.split("=")[0] + "=w600-h600-l90-rj"
    artists = track.get("artists", [])
    artist_name = artists[0]["name"] if artists else "Unknown Artist"
    album = track.get("album", {})
    album_name = album.get("name", "") if album else ""
    duration = track.get("duration", "")
    return {
        "id": track.get("videoId"),
        "title": track.get("title"),
        "artist": artist_name,
        "album": album_name,
        "cover": cover_url,
        "duration": duration,
        "youtubeId": track.get("videoId"),
    }

def search_songs(query: str, limit: int = 8):
    try:
        results = yt.search(query, filter="songs", limit=limit + 4)
        random.shuffle(results)
        seen = set()
        unique = []
        for t in results:
            vid = t.get("videoId")
            if vid and vid not in seen:
                seen.add(vid)
                unique.append(format_track(t))
            if len(unique) >= limit:
                break
        return unique
    except Exception as e:
        print(f"Search error: {e}")
        return []

# ─── Search endpoint ───────────────────────────────────────────────────────────
@app.get("/api/search")
async def search(q: str = "", limit: int = 20):
    if not q.strip():
        return {"songs": [], "query": ""}
    try:
        results = yt.search(q.strip(), filter="songs", limit=limit + 6)
        seen = set()
        songs = []
        for t in results:
            vid = t.get("videoId")
            if vid and vid not in seen:
                seen.add(vid)
                songs.append(format_track(t))
            if len(songs) >= limit:
                break
        return {"songs": songs, "query": q}
    except Exception as e:
        print(f"Search error: {e}")
        return {"songs": [], "query": q}

# ─── Stream URL endpoint ───────────────────────────────────────────────────────
@app.get("/api/stream/{video_id}")
async def get_stream_url(video_id: str):
    """Returns a YouTube embed URL for playback."""
    if not video_id:
        raise HTTPException(status_code=400, detail="Missing video_id")
    # Return YouTube embed URL — plays in an iframe/audio context
    embed_url = f"https://www.youtube.com/embed/{video_id}?autoplay=1&controls=0"
    watch_url = f"https://music.youtube.com/watch?v={video_id}"
    return {"videoId": video_id, "embedUrl": embed_url, "watchUrl": watch_url}

# ─── Download endpoint ─────────────────────────────────────────────────────────
def remove_file(path: str):
    try:
        os.remove(path)
    except Exception as e:
        print(f"Error removing temp file {path}: {e}")

@app.get("/api/download/{video_id}")
async def download_song(video_id: str):
    """Extracts a direct audio URL and streams it to the client via ffmpeg pipe."""
    if not video_id:
        raise HTTPException(status_code=400, detail="Missing video_id")

    url = f"https://www.youtube.com/watch?v={video_id}"

    # Step 1: extract the direct audio stream URL (no download)
    ydl_opts = {
        'format': 'bestaudio[ext=m4a]/bestaudio/best',
        'quiet': True,
        'no_warnings': True,
        'skip_download': True,
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            audio_url = info.get('url')
            title = info.get('title', 'audio')
            if not audio_url:
                raise HTTPException(status_code=404, detail="No audio URL found")
    except Exception as e:
        print(f"yt-dlp extract error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    # Step 2: stream through ffmpeg → mp3 pipe → client
    safe_title = "".join([c for c in title if c.isalpha() or c.isdigit() or c == ' ']).strip()
    filename = f"{safe_title or video_id}.mp3"

    ffmpeg_cmd = [
        FFMPEG_PATH,
        "-reconnect", "1",
        "-reconnect_streamed", "1",
        "-reconnect_delay_max", "5",
        "-i", audio_url,
        "-vn",
        "-ar", "44100",
        "-ac", "2",
        "-b:a", "128k",
        "-f", "mp3",
        "pipe:1",
    ]

    async def stream_audio():
        proc = await asyncio.create_subprocess_exec(
            *ffmpeg_cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        try:
            while True:
                chunk = await proc.stdout.read(65536)  # 64KB chunks
                if not chunk:
                    break
                yield chunk
        finally:
            try:
                proc.kill()
            except Exception:
                pass

    return StreamingResponse(
        stream_audio(),
        media_type="audio/mpeg",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

# ─── Lyrics endpoint ───────────────────────────────────────────────────────────
@app.get("/api/lyrics/{video_id}")
async def get_lyrics(video_id: str):
    """Fetch lyrics for a track by its YouTube Music videoId."""
    try:
        # Try to get the watch playlist to find the browse ID for lyrics
        next_data = yt.get_watch_playlist(video_id)
        lyrics_browse_id = next_data.get("lyrics")
        if not lyrics_browse_id:
            return {"lyrics": None, "hasTimestamps": False}
        lyrics_data = yt.get_lyrics(lyrics_browse_id)
        if not lyrics_data:
            return {"lyrics": None, "hasTimestamps": False}
        return {
            "lyrics": lyrics_data.get("lyrics", ""),
            "source": lyrics_data.get("source", ""),
            "hasTimestamps": False
        }
    except Exception as e:
        print(f"Lyrics error: {e}")
        return {"lyrics": None, "hasTimestamps": False}

# ─── Time-of-day recommendations ──────────────────────────────────────────────
@app.get("/api/recommendations")
async def get_recommendations(time_of_day: str = "afternoon"):
    queries = {
        "morning": ["Morning acoustic songs", "Wake up happy hits", "Morning coffee pop"],
        "afternoon": ["Top 50 global hits", "Current pop hits", "Trending music 2025"],
        "night": ["Late night lofi", "Midnight chill R&B", "Sleep vibes songs"]
    }
    time_key = time_of_day.lower() if time_of_day.lower() in queries else "afternoon"
    query = random.choice(queries[time_key])
    songs = search_songs(query, 10)
    return {"time": time_key, "query": query, "songs": songs}

# ─── Mood/Genre playlists ──────────────────────────────────────────────────────
@app.get("/api/moods")
async def get_moods():
    mood_queries = [
        {"label": "Workout",      "emoji": "💪", "query": "gym workout motivation hits"},
        {"label": "Party",        "emoji": "🎉", "query": "party hits 2025"},
        {"label": "Focus",        "emoji": "🎧", "query": "study focus deep work music"},
        {"label": "Romance",      "emoji": "❤️",  "query": "romantic love songs"},
        {"label": "Throwbacks",   "emoji": "⏪", "query": "2000s throwback hits"},
        {"label": "Gaming",       "emoji": "🎮", "query": "gaming montage EDM trap"},
        {"label": "Acoustic",     "emoji": "🎸", "query": "acoustic covers chill"},
        {"label": "Late Night",   "emoji": "🌃", "query": "late night drive lo-fi"},
        {"label": "Upbeat",       "emoji": "✨", "query": "feel good happy pop hits"},
    ]
    result = []
    for mood in mood_queries:
        songs = search_songs(mood["query"], 6)
        if songs:
            result.append({
                "label": mood["label"],
                "emoji": mood["emoji"],
                "cover": songs[0]["cover"] if songs else "",
                "songs": songs
            })
    return {"moods": result}

# ─── Trending / Charts ─────────────────────────────────────────────────────────
@app.get("/api/trending")
async def get_trending():
    try:
        charts = yt.get_charts(country='US')
        trending_items = charts.get('trending', {}).get('items', [])
        if not trending_items:
            trending_items = charts.get('videos', {}).get('items', [])
        
        songs = []
        for item in trending_items[:15]:
            artist_name = "Unknown Artist"
            if item.get('artists') and len(item['artists']) > 0:
                artist_name = item['artists'][0].get('name', 'Unknown Artist')
                
            cover_url = ""
            if item.get('thumbnails') and len(item['thumbnails']) > 0:
                cover_url = item['thumbnails'][-1]['url']
                
            songs.append({
                "id": item.get('videoId'),
                "title": item.get('title'),
                "artist": artist_name,
                "cover": cover_url
            })
        return {"songs": songs}
    except Exception as e:
        print("Trending error:", e)
        return {"songs": []}

# ─── Check These Out (Curated Playlists) ───────────────────────────────────────
@app.get("/api/check-these-out")
async def get_check_these_out():
    try:
        results = yt.search("popular mix 2025 hits", filter="playlists", limit=6)
        playlists = []
        for r in results:
            cover = r['thumbnails'][-1]['url'] if r.get('thumbnails') else ""
            playlists.append({
                "browseId": r.get('browseId'),
                "title": r.get('title'),
                "author": r.get('author'),
                "cover": cover
            })
        return {"playlists": playlists}
    except Exception as e:
        print("Check these out error:", e)
        return {"playlists": []}

# ─── Spotify Playlists ─────────────────────────────────────────────────────────
@app.get("/api/spotify-playlists")
async def get_spotify_playlists():
    try:
        results = yt.search("spotify top 50 viral", filter="playlists", limit=8)
        playlists = []
        for r in results:
            cover = r['thumbnails'][-1]['url'] if r.get('thumbnails') else ""
            playlists.append({
                "browseId": r.get('browseId'),
                "title": r.get('title'),
                "author": r.get('author'),
                "cover": cover
            })
        return {"playlists": playlists}
    except Exception as e:
        print("Spotify error:", e)
        return {"playlists": []}

# ─── Playlist Details ──────────────────────────────────────────────────────────
@app.get("/api/playlist/{browse_id}")
async def get_playlist(browse_id: str, title: str = ""):
    try:
        clean_id = browse_id.replace("VLPL", "PL") if browse_id.startswith("VLPL") else browse_id
        playlist = yt.get_playlist(clean_id)
        songs = []
        for track in playlist.get('tracks', []):
            vid = track.get('videoId')
            if not vid:
                continue
            cover = track['thumbnails'][-1]['url'] if track.get('thumbnails') else ""
            if cover and "googleusercontent.com" in cover and "=" in cover:
                cover = cover.split("=")[0] + "=w600-h600-l90-rj"
            
            artist_name = "Unknown Artist"
            if track.get('artists') and len(track['artists']) > 0:
                artist_name = track['artists'][0].get('name', 'Unknown Artist')
                
            songs.append({
                "id": vid,
                "title": track.get('title'),
                "artist": artist_name,
                "cover": cover,
                "youtubeId": vid
            })
        if songs:
            return {"songs": songs}
    except Exception as e:
        print(f"Playlist details error for {browse_id}:", e)
    
    # Fallback: if playlist fails (e.g. private or community playlist bug), search by title!
    if title:
        try:
            fallback_songs = search_songs(title + " playlist", 20)
            if fallback_songs:
                return {"songs": fallback_songs}
        except Exception as e:
            print("Fallback search failed:", e)

    return {"songs": []}

# ─── Artist Info ───────────────────────────────────────────────────────────────
@app.get("/api/artist-info/{artist_name}")
async def get_artist_info(artist_name: str):
    try:
        # Search for artist channel ID
        search_results = yt.search(artist_name, filter="artists", limit=1)
        if not search_results:
            return {"error": "Artist not found"}
            
        artist_id = search_results[0]['browseId']
        artist_data = yt.get_artist(artist_id)
        
        # Get highest quality thumbnail
        thumbnail_url = ""
        if artist_data.get('thumbnails') and len(artist_data['thumbnails']) > 0:
            thumbnail_url = artist_data['thumbnails'][-1]['url']
            
        return {
            "name": artist_data.get('name'),
            "subscribers": artist_data.get('subscribers'),
            "monthlyListeners": artist_data.get('monthlyListeners'),
            "description": artist_data.get('description'),
            "image": thumbnail_url
        }
    except Exception as e:
        print("Artist info error:", e)
        return {"error": str(e)}

# ─── Because you listened to X ────────────────────────────────────────────────
@app.get("/api/because-you-listened")
async def because_you_listened(artist: str = ""):
    if not artist:
        return {"songs": []}
    songs = search_songs(f"songs similar to {artist}", 8)
    return {"artist": artist, "songs": songs}

# ─── New releases ──────────────────────────────────────────────────────────────
@app.get("/api/new-releases")
async def new_releases():
    songs = search_songs("new music releases 2024 2025", 10)
    return {"songs": songs}

# Search
@app.get("/api/search")
async def search(q: str = ""):
    if not q:
        return {"songs": []}
    songs = search_songs(q, 15)
    return {"query": q, "songs": songs}

@app.get("/api/search-playlists")
async def search_playlists(q: str = ""):
    if not q:
        return {"playlists": []}
    try:
        results = yt.search(q, filter="playlists", limit=12)
        playlists = []
        for r in results:
            cover = r['thumbnails'][-1]['url'] if r.get('thumbnails') else ""
            playlists.append({
                "browseId": r.get('browseId'),
                "title": r.get('title'),
                "author": r.get('author'),
                "cover": cover
            })
        return {"playlists": playlists}
    except Exception as e:
        print("Playlist search error:", e)
        return {"playlists": []}

# AI Playlist Generator
@app.get("/api/ai-playlist")
async def ai_playlist(prompt: str = ""):
    if not prompt:
        return {"songs": []}
    query = f"{prompt} playlist"
    songs = search_songs(query, 50)
    return {"prompt": prompt, "songs": songs}

# Artist Discography
@app.get("/api/artist")
async def get_artist(name: str = ""):
    if not name:
        return {"songs": []}
    songs = search_songs(f"{name} songs", 50)
    return {"artist": name, "songs": songs}

# ─── Image Proxy (avoids CORS issues when downloading cover art on Android) ───
@app.get("/api/proxy-image")
async def proxy_image(url: str = ""):
    if not url:
        raise HTTPException(status_code=400, detail="Missing url parameter")
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": "Mozilla/5.0"})
            if resp.status_code != 200:
                raise HTTPException(status_code=resp.status_code, detail="Failed to fetch image")
            content_type = resp.headers.get("content-type", "image/jpeg")
            return Response(content=resp.content, media_type=content_type)
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Image fetch error: {e}")
