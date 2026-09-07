import { AboutSettings } from './settings/About';
import { AppearanceSettings } from './settings/Appearance';
import { DataSettings } from './settings/Data';
import { DevicesSettings } from './settings/Devices';
import { InstagramSettings } from './settings/Instagram';
import { NotificationsSettings } from './settings/Notifications';
import { ResearchSettings } from './settings/Research';
import { SettingsIndex } from './settings/SettingsIndex';

/**
 * `/settings` is the grouped index; `/settings/<section>` opens one section page. Unknown
 * sections fall back to the index rather than a 404 so old links keep working.
 */
export function Settings({ section }: { section?: string | undefined }) {
  switch (section) {
    case 'devices':
      return <DevicesSettings />;
    case 'research':
      return <ResearchSettings />;
    case 'notifications':
      return <NotificationsSettings />;
    case 'instagram':
      return <InstagramSettings />;
    case 'data':
      return <DataSettings />;
    case 'appearance':
      return <AppearanceSettings />;
    case 'about':
      return <AboutSettings />;
    default:
      return <SettingsIndex />;
  }
}
