import React from 'react';
import { Dashboard as DashboardInner } from './App.js';

export function DashboardPage({ initialTab }: { initialTab?: string }) {
  return (
    <div style={{
      background: '#f8fafc',
      color: '#1e293b',
      minHeight: '100vh',
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    }}>
      <DashboardInner initialTab={initialTab} />
    </div>
  );
}
