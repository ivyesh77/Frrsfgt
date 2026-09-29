import { useState } from 'react';
import { motion } from 'framer-motion';
import { Button } from '../../components/common/Button';

interface GuestLoginProps {
  busy: boolean;
  onLogin: (name: string) => void;
}

export function GuestLogin({ busy, onLogin }: GuestLoginProps) {
  const [name, setName] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 2) return;
    onLogin(trimmed);
  }

  return (
    <div className="arena-centered no-select">
      <motion.div
        className="arena-card glass-panel"
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="arena-title">Wager Arena</h1>
        <p className="arena-subtitle">
          Join rooms with real stakes, race the clock, and take home the pool. Practice with virtual coins —
          no real money involved.
        </p>

        <form className="arena-form" onSubmit={handleSubmit}>
          <label className="arena-label" htmlFor="arena-name">
            Player name
          </label>
          <input
            id="arena-name"
            className="arena-input"
            type="text"
            value={name}
            maxLength={24}
            placeholder="Enter a display name"
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <Button type="submit" variant="primary" size="lg" disabled={busy || name.trim().length < 2}>
            {busy ? 'Connecting…' : 'Enter Arena'}
          </Button>
        </form>

        <p className="arena-fineprint">
          New players start with <strong>🪙 1000</strong> virtual coins. This is practice-money only — a real
          payment gateway can be plugged in later.
        </p>
      </motion.div>
    </div>
  );
}
