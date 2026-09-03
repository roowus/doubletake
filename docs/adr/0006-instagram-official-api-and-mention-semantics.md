# 0006 — Instagram via official API; comment-mention semantics

- Status: accepted
- Date: 2026-09-03

## Context
The owner mostly scrolls Instagram. The official "Instagram API with Instagram Login" can
receive DMs and comment mentions for a Business/Creator account the owner controls, without
App Review while the only sender is an app-role account. Unofficial private-API clients get
accounts banned. The owner also wants to @mention the bot in comments so the analysis focuses
on the discussion, and to mention it inside a reply thread to focus on that thread.

## Decision
Use a shadow Business/Creator account plus a Meta app in Live mode, Standard Access, scopes
`instagram_business_basic`, `instagram_business_manage_messages`,
`instagram_business_manage_comments`. DM share is the guaranteed path. Comment @mention sets
`focus=comments` when the mention is a top-level comment and `focus=thread:<parent_id>` when
it is a reply. The bot never posts publicly; completion is signalled by push and a `love`
reaction on the originating DM only. Media download prefers the signed CDN URL from the DM
payload, then yt-dlp.

## Alternatives considered
- Unofficial API / session cookies: ban risk on the shadow account; fragile.
- Public reply in comments (SaveToList style): leaves a trace on other people's posts; the
  owner chose silence.
- Only DMs: loses the comment-focus feature the owner asked for explicitly.

## Consequences
The mention webhook under Standard Access is unverified; M4 must test it on day one and fall
back to polling. Token refresh is a scheduled job. The webhook path must be public, which
drives ADR 0009.
