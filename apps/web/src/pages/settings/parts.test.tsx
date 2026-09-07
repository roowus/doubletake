// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Choice, Group, Row, Switch } from './parts';

describe('settings rows', () => {
  it('renders a link row with a chevron, a button row, and a static row', () => {
    const html = renderToStaticMarkup(
      <Group title="Account">
        <Row icon="smartphone" label="Devices" hint="2 paired" to="/settings/devices" />
        <Row label="Sign out" danger onClick={() => {}} />
        <Row label="Server" value="https://x.test" status="ok" />
      </Group>,
    );
    expect(html).toContain('href="/settings/devices"');
    expect(html).toContain('class="srow danger"');
    expect(html).toContain('<button type="button" class="srow danger"');
    expect(html).toContain('class="dot ok"');
    expect(html).toContain('sgroup-title');
  });

  it('external rows open in a new tab', () => {
    const html = renderToStaticMarkup(<Row label="Docs" to="https://example.test" external />);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('control rows carry an accessible switch', () => {
    const html = renderToStaticMarkup(
      <Row
        label="Push"
        control={<Switch label="Push notifications" checked onChange={() => {}} />}
      />,
    );
    expect(html).toContain('<div class="srow has-control"');
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
  });

  it('choice renders one radio per option with the current one marked', () => {
    const html = renderToStaticMarkup(
      <Choice
        name="Theme"
        value="ink"
        options={[
          { id: 'paper', label: 'Paper' },
          { id: 'ink', label: 'Ink' },
        ]}
        onChange={() => {}}
      />,
    );
    expect(html.match(/type="radio"/g)?.length).toBe(2);
    expect(html).toContain('data-on=""');
  });
});
