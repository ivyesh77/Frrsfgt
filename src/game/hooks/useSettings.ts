import { useCallback, useEffect, useState } from 'react';
import type { Settings } from '../../types';
import { loadSettings, saveSettings } from '../../utils/storage';
import { soundEngine } from '../../audio/soundEngine';

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());

  useEffect(() => {
    soundEngine.setMuted(!settings.sound);
    soundEngine.setMusicEnabled(settings.sound && settings.music);
  }, [settings.sound, settings.music]);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  return { settings, update };
}
