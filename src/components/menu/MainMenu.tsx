import { motion } from 'framer-motion';
import type { StoredStats } from '../../types';
import { Button } from '../common/Button';
import './MainMenu.css';

interface MainMenuProps {
  stats: StoredStats;
  soundOn: boolean;
  onPlay: () => void;
  onOpenArena: () => void;
  onOpenSettings: () => void;
  onToggleSound: () => void;
}

export function MainMenu({ stats, soundOn, onPlay, onOpenArena, onOpenSettings, onToggleSound }: MainMenuProps) {
  return (
    <div className="main-menu no-select">
      <button
        type="button"
        className="main-menu__sound-toggle"
        onClick={onToggleSound}
        aria-label={soundOn ? 'Mute sound' : 'Unmute sound'}
        aria-pressed={!soundOn}
      >
        {soundOn ? '🔊' : '🔇'}
      </button>

      <motion.div
        className="main-menu__hero"
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.2, 0.9, 0.32, 1] }}
      >
        <div className="main-menu__logo" aria-hidden="true">
          <span className="main-menu__logo-tile main-menu__logo-tile--a" />
          <span className="main-menu__logo-tile main-menu__logo-tile--b" />
          <span className="main-menu__logo-tile main-menu__logo-tile--c" />
          <span className="main-menu__logo-tile main-menu__logo-tile--d" />
        </div>
        <h1 className="main-menu__title">MEMORY MATCH</h1>
        <p className="main-menu__subtitle">Study the image. Find its twin. Beat the clock.</p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.15, duration: 0.45, ease: [0.2, 0.9, 0.32, 1] }}
      >
        <Button variant="primary" size="lg" className="main-menu__play" onClick={onPlay} autoFocus>
          PLAY
        </Button>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.2, duration: 0.45, ease: [0.2, 0.9, 0.32, 1] }}
      >
        <Button variant="secondary" size="lg" className="main-menu__arena" onClick={onOpenArena}>
          🪙 Wager Arena (Multiplayer)
        </Button>
      </motion.div>

      <motion.div
        className="main-menu__stats glass-panel"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.28, duration: 0.4 }}
      >
        <div className="main-menu__stat">
          <span className="main-menu__stat-value">{stats.bestScore.toLocaleString()}</span>
          <span className="main-menu__stat-label">Best Score</span>
        </div>
        <div className="main-menu__stat-divider" />
        <div className="main-menu__stat">
          <span className="main-menu__stat-value">🔥 {stats.bestStreak}</span>
          <span className="main-menu__stat-label">Best Streak</span>
        </div>
        <div className="main-menu__stat-divider" />
        <div className="main-menu__stat">
          <span className="main-menu__stat-value">{stats.gamesPlayed}</span>
          <span className="main-menu__stat-label">Games Played</span>
        </div>
      </motion.div>

      <motion.button
        type="button"
        className="main-menu__settings-link"
        onClick={onOpenSettings}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
      >
        ⚙️ Settings
      </motion.button>
    </div>
  );
}
