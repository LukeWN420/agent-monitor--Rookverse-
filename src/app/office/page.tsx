"use client";

import { useEffect } from 'react';

export default function OfficePage() {
  useEffect(() => {
    window.location.href = '/';
  }, []);

  return (
    <div className="h-screen flex items-center justify-center" style={{ backgroundColor: '#0B1020' }}>
      <p className="font-mono text-sm" style={{ color: '#D4A843' }}>Redirecting to dashboard...</p>
    </div>
  );
}