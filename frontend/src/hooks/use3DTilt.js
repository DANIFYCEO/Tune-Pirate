import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * Returns touch event handlers that apply a 3D tilt effect to a card
 * based on where the user's finger is on the surface, and device gyroscope parallax.
 */
export function use3DTilt(strength = 18) {
  const ref = useRef(null);
  const [style, setStyle] = useState({});
  const animFrame = useRef(null);

  useEffect(() => {
    const handleOrientation = (e) => {
      if (e.gamma === null || e.beta === null) return;
      
      const rotateY = (e.gamma / 90) * strength;
      const adjustedBeta = e.beta - 45;
      const rotateX = -(adjustedBeta / 90) * strength;

      if (animFrame.current) cancelAnimationFrame(animFrame.current);
      animFrame.current = requestAnimationFrame(() => {
        setStyle(prev => ({
          ...prev,
          transform: `perspective(600px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1, 1, 1)`,
          transition: 'transform 0.1s ease-out',
        }));
      });
    };

    if (window.DeviceOrientationEvent) {
      window.addEventListener('deviceorientation', handleOrientation);
    }
    
    return () => {
      if (window.DeviceOrientationEvent) {
        window.removeEventListener('deviceorientation', handleOrientation);
      }
      if (animFrame.current) cancelAnimationFrame(animFrame.current);
    };
  }, [strength]);

  const handleTouchMove = useCallback((e) => {
    const el = ref.current;
    if (!el) return;
    const touch = e.touches[0];
    const rect = el.getBoundingClientRect();

    // Finger position relative to card center, normalized to -1 → 1
    const x = ((touch.clientX - rect.left) / rect.width - 0.5) * 2;
    const y = ((touch.clientY - rect.top) / rect.height - 0.5) * 2;

    const rotateY = x * strength;
    const rotateX = -y * strength;

    // Specular highlight position
    const glareX = ((touch.clientX - rect.left) / rect.width) * 100;
    const glareY = ((touch.clientY - rect.top) / rect.height) * 100;

    if (animFrame.current) cancelAnimationFrame(animFrame.current);
    animFrame.current = requestAnimationFrame(() => {
      setStyle({
        transform: `perspective(600px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.05, 1.05, 1.05)`,
        transition: 'transform 0.05s ease-out',
        '--glare-x': `${glareX}%`,
        '--glare-y': `${glareY}%`,
        '--glare-opacity': '0.25',
      });
    });
  }, [strength]);

  const handleTouchEnd = useCallback(() => {
    if (animFrame.current) cancelAnimationFrame(animFrame.current);
    setStyle({
      transform: 'perspective(600px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)',
      transition: 'transform 0.6s cubic-bezier(0.23, 1, 0.32, 1)',
      '--glare-opacity': '0',
    });
  }, []);

  const handleTouchStart = useCallback(() => {
    setStyle(prev => ({
      ...prev,
      transition: 'transform 0.05s ease-out',
    }));
  }, []);

  return { ref, style, handlers: { onTouchMove: handleTouchMove, onTouchEnd: handleTouchEnd, onTouchStart: handleTouchStart } };
}
