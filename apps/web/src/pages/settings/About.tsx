import { apiBase } from '../../native';
import { Group, Row, SettingsPage } from './parts';

declare const __DT_VERSION__: string;

const REPO = 'https://github.com/roowus/doubletake';

/** Settings → About: version, server, docs. */
export function AboutSettings() {
  const version = typeof __DT_VERSION__ === 'string' ? __DT_VERSION__ : 'dev';
  return (
    <SettingsPage
      title="About"
      intro="Doubletake is a field notebook that fills itself in: clip something, walk away, come back to a well-set page about it."
    >
      <Group title="This build">
        <Row icon="doubletake" label="Version" value={<span className="mono">{version}</span>} />
        <Row
          icon="server"
          label="Server"
          value={<span className="mono small truncate">{apiBase() || location.origin}</span>}
        />
      </Group>
      <Group title="Learn more" foot="Self-hosted, AGPL-3.0. Your data never leaves your server.">
        <Row
          icon="file-text"
          label="Documentation"
          hint="Architecture, channels, research modes"
          to={`${REPO}/tree/main/docs`}
          external
        />
        <Row
          icon="external-link"
          label="Source code"
          hint="github.com/roowus/doubletake"
          to={REPO}
          external
        />
        <Row icon="alert" label="Report a problem" to={`${REPO}/issues`} external />
      </Group>
    </SettingsPage>
  );
}
