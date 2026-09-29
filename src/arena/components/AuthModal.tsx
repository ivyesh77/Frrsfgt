import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Button } from '../../components/common/Button';
import type { AuthMode } from '../api';

interface AuthModalProps {
  open: boolean;
  initialMode: AuthMode;
  busy: boolean;
  onSubmit: (name: string, mode: AuthMode) => Promise<void>;
  onClose: () => void;
}

/** Production-style login/sign-up dialog: tabbed, validated, inline errors, no page navigation. */
export function AuthModal({ open, initialMode, busy, onSubmit, onClose }: AuthModalProps) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset the form to the requested tab each time the modal transitions from closed to open.
  // This adjusts state during render (React's documented pattern for "reset state when a prop
  // changes") rather than in an effect, so it doesn't trigger an extra unnecessary render pass.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setMode(initialMode);
      setError(null);
      setName('');
    }
  }

  useEffect(() => {
    if (!open) return;
    // Autofocus once the open animation has started mounting the input.
    const id = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  function switchMode(next: AuthMode) {
    setMode(next);
    setError(null);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError('Name must be at least 2 characters.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(trimmed, mode);
      // On success the parent unmounts this modal by switching stage — nothing else to do here.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const isBusy = busy || submitting;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="auth-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={mode === 'login' ? 'Log in' : 'Create account'}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            className="auth-modal glass-panel"
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.2, 0.9, 0.32, 1] }}
          >
            <button type="button" className="auth-modal__close" aria-label="Close" onClick={onClose}>
              ✕
            </button>

            <div className="auth-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'login'}
                className={`auth-tab ${mode === 'login' ? 'auth-tab--active' : ''}`}
                onClick={() => switchMode('login')}
              >
                Log In
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'signup'}
                className={`auth-tab ${mode === 'signup' ? 'auth-tab--active' : ''}`}
                onClick={() => switchMode('signup')}
              >
                Sign Up
              </button>
            </div>

            <form className="arena-form" onSubmit={handleSubmit}>
              <label className="arena-label" htmlFor="auth-name">
                Display name
              </label>
              <input
                id="auth-name"
                ref={inputRef}
                className="arena-input"
                type="text"
                value={name}
                maxLength={24}
                placeholder={mode === 'login' ? 'Your existing display name' : 'Pick a display name'}
                onChange={(e) => setName(e.target.value)}
                autoComplete="username"
              />

              {error && (
                <div className="auth-error" role="alert">
                  {error}
                </div>
              )}

              <Button type="submit" variant="primary" size="lg" disabled={isBusy || name.trim().length < 2}>
                {isBusy ? 'Please wait…' : mode === 'login' ? 'Log In' : 'Create Account'}
              </Button>
            </form>

            {mode === 'login' ? (
              <p className="arena-fineprint">
                New here?{' '}
                <button type="button" className="auth-switch-link" onClick={() => switchMode('signup')}>
                  Create an account
                </button>
              </p>
            ) : (
              <p className="arena-fineprint">
                Already playing?{' '}
                <button type="button" className="auth-switch-link" onClick={() => switchMode('login')}>
                  Log in instead
                </button>
              </p>
            )}

            {mode === 'signup' && (
              <p className="arena-fineprint">
                New accounts start with <strong>🪙 1000</strong> virtual coins — practice money only, no real
                payment is processed.
              </p>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
