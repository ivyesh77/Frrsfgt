import { useEffect } from 'react';
import { BackgroundFX } from './components/common/BackgroundFX';
import { ArenaApp } from './arena/components/ArenaApp';
import { ALL_ASSET_URLS } from './data/imageRegistry';
import { preloadImages } from './utils/preload';

export default function App() {
  useEffect(() => {
    void preloadImages(ALL_ASSET_URLS); // warms the Memory Match icon set used by one of the Arena's game kinds
  }, []);

  return (
    <div className="app-shell">
      <BackgroundFX />
      <ArenaApp />
    </div>
  );
}
