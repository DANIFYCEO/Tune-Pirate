import { useState } from 'react';
import { use3DTilt } from '../hooks/use3DTilt';
import { useLibrary } from '../hooks/useLibrary';

const FALLBACK = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Crect width='300' height='300' fill='%23222'/%3E%3Ccircle cx='150' cy='150' r='60' fill='%23444'/%3E%3Ccircle cx='150' cy='150' r='20' fill='%23222'/%3E%3C/svg%3E";

const PlayIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>;
const PauseIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>;
const HeartIcon = ({ filled }) => <svg width="20" height="20" viewBox="0 0 24 24" fill={filled ? "#ff453a" : "none"} stroke={filled ? "#ff453a" : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>;

export default function TrackCard({ song, isActive, onClick, size = 'md' }) {
  const [imgSrc, setImgSrc] = useState(song.cover || FALLBACK);
  const { ref, style, handlers } = use3DTilt(14);
  const { isLiked, toggleLike } = useLibrary();
  const liked = isLiked(song.id);

  const dim = size === 'sm' ? 130 : size === 'lg' ? 220 : 175;

  return (
    <div
      ref={ref}
      className={`track-card ${isActive ? 'active' : ''}`}
      style={{ ...style, transformStyle: 'preserve-3d', minWidth: dim, maxWidth: dim, cursor: 'pointer' }}
      {...handlers}
    >
      <div className="track-cover-container" style={{ width: dim, height: dim, transformStyle: 'preserve-3d' }} onClick={onClick}>
        <img
          src={imgSrc}
          alt={song.title}
          className="track-cover"
          referrerPolicy="no-referrer"
          onError={() => setImgSrc(FALLBACK)}
          style={{ transform: 'translateZ(20px)' }}
        />
        <div className="card-glare" style={{
          '--glare-x': style['--glare-x'] || '50%',
          '--glare-y': style['--glare-y'] || '50%',
          opacity: style['--glare-opacity'] || 0,
        }} />
        <div className="play-overlay" style={{ transform: 'translateZ(30px)' }}>
          {isActive ? <PauseIcon /> : <PlayIcon />}
        </div>
        
        <div className="like-overlay" 
             style={{ transform: 'translateZ(30px)' }}
             onClick={(e) => { e.stopPropagation(); toggleLike(song); }}>
           <HeartIcon filled={liked} />
        </div>
      </div>
      <div className="track-info" style={{ transform: 'translateZ(10px)' }}>
        <div className="track-name" onClick={onClick}>{song.title}</div>
        <div className="track-artist">{song.artist}</div>
      </div>
    </div>
  );
}
