import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { subscribeLoading } from '@/lib/client';

export default function TopLoadingBar() {
  const location = useLocation();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef(null);
  const completeTimerRef = useRef(null);

  const startProgress = () => {
    if (completeTimerRef.current) clearTimeout(completeTimerRef.current);
    if (timerRef.current) clearInterval(timerRef.current);

    setVisible(true);
    setProgress(15);

    timerRef.current = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 85) {
          clearInterval(timerRef.current);
          return 85;
        }
        const diff = (90 - prev) * 0.15;
        return prev + Math.max(1, diff);
      });
    }, 120);
  };

  const finishProgress = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setProgress(100);

    completeTimerRef.current = setTimeout(() => {
      setVisible(false);
      setTimeout(() => setProgress(0), 300);
    }, 250);
  };

  // Trigger loading progress on page/route navigation
  useEffect(() => {
    startProgress();
    const timeout = setTimeout(() => {
      finishProgress();
    }, 300);

    return () => {
      clearTimeout(timeout);
      if (timerRef.current) clearInterval(timerRef.current);
      if (completeTimerRef.current) clearTimeout(completeTimerRef.current);
    };
  }, [location.pathname, location.search]);

  // Trigger loading progress on API request activity
  useEffect(() => {
    const unsubscribe = subscribeLoading((isLoading) => {
      if (isLoading) {
        startProgress();
      } else {
        finishProgress();
      }
    });

    return () => unsubscribe();
  }, []);

  if (!visible && progress === 0) return null;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[99999] pointer-events-none transition-opacity duration-300"
      style={{ opacity: visible ? 1 : 0 }}
      aria-hidden="true"
    >
      <div
        className="h-[2px] bg-ink transition-[width] duration-300 ease-out"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}
