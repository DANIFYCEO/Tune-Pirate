import React from 'react';
import { useLibrary } from '../hooks/useLibrary';

const FALLBACK = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Crect width='300' height='300' fill='%23222'/%3E%3Ccircle cx='150' cy='150' r='60' fill='%23444'/%3E%3Ccircle cx='150' cy='150' r='20' fill='%23222'/%3E%3C/svg%3E";
const HeartIcon = ({ filled }) => <svg width="20" height="20" viewBox="0 0 24 24" fill={filled ? "#1db954" : "none"} stroke={filled ? "#1db954" : "currentColor"} strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>;

const Icons = {
  PlayActive: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--accent-color)"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>,
  PlaySmall:  () => <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg>,
  Remove:     () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>,
};

export default function TrackListItem({ song, index, isActive, onClick, onRemove }) {
  const { isLiked, toggleLike } = useLibrary();
  const liked = isLiked(song.id);

  return (
    <div className={`track-list-item ${isActive ? 'active' : ''}`} onClick={onClick}>
      <div className="track-list-index">
        {isActive ? (
          <Icons.PlayActive />
        ) : (
          <span className="index-number">{index + 1}</span>
        )}
        <div className="index-play"><Icons.PlaySmall /></div>
      </div>
      
      <img src={song.cover || FALLBACK} alt="cover" referrerPolicy="no-referrer" className="track-list-cover" />
      
      <div className="track-list-info">
        <div className="track-list-title" style={{ color: isActive ? 'var(--accent-color)' : 'var(--text-primary)' }}>{song.title}</div>
        <div className="track-list-artist">{song.artist}</div>
      </div>

      <div className="track-list-actions">
        <div onClick={(e) => { e.stopPropagation(); toggleLike(song); }}>
          <HeartIcon filled={liked} />
        </div>
        {onRemove && (
          <div
            className="track-remove-btn"
            onClick={(e) => { e.stopPropagation(); onRemove(song); }}
            title="Remove from playlist"
          >
            <Icons.Remove />
          </div>
        )}
      </div>
    </div>
  );
}
