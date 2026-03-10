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

  if (route === '#/app') {
    return <DashboardPage />;
  }

  return <Landing />;
}

createRoot(document.getElementById('root')!).render(<Router />);
