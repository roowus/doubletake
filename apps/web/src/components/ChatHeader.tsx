import type { ChatDetail } from '@doubletake/shared';
import { hostOf } from './ClipCard';
import { Icon, platformIcon } from './Icon';
import { Menu, type MenuAction } from './Menu';

/**
 * Top of a notebook page: back, the title in the reading face, the status, and a meta line
 * set in mono (source host, mode, question type, spend). The overflow menu holds the
 * occasional actions so they do not compete with the answer.
 */
export function ChatHeader({
  chat,
  item,
  totalCost,
  onBack,
  actions,
}: {
  chat: ChatDetail['chat'];
  item: ChatDetail['item'];
  totalCost: number;
  onBack: () => void;
  actions: (MenuAction | 'separator')[];
}) {
  const url = item.canonicalUrl ?? chat.sourceUrl;
  const host = hostOf(url);
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
      <h1 className="chat-title">
        <Icon name={platformIcon(chat.platform)} size={18} className="glyph" />
        {chat.title}
      </h1>
      <div className="mono-meta chat-meta">
        {host && url && (
          <a href={url} target="_blank" rel="noopener noreferrer">
            {host}
            <Icon name="external-link" size={12} />
          </a>
        )}
        {item.modeEffective && <span>{item.modeEffective}</span>}
        {item.questionType && <span>{item.questionType.replace(/_/g, ' ')}</span>}
        {chat.category && <span>{chat.category}</span>}
        {totalCost > 0 && <span>${totalCost.toFixed(3)}</span>}
      </div>
    </header>
  );
}
