import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Landing } from './Landing.js';
import { DashboardPage } from './Dashboard.js';

function Router() {
  const [route, setRoute] = useState(location.hash);

  useEffect(() => {
    const onHashChange = () => setRoute(location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  if (route.startsWith('#/app')) {
    // Parse ?tab=insights from the hash e.g. #/app?tab=insights
    const search = route.includes('?') ? route.slice(route.indexOf('?')) : '';
    const params = new URLSearchParams(search);
    const initialTab = params.get('tab') ?? undefined;
    return <DashboardPage initialTab={initialTab} />;
  }

  return <Landing />;
}

createRoot(document.getElementById('root')!).render(<Router />);
