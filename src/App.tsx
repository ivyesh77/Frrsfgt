import { useEffect, useRef, useState } from 'react';
import { BackgroundFX } from './components/common/BackgroundFX';
import { MainMenu } from './components/menu/MainMenu';
import { GameScreen } from './components/game/GameScreen';
import { CountdownOverlay } from './components/game/CountdownOverlay';
import { ResultScreen } from './components/result/ResultScreen';
import { SettingsModal } from './components/settings/SettingsModal';
import { useGameEngine } from './game/hooks/useGameEngine';
import { useSettings } from './game/hooks/useSettings';
import { useStats } from './game/hooks/useStats';
import { IMAGE_REGISTRY, ALL_ASSET_URLS } from './data/imageRegistry';
import { preloadImages } from './utils/preload';

export default function App() {
  const { settings, update: updateSettings } = useSettings();
  const { stats, recordGame, reset: resetStats } = useStats();
  const statsRef = useRef(stats);
  useEffect(() => {
    statsRef.current = stats;
  }, [stats]);

  const { state: engine, startGame, selectAnswer, returnToMenu, pause, resume } = useGameEngine(
    IMAGE_REGISTRY,
    settings,
    statsRef,
    recordGame,
  );

  const [showCountdown, setShowCountdown] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const wasPausedForSettings = useRef(false);

  useEffect(() => {
    void preloadImages(ALL_ASSET_URLS);
  }, []);

  function handlePlayRequested() {
    setShowCountdown(true);
  }

  function handleCountdownComplete() {
    setShowCountdown(false);
    startGame();
  }

  function handleOpenSettings() {
    if (engine.phase !== 'MENU' && engine.phase !== 'GAME_COMPLETE' && engine.phase !== 'PAUSED') {
      wasPausedForSettings.current = true;
      pause();
    }
    setSettingsOpen(true);
  }

  function handleCloseSettings() {
    setSettingsOpen(false);
    if (wasPausedForSettings.current) {
      wasPausedForSettings.current = false;
      resume();
    }
  }

  function handleToggleSound() {
    updateSettings({ sound: !settings.sound });
  }

  const isMenu = engine.phase === 'MENU';
  const isComplete = engine.phase === 'GAME_COMPLETE';

  return (
    <div className="app-shell">
      <BackgroundFX />

      {isMenu && (
        <MainMenu
          stats={stats}
          soundOn={settings.sound}
          onPlay={handlePlayRequested}
          onOpenSettings={() => setSettingsOpen(true)}
          onToggleSound={handleToggleSound}
        />
      )}

      {!isMenu && !isComplete && (
        <GameScreen
          engine={engine}
          soundOn={settings.sound}
          reducedMotion={settings.reducedMotion}
          onSelect={selectAnswer}
          onOpenSettings={handleOpenSettings}
          onToggleSound={handleToggleSound}
        />
      )}

      {isComplete && engine.gameResult && (
        <ResultScreen
          result={engine.gameResult}
          reducedMotion={settings.reducedMotion}
          onPlayAgain={handlePlayRequested}
          onMenu={returnToMenu}
        />
      )}

      {showCountdown && <CountdownOverlay onComplete={handleCountdownComplete} />}

      <SettingsModal
        open={settingsOpen}
        settings={settings}
        onChange={updateSettings}
        onClose={handleCloseSettings}
        onResetStats={resetStats}
      />
    </div>
  );
}
