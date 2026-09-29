import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import type { Settings } from '../../types';
import { Button } from '../common/Button';
import './SettingsModal.css';

interface SettingsModalProps {
  open: boolean;
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onClose: () => void;
  onResetStats: () => void;
}

interface ToggleRowProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function ToggleRow({ label, description, checked, onChange }: ToggleRowProps) {
  return (
    <div className="settings-row">
      <div className="settings-row__text">
        <span className="settings-row__label">{label}</span>
        <span className="settings-row__desc">{description}</span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`settings-toggle${checked ? ' settings-toggle--on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className="settings-toggle__thumb" />
      </button>
    </div>
  );
}

export function SettingsModal({ open, settings, onChange, onClose, onResetStats }: SettingsModalProps) {
  const [confirmingReset, setConfirmingReset] = useState(false);

  function handleClose() {
    setConfirmingReset(false);
    onClose();
  }

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') handleClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="settings-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) handleClose();
          }}
        >
          <motion.div
            className="settings-modal glass-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            initial={{ opacity: 0, scale: 0.92, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 10 }}
            transition={{ duration: 0.25, ease: [0.2, 0.9, 0.32, 1] }}
          >
            <div className="settings-modal__header">
              <h2 id="settings-title">Settings</h2>
              <button type="button" className="settings-modal__close" onClick={handleClose} aria-label="Close settings">
                ✕
              </button>
            </div>

            <ToggleRow
              label="🔊 Sound"
              description="Sound effects for clicks, correct, and wrong answers"
              checked={settings.sound}
              onChange={(v) => onChange({ sound: v })}
            />
            <ToggleRow
              label="🎵 Music"
              description="Soft ambient background music"
              checked={settings.music}
              onChange={(v) => onChange({ music: v })}
            />
            <ToggleRow
              label="📳 Haptics"
              description="Vibration feedback on supported devices"
              checked={settings.haptics}
              onChange={(v) => onChange({ haptics: v })}
            />
            <ToggleRow
              label="🎞️ Reduced Motion"
              description="Minimize animations and particle effects"
              checked={settings.reducedMotion}
              onChange={(v) => onChange({ reducedMotion: v })}
            />

            <div className="settings-modal__danger">
              {confirmingReset ? (
                <div className="settings-modal__confirm">
                  <span>Reset all local stats? This can't be undone.</span>
                  <div className="settings-modal__confirm-actions">
                    <Button
                      variant="danger"
                      onClick={() => {
                        onResetStats();
                        setConfirmingReset(false);
                      }}
                    >
                      Confirm Reset
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirmingReset(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button variant="ghost" onClick={() => setConfirmingReset(true)}>
                  Reset Local Stats
                </Button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
