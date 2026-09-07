import { useEffect, useState } from 'react';
import {
  type Appearance,
  type Motion,
  type ProseSize,
  readAppearance,
  type Theme,
  writeAppearance,
} from '../../appearance';
import { Choice, Group, Row, SettingsPage, Switch } from './parts';

const THEMES: { id: Theme; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'paper', label: 'Paper' },
  { id: 'ink', label: 'Ink' },
];
const SIZES: { id: ProseSize; label: string }[] = [
  { id: 's', label: 'S' },
  { id: 'm', label: 'M' },
  { id: 'l', label: 'L' },
];

/** Settings → Appearance: theme, answer text size, motion. Stored on this device only. */
export function AppearanceSettings() {
  const [a, setA] = useState<Appearance>(readAppearance);
  useEffect(() => {
    const on = () => setA(readAppearance());
    window.addEventListener('doubletake:appearance', on);
    return () => window.removeEventListener('doubletake:appearance', on);
  }, []);
  const set = (patch: Partial<Appearance>) => setA(writeAppearance(patch));

  return (
    <SettingsPage title="Appearance" intro="Applies to this device only and takes effect at once.">
      <Group
        title="Theme"
        foot="Paper is the light notebook, Ink the dark one. System follows the device."
      >
        <Row
          icon={a.theme === 'ink' ? 'moon' : 'sun'}
          label="Theme"
          control={
            <Choice
              name="Theme"
              value={a.theme}
              options={THEMES}
              onChange={(t) => set({ theme: t })}
            />
          }
        />
      </Group>
      <Group title="Reading" foot="Size of the answer prose. Interface text stays the same.">
        <Row
          icon="text"
          label="Answer text"
          control={
            <Choice
              name="Answer text size"
              value={a.prose}
              options={SIZES}
              onChange={(p) => set({ prose: p })}
            />
          }
        />
        <div className="srow preview">
          <p className="prose-sample">
            The quick brown fox jumps over the lazy dog, and the margin rail marks where the answer
            starts.
          </p>
        </div>
      </Group>
      <Group
        title="Motion"
        foot="On removes sheet slides, tab fades and the rail's fill. Your system setting is honoured either way."
      >
        <Row
          label="Reduce motion"
          hint={a.motion === 'reduce' ? 'Animations off' : 'Follows the system'}
          control={
            <Switch
              label="Reduce motion"
              checked={a.motion === 'reduce'}
              onChange={(on) => set({ motion: (on ? 'reduce' : 'system') as Motion })}
            />
          }
        />
      </Group>
    </SettingsPage>
  );
}
