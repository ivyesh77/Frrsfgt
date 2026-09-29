import { useState } from 'react';
import { motion } from 'framer-motion';
import { Button } from '../../components/common/Button';
import { AuthModal, type AuthMode } from './AuthModal';
import { GAME_KIND_TAGLINES } from '../types';
import gameThumbnail from '../../assets/images/memory-match-thumbnail.webp';

interface HomeProps {
  busy: boolean;
  onLogin: (name: string, password: string) => Promise<void>;
  onSignup: (name: string, password: string) => Promise<void>;
}

const HIGHLIGHTS = [
  { icon: '🧠', label: 'Memory Match', detail: 'One focused, fast-paced game' },
  { icon: '🏆', label: '80% to the winner', detail: 'Platform keeps a transparent 20% cut' },
  { icon: '🪙', label: '1000 free coins', detail: 'Practice currency, no real money' },
];

const STEPS = [
  { step: '1', title: 'Join a room', detail: 'Pick an entry-fee tier, then create or join a room.' },
  { step: '2', title: 'Race the clock', detail: 'Everyone gets 60 seconds of independently-paced rounds.' },
  { step: '3', title: 'Winner takes the pool', detail: 'Highest score wins 80% of the pool, paid out instantly.' },
];

/** Marketing-style landing page. Login/Sign up live in the top-right corner, not as a full-page gate. */
export function Home({ busy, onLogin, onSignup }: HomeProps) {
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('signup');

  function openAuth(mode: AuthMode) {
    setAuthMode(mode);
    setAuthOpen(true);
  }

  return (
    <div className="home-screen no-select">
      <header className="home-nav">
        <div className="home-nav__brand">
          <span aria-hidden="true">🪙</span> Wager Arena
        </div>
        <div className="home-nav__auth">
          <button type="button" className="home-nav__login" onClick={() => openAuth('login')}>
            Log In
          </button>
          <Button variant="primary" size="md" onClick={() => openAuth('signup')}>
            Sign Up
          </Button>
        </div>
      </header>

      <main className="home-content">
        <motion.section
          className="home-hero"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <div className="home-hero__copy">
            <h1 className="home-hero__title">Memory Match, played for real stakes.</h1>
            <p className="home-hero__subtitle">
              Stake virtual coins, race a shared 60-second clock, and take home the pool if your memory is fastest
              and sharpest. One game, done right.
            </p>
            <div className="home-hero__cta">
              <Button variant="primary" size="lg" onClick={() => openAuth('signup')}>
                Get Started Free
              </Button>
              <button type="button" className="home-hero__login-link" onClick={() => openAuth('login')}>
                Already have an account? Log in
              </button>
            </div>
          </div>
          <div className="home-hero__art-wrap">
            <img className="home-hero__art" src={gameThumbnail} alt="Memory Match" />
          </div>
        </motion.section>

        <section className="home-highlights" aria-label="Highlights">
          {HIGHLIGHTS.map((h) => (
            <div key={h.label} className="home-highlight glass-panel">
              <span className="home-highlight__icon" aria-hidden="true">
                {h.icon}
              </span>
              <div>
                <div className="home-highlight__label">{h.label}</div>
                <div className="home-highlight__detail">{h.detail}</div>
              </div>
            </div>
          ))}
        </section>

        <section className="home-section" aria-label="About the game">
          <h2 className="home-section__title">How Memory Match works</h2>
          <p className="home-section__lede">{GAME_KIND_TAGLINES.memoryMatch}</p>
          <div className="home-steps">
            {STEPS.map((s) => (
              <div key={s.step} className="home-step glass-panel">
                <div className="home-step__number">{s.step}</div>
                <div className="home-step__title">{s.title}</div>
                <div className="home-step__detail">{s.detail}</div>
              </div>
            ))}
          </div>
        </section>

        <footer className="home-footer">
          <p className="arena-fineprint">
            Real money is never processed here. Wager Arena runs on a practice virtual wallet only.
          </p>
        </footer>
      </main>

      <AuthModal
        open={authOpen}
        initialMode={authMode}
        busy={busy}
        onLogin={onLogin}
        onSignup={onSignup}
        onClose={() => setAuthOpen(false)}
      />
    </div>
  );
}
