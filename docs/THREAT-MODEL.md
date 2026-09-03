# Threat model

## Assets
1. The owner's files under the read roots (source code, documents, notes).
2. API keys and tokens (brain providers, Instagram, Firebase, VAPID).
3. The Instagram shadow account (ban would break a channel).
4. Money (metered AI spend).
5. Integrity of answers (the owner acts on them).

## Trust boundaries
- **Untrusted**: everything scraped from platforms or fetched from the web; anyone who can DM
  or mention the shadow account (public accounts can mention it); anyone who can reach the
  public webhook URL.
- **Semi-trusted**: the model provider (sees whatever the brain reads); external CLI harnesses.
- **Trusted**: the owner's devices holding tokens; the laptop.

## Threats and mitigations

| # | Threat | Mitigation | Residual risk |
|---|---|---|---|
| T1 | Prompt injection in a caption/comment makes the brain read `~/.ssh/id_rsa` and put it in the answer or a web_fetch URL | Deny list enforced in code; web_fetch has no request body and URLs are logged; untrusted wrappers | Files outside the deny list can be exfiltrated via a crafted URL query string. Mitigation to add: block `web_fetch` to URLs containing content that appeared in a read_file result (taint check) — tracked for M3 |
| T2 | Injection makes the brain write malware into the notes dir | Writes limited to Markdown/text extensions by default; no execution path | Owner might open a malicious link from a note |
| T3 | Stranger triggers runs by mentioning the shadow account | Only mentions **by the owner's accounts** (configurable allowlist of IG usernames) create items; others are logged and ignored | Allowlist misconfiguration |
| T4 | Webhook forgery / replay | Signature verification, event id dedupe, rate limit, `Host` check | Meta app secret leak |
| T5 | Public tunnel exposes the API | Only the webhook route is served on the public host | Misconfigured tunnel |
| T6 | Stolen device token | Tokens revocable; last-seen shown; pairing requires tailnet access | Until revoked, the thief can read chats and share items |
| T7 | Runaway spend | Per-run budget, daily cap, Quick default for save-for-later | Provider-side pricing changes |
| T8 | Shadow account banned for automation | Official API only; no scraping with the account's session; silent in comments | Meta policy changes |
| T9 | SSRF via web_fetch to the laptop's own services | Private-range and localhost refusal after DNS resolution; redirect re-check | DNS rebinding within TTL |
| T10 | Media file exploits (crafted MP4) | ffmpeg/yt-dlp kept current; worker runs as the user (no extra privilege) | Sandbox the worker later (container / seatbelt) |
| T11 | Supply-chain compromise of a dependency | Lockfiles; CI on PRs; minimal dependency set | Same as any Node/Python project |

## Non-goals
Multi-user isolation (single owner), protection against a compromised laptop, hiding the
owner's data from the chosen model provider.

## Red-team fixtures (to be added in M3)
`workers/media/tests/fixtures/injection/` and `packages/brain-sdk/fixtures/` will hold
captions, comments, and pages containing instructions ("ignore previous instructions and…",
Markdown image exfiltration, hidden Unicode). Contract tests assert no forbidden tool call and
no secret string in the answer.
