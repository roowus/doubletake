import type { ChatDetail } from '@doubletake/shared';
import type React from 'react';
import { Icon } from './Icon';
import { Menu, type MenuAction } from './Menu';

/**
 * The top of the answer page: back, status while a run is working, the overflow menu, then the
 * source line, then the title. Nothing else: the run's mode/cost sits in the footer row
 * (ADR 0034), so the header is a control row and two lines of type, and the answer starts
 * immediately under it.
 */
export function ChatHeader({
  chat,
  source,
  onBack,
  actions,
}: {
  chat: ChatDetail['chat'];
  /** The source line (host, date, thumbnail) rendered under the controls, above the title. */
  source?: React.ReactNode;
  onBack: () => void;
  actions: (MenuAction | 'separator')[];
}) {
  return (
    <header className="chat-head">
      <div className="chat-head-row">
        <button type="button" className="ghost icon" onClick={onBack} aria-label="Back">
          <Icon name="arrow-left" />
        </button>
        <span className={`status ${chat.status}`}>{chat.status}</span>
        <span className="grow" />
        <Menu label="More actions" trigger={<Icon name="more" />} items={actions} />
      </div>
      {source}
      <h1 className="chat-title">{chat.title}</h1>
    </header>
  );
}
