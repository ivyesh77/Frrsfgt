import { Button } from '../../components/common/Button';
import { useArenaPrefs } from '../useArenaPrefs';
import { systemPrefersReducedMotion } from '../prefs';
import { sounds } from '../sound';
import { haptics } from '../haptics';

interface SettingsScreenProps {
  onBack: () => void;
  onLogout: () => Promise<void> | void;
}

/** Local, non-financial, non-identity preferences only (sound/music/haptics/reduced
 *  motion) — stored in localStorage, see arena/prefs.ts. Logout is here too since it's the
 *  conventional place for it, but it goes through the same real session-destroying
 *  server call as everywhere else (see useArena.logout) — nothing about auth is ever
 *  decided locally. */
export function SettingsScreen({ onBack, onLogout }: SettingsScreenProps) {
  const [prefs, setPrefs] = useArenaPrefs();
  const systemReduced = systemPrefersReducedMotion();

  function toggleSound() {
    const next = !prefs.soundEnabled;
    setPrefs({ soundEnabled: next });
    if (next) sounds.click();
  }
  function toggleMusic() {
    setPrefs({ musicEnabled: !prefs.musicEnabled });
    sounds.click();
  }
  function toggleHaptics() {
    const next = !prefs.hapticsEnabled;
    setPrefs({ hapticsEnabled: next });
    if (next) haptics.tap();
  }

  return (
    <div className="settings-screen no-select">
      <button type="button" className="profile-back" onClick={onBack}>
        ← Back
      </button>
      <h1 className="arena-title arena-title--sm">Settings</h1>

      <section className="arena-section">
        <h2 className="arena-section__title">Sound &amp; Haptics</h2>
        <ToggleRow label="Sound effects" description="Short synthesized tones for taps, correct/wrong answers, and match results." checked={prefs.soundEnabled} onChange={toggleSound} />
        <ToggleRow label="Background music" description="Ambient music while browsing the app (not during live gameplay)." checked={prefs.musicEnabled} onChange={toggleMusic} />
        <ToggleRow label="Haptics (vibration)" description="Vibration feedback on supported devices for taps and match events." checked={prefs.hapticsEnabled} onChange={toggleHaptics} />
      </section>

      <section className="arena-section">
        <h2 className="arena-section__title">Accessibility</h2>
        <ToggleRow
          label="Reduce motion"
          description={`Minimizes animations app-wide. ${prefs.reducedMotion === null ? `Currently following your device setting (${systemReduced ? 'reduced' : 'full motion'}).` : ''}`}
          checked={prefs.reducedMotion ?? systemReduced}
          onChange={() => setPrefs({ reducedMotion: !(prefs.reducedMotion ?? systemReduced) })}
        />
        {prefs.reducedMotion !== null && (
          <button type="button" className="settings-reset-link" onClick={() => setPrefs({ reducedMotion: null })}>
            Reset to follow device setting
          </button>
        )}
      </section>

      <section className="arena-section">
        <h2 className="arena-section__title">Account</h2>
        <Button variant="danger" size="md" onClick={() => void onLogout()}>
          Log Out
        </Button>
      </section>
    </div>
  );
}

function ToggleRow({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: () => void }) {
  return (
    <div className="settings-toggle-row glass-panel">
      <div>
        <span className="settings-toggle-row__label">{label}</span>
        <p className="settings-toggle-row__desc">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`settings-switch ${checked ? 'settings-switch--on' : ''}`}
        onClick={onChange}
      >
        <span className="settings-switch__thumb" />
      </button>
    </div>
  );
}
