# 0010 — Owner password and per-device tokens

- Status: accepted
- Date: 2026-09-03

## Context
One owner, several devices, no wish to run an identity provider. Devices must authenticate
every request, including the share sheet's fire-and-forget post.

## Decision
Set an owner password at first run (argon2id hash in `settings`). Pair each device by
scanning a QR shown in the settings page that contains the server URL and a short-lived pairing
code; the device exchanges it for a long-lived random token (hash stored in `devices`). Tokens
are revocable from the devices list. Secrets at rest are encrypted with a key derived from the
password and a machine keyfile.

## Alternatives considered
- OAuth / OIDC: overkill for one user.
- Tailscale identity headers only: ties auth to one network path; the webhook tunnel and Web
  Share Target need tokens anyway.
- Static API key in a config file: no per-device revocation.

## Consequences
Losing the password means re-entering secrets (the encryption key derives from it); the docs
say so. Pairing requires the phone to reach the server once over Tailscale.
