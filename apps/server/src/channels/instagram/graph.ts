/**
 * Minimal client for the "Instagram API with Instagram Login"
 * (docs/channels/instagram-setup.md). Every call goes to `graph.instagram.com`; the token is
 * passed as a query/body parameter because that is what Meta documents for this API.
 * Facts about response shapes are marked **unverified** in the guide until seen live.
 */

export interface IgComment {
  id: string;
  text: string;
  username?: string;
  timestamp?: string;
  parent_id?: string;
  like_count?: number;
  replies?: { data: IgComment[] };
}

export interface IgMedia {
  id: string;
  caption?: string;
  permalink?: string;
  media_url?: string;
  media_type?: string;
  username?: string;
  timestamp?: string;
  comments?: { data: IgComment[] };
}

export interface IgProfile {
  id: string;
  username?: string;
}

export interface IgTokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  permissions?: string | string[];
}

export class IgGraphError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'IgGraphError';
  }
}

/** What the channel depends on; tests use a fake, production uses `IgGraphClient`. */
export interface IgGraph {
  me(token: string): Promise<IgProfile>;
  exchangeCode(code: string, redirectUri: string): Promise<IgTokenResponse>;
  exchangeLongLived(shortToken: string): Promise<IgTokenResponse>;
  refresh(longToken: string): Promise<IgTokenResponse>;
  mentionedComment(token: string, igUserId: string, commentId: string): Promise<IgComment>;
  mentionedMedia(token: string, igUserId: string, mediaId: string): Promise<IgMedia>;
  ownMedia(token: string, mediaId: string): Promise<IgMedia>;
  react(token: string, igUserId: string, recipientId: string, messageId: string): Promise<void>;
  sendText(token: string, igUserId: string, recipientId: string, text: string): Promise<void>;
  recentTags(token: string, igUserId: string): Promise<IgMedia[]>;
  subscribeApp(token: string, igUserId: string, fields: string[]): Promise<void>;
}

const COMMENT_FIELDS = 'id,text,username,timestamp,parent_id,like_count';
const REPLIES = `replies{${COMMENT_FIELDS}}`;
const MEDIA_FIELDS = 'id,caption,permalink,media_url,media_type,username,timestamp';

export class IgGraphClient implements IgGraph {
  constructor(
    private readonly base: string,
    private readonly appId: string,
    private readonly appSecret: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call<T>(
    method: 'GET' | 'POST',
    path: string,
    params: Record<string, string>,
    token?: string,
  ): Promise<T> {
    const url = new URL(path.replace(/^\//, ''), `${this.base.replace(/\/?$/, '/')}`);
    const q = new URLSearchParams(params);
    if (token) q.set('access_token', token);
    let res: Response;
    if (method === 'GET') {
      url.search = q.toString();
      res = await this.fetchImpl(url, { method, signal: AbortSignal.timeout(20_000) });
    } else {
      res = await this.fetchImpl(url, {
        method,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: q.toString(),
        signal: AbortSignal.timeout(20_000),
      });
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* not json */
    }
    if (!res.ok) {
      const err = (json as { error?: { message?: string; code?: number } } | null)?.error;
      throw new IgGraphError(
        res.status,
        err?.code ?? null,
        err?.message ?? `Instagram API ${res.status}`,
      );
    }
    return json as T;
  }

  me(token: string) {
    return this.call<IgProfile>('GET', 'me', { fields: 'id,username' }, token);
  }

  /** Short-lived token; this endpoint lives on api.instagram.com, not the graph host. */
  async exchangeCode(code: string, redirectUri: string): Promise<IgTokenResponse> {
    const res = await this.fetchImpl('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.appId,
        client_secret: this.appSecret,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code,
      }).toString(),
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json().catch(() => null)) as
      | (IgTokenResponse & { user_id?: string })
      | { error_message?: string; error?: { message?: string } }
      | null;
    if (!res.ok || !json || !('access_token' in json)) {
      const msg =
        (json as { error_message?: string } | null)?.error_message ??
        (json as { error?: { message?: string } } | null)?.error?.message ??
        `Instagram OAuth ${res.status}`;
      throw new IgGraphError(res.status, null, msg);
    }
    return json;
  }

  exchangeLongLived(shortToken: string) {
    return this.call<IgTokenResponse>('GET', 'access_token', {
      grant_type: 'ig_exchange_token',
      client_secret: this.appSecret,
      access_token: shortToken,
    });
  }

  refresh(longToken: string) {
    return this.call<IgTokenResponse>('GET', 'refresh_access_token', {
      grant_type: 'ig_refresh_token',
      access_token: longToken,
    });
  }

  async mentionedComment(token: string, igUserId: string, commentId: string) {
    const r = await this.call<{ mentioned_comment: IgComment }>(
      'GET',
      igUserId,
      { fields: `mentioned_comment.comment_id(${commentId}){${COMMENT_FIELDS},${REPLIES}}` },
      token,
    );
    return r.mentioned_comment;
  }

  async mentionedMedia(token: string, igUserId: string, mediaId: string) {
    const r = await this.call<{ mentioned_media: IgMedia }>(
      'GET',
      igUserId,
      {
        fields: `mentioned_media.media_id(${mediaId}){${MEDIA_FIELDS},comments{${COMMENT_FIELDS},${REPLIES}}}`,
      },
      token,
    );
    return r.mentioned_media;
  }

  ownMedia(token: string, mediaId: string) {
    return this.call<IgMedia>(
      'GET',
      mediaId,
      { fields: `${MEDIA_FIELDS},comments{${COMMENT_FIELDS},${REPLIES}}` },
      token,
    );
  }

  async react(token: string, igUserId: string, recipientId: string, messageId: string) {
    await this.call(
      'POST',
      `${igUserId}/messages`,
      {
        recipient: JSON.stringify({ id: recipientId }),
        sender_action: 'react',
        payload: JSON.stringify({ message_id: messageId, reaction: 'love' }),
      },
      token,
    );
  }

  async sendText(token: string, igUserId: string, recipientId: string, text: string) {
    await this.call(
      'POST',
      `${igUserId}/messages`,
      { recipient: JSON.stringify({ id: recipientId }), message: JSON.stringify({ text }) },
      token,
    );
  }

  async recentTags(token: string, igUserId: string) {
    const r = await this.call<{ data: IgMedia[] }>(
      'GET',
      `${igUserId}/tags`,
      { fields: MEDIA_FIELDS, limit: '25' },
      token,
    );
    return r.data ?? [];
  }

  async subscribeApp(token: string, igUserId: string, fields: string[]) {
    await this.call(
      'POST',
      `${igUserId}/subscribed_apps`,
      { subscribed_fields: fields.join(',') },
      token,
    );
  }
}
