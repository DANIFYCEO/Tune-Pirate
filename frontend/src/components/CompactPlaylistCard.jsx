import React from 'react';

const FALLBACK = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Crect width='300' height='300' fill='%23222'/%3E%3Ccircle cx='150' cy='150' r='60' fill='%23444'/%3E%3Ccircle cx='150' cy='150' r='20' fill='%23222'/%3E%3C/svg%3E";

const HEART_FALLBACK = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Crect width='300' height='300' fill='%23121212'/%3E%3Cpath d='M150 220 L70 150 Q50 110 90 90 Q120 75 150 110 Q180 75 210 90 Q250 110 230 150 Z' fill='%231db954'/%3E%3C/svg%3E";

export default function CompactPlaylistCard({ playlist, title, cover, onClick }) {
  // Support both: passing a full playlist object OR individual title/cover props
  const displayTitle = playlist?.title ?? title;
  const displayCover = playlist?.cover || cover;
  const isLikedSongs = displayTitle === 'Liked Songs';

  return (
    <div className="compact-playlist-card" onClick={onClick}>
      <img 
        src={displayCover || (isLikedSongs ? HEART_FALLBACK : FALLBACK)} 
        alt={displayTitle} 
        referrerPolicy="no-referrer" 
      />
      <div className="compact-title">{displayTitle}</div>
      {playlist?.songs?.length > 0 && (
        <div className="compact-subtitle" style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
          {playlist.songs.length} song{playlist.songs.length !== 1 ? 's' : ''}
        </div>
      )}
      <div className="compact-play-btn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="black"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      </div>
    </div>
  );
}
