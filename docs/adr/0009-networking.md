# 0009 — Loopback bind; Tailscale by default; tunnel for the webhook only

- Status: accepted
- Date: 2026-09-03

## Context
The server holds the owner's files and API keys and runs on a laptop that moves between
networks. Clients need HTTPS from anywhere. Meta needs a public HTTPS endpoint for webhooks.

## Decision
Bind `127.0.0.1`. Expose to clients through `tailscale serve` (HTTPS with tailnet certs).
Expose only `/webhooks/instagram` publicly through Cloudflare Tunnel or Tailscale Funnel,
chosen in config. The server checks the `Host` header and refuses non-webhook routes that
arrive via the public hostname.

## Alternatives considered
- Port-forward + Let's Encrypt: exposes the whole API and the laptop's IP.
- Tunnel everything: puts the private API behind a public hostname protected only by tokens.
- Tailscale Funnel for clients too: works, but Cloudflare is the more common tunnel for
  self-hosters; both are supported.

## Consequences
Tailscale is a hard dependency for the default path (documented). Webhook exposure is the
single public surface and gets signature verification plus rate limiting.
