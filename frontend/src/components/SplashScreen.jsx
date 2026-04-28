import React, { useEffect, useState } from 'react';
import './SplashScreen.css';

export default function SplashScreen({ onComplete }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // Fake progress loading over 5 seconds
    const interval = setInterval(() => {
      setProgress(p => {
        if (p >= 100) {
          clearInterval(interval);
          return 100;
        }
        // Random progress jumps
        return p + Math.random() * 8;
      });
    }, 300);

    const timeout = setTimeout(() => {
      clearInterval(interval);
      setProgress(100);
      // Small delay after 100% before firing complete
      setTimeout(onComplete, 400);
    }, 5000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [onComplete]);

  return (
    <div className="splash-screen">
      <div className="splash-content">
        <div className="splash-logo-container">
          {/* SVG Pirate Ship / Music Note Logo */}
          <svg className="splash-logo" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M50 10C27.9 10 10 27.9 10 50C10 72.1 27.9 90 50 90C72.1 90 90 72.1 90 50C90 27.9 72.1 10 50 10ZM50 82C32.3 82 18 67.7 18 50C18 32.3 32.3 18 50 18C67.7 18 82 32.3 82 50C82 67.7 67.7 82 50 82Z" fill="white"/>
            <path d="M60 40H40V65C40 68.3 37.3 71 34 71C30.7 71 28 68.3 28 65C28 61.7 30.7 59 34 59C35.1 59 36.1 59.3 37 59.8V35H60V40Z" fill="white"/>
            <path d="M60 40V65C60 68.3 57.3 71 54 71C50.7 71 48 68.3 48 65C48 61.7 50.7 59 54 59C55.1 59 56.1 59.3 57 59.8V40H60Z" fill="white"/>
          </svg>
        </div>
        <h1 className="splash-title">Tune Pirate</h1>
        <p className="splash-subtitle">Premium Music Experience</p>
        
        <div className="splash-progress-bar">
          <div 
            className="splash-progress-fill" 
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
}
