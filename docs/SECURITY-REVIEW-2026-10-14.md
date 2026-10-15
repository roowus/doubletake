# Security review, 2026-10-14

An owner-requested audit: *is the database encrypted, is there a key, and what would we lose
in a breach?* Findings below are what the code and the running host actually do, not what they
are meant to do. Written to be readable without a security background.

**Read this before the detail:** there is no single catastrophic hole here, but there are two
real gaps and one significant architectural exposure that should be fixed. The most important
thing in this document is [Finding 0](#finding-0--the-database-is-not-encrypted-and-that-is-the-real-exposure),
because it is a decision, not a bug.

---

## The short version

| Question | Honest answer |
|---|---|
| Is the database encrypted? | **No.** Rows sit in plain text on disk. |
| Is there a key encrypting everything? | **No** — and there is no such thing as one key that encrypts "the whole app". |
| Is *anything* encrypted? | **Yes**: Instagram tokens and BYOK AI keys. Those are sealed properly. |
| Is the disk encrypted? | **No.** No LUKS on the host volume. |
| Biggest realistic risk | Someone with access to the server (or a stolen Oracle account) reads every user's email and library directly. |
| Is there a login brute-force gap? | **Yes.** No rate limiting. Confirmed live. |
| Are passwords safe? | **Yes.** Argon2id — the current best practice. |
| SQL injection? | **No.** All queries are parameterised. |
| Secrets in the public repo? | **No.** Verified. |
| Dependency vulnerabilities? | **19** (1 critical, 7 high), mostly in the web bundle and MCP SDK. |

Your instinct was right: **not encrypting the database is an issue**, and it is worth fixing.
But the fix is not quite "store one secret key" — see below, because that framing has a trap
in it.

---

## Finding 0 — the database is not encrypted, and that is the real exposure

### What we actually have

```
users.email              roowus.dev@gmail.com          <- plain text
items.title              ...                         <- plain text
ig_accounts.access_token_enc   v1.nH5co9JWQ...        <- ENCRYPTED (ChaCha20-Poly1305)
credentials.sealed_key   v1....                      <- ENCRYPTED (ChaCha20-Poly1305)
users.password_hash      $argon2id$v=19$m=194...     <- hashed (not reversible)
```

So: **secrets are encrypted, personal data is not.** That is a defensible split, but it means
anyone who gets the database file gets every user's email and everything they have saved.

### Why "store a key that encrypts everything" is a trap

This is the part I want to be careful about, because the obvious fix is a trap.

If you encrypt the whole database with one key, **and you store that key next to the
database**, you have not improved anything. The attacker who can read the database can
normally read the key too — it is on the same disk, in the same container, or in the same
`.env` file. You have added complexity and bought nothing.

Encryption at rest genuinely protects you against exactly three things:

1. Someone steals the **disk** or a **backup file** but not the running server.
2. Someone gets a **database dump** (a copy) but not the key.
3. A cloud provider's **storage layer** is compromised.

It does **not** protect you against someone who owns the running server, because the running
server must be able to decrypt in order to work. This is unavoidable — any system that can
read its own data can be made to read it by someone who controls it.

So the correct fix is not "one key". It is:

1. **Encrypt the disk** (LUKS) so a stolen volume is useless. This is the single highest-value
   change and it costs nothing in code.
2. **Keep the key off the database host** — in a real secrets manager, not in `.env` on the
   same box. Ours currently lives at `deploy/secrets/master-key` on the same machine.
3. **Minimise what you keep.** The best protection for PII is not having it. Do we need to
   store a raw email, or would a hash + a display name do?
4. **Column-level encryption for the genuinely sensitive fields**, with the key held outside
   the database — this is what we already do for tokens and API keys, and it is the right
   pattern to extend.

### The Oracle question

Oracle Cloud offers **block volume encryption** — volumes are encrypted at rest by default.
But: **the key is managed by Oracle unless you configure your own.** Default encryption
protects against a stolen physical disk in Oracle's datacentre. It does **not** protect against
someone who has your Oracle account or your running VM, because the VM decrypts transparently.

So Oracle's default encryption would have stopped *none* of the realistic attack paths here.
It is not a substitute for fixing this properly.

### Also worth knowing: the host runs everything as root

```
$ docker compose exec app id
uid=0(root) gid=0(root)
```

If the app is ever compromised, the attacker gets root inside the container, which makes
escaping to the host much easier. Running as a non-root user is a cheap, standard hardening
step we should take.

---

## Finding 1 — no rate limiting on login (confirmed live)

Ten rapid wrong-password attempts, all processed:

```
$ for i in $(seq 1 10); do curl -s -o /dev/null -w "%{http_code} " -X POST \
    https://doubletake.gg/api/auth/login -d '{"email":"...","password":"wrongwrong"}'; done
401 401 401 401 401 401 401 401 401 401
```

Nothing throttles this. An attacker can guess passwords as fast as the network allows.

Passwords are Argon2id, which makes each guess expensive, and that is a real mitigation. But
it only buys time; it does not stop a slow, patient attack.

On enumeration I checked rather than assumed, and the news is better than expected: the error
message is already generic (`invalid email or password`), and the timing difference between a
known and an unknown account is negligible in practice (0.06 s vs 0.05 s measured live) — the
code short-circuits before hashing for an unknown user, but Argon2's cost here is small enough
that the gap is not a usable oracle. The remaining exposure is purely the missing throttle.

**Fix:** add `@fastify/rate-limit` to the auth routes (and keep the generic error).

---

## Finding 2 — dependency vulnerabilities

`pnpm audit --prod`: **19 vulnerabilities** — 1 critical, 7 high, 8 moderate, 3 low.

| Severity | Package | Issue | Patched |
|---|---|---|---|
| **critical** | `proxy-addr` | IP spoofing via IPv4-mapped IPv6 trust subnet | >=2.0.8 |
| high | `fastify` (x4) | auth bypass, validation bypass, body replacement | >=5.12.2 |
| high | `@modelcontextprotocol/sdk` | OAuth client could leak credentials | >=1.31.0 |
| high | `brace-expansion` | DoS via nested braces | >=5.0.11 |
| moderate | `dompurify` | XSS bypass | >=3.4.16 |
| low | `katex` | prototype pollution | >=0.18.2 |

**Good news on the critical one and the Fastify auth bypass.** I checked whether our code is
actually reachable by them, and it is not:

- `proxy-addr`'s spoofing matters if you make trust decisions from a client IP. We do not gate
  anything on IP.
- The Fastify auth bypass requires *encapsulated plugin prefixes* with a per-plugin
  `preHandler` on `setNotFoundHandler`. We have **one** global `setNotFoundHandler` and auth in
  a global `onRequest` hook that runs before everything. Our shape is not the vulnerable one.

That is load-bearing on not restructuring those routes. It is still worth upgrading.

**Fix:** update the packages. This is mostly mechanical.

---

## What is already good

I want to be straight that this is not a mess — several things are done properly:

| Area | State |
|---|---|
| Passwords | **Argon2id**, current best practice, memory-hard |
| Session tokens | Random, stored **hashed** (`sha256`), so a DB leak does not yield live sessions |
| Cookies | `HttpOnly; SameSite=Lax; Secure` — correct |
| SQL injection | **None found.** Drizzle parameterises everything; the `sql\`\`` usages bind values |
| Secrets in git | **None.** Only `.env.example` with placeholders |
| Token/API-key storage | **ChaCha20-Poly1305** sealed, wiped on revoke |
| Tenant isolation | Every user-data query filtered in **one** place (`Repo.scope()`) — the most important correctness property, and it is centralised |
| Database exposure | Port 5432 **not** reachable from the internet (verified) |
| HTTPS | Caddy, HSTS `max-age=31536000` |
| Prompt injection | Fetched content is wrapped as untrusted and the brain has no shell tool |

Missing HTTP headers: `Content-Security-Policy`, `X-Frame-Options` /
`frame-ancestors`, `Permissions-Policy`. Worth adding.

---

## Priority order

Most value per unit of effort first. Effort is my estimate.

| # | Fix | Effort | Why it matters |
|---|---|---|---|
| 1 | **Rate-limit auth routes** | small | Stops password guessing. Confirmed live gap; errors are already generic. |
| 2 | **Update vulnerable dependencies** | small | 1 critical + 7 high, even if not reachable today |
| 3 | **Encrypt the host disk (LUKS)** | medium, needs downtime | Makes a stolen volume or snapshot useless |
| 4 | **Move the master key off the DB host** | medium | Today it sits beside the data it protects |
| 5 | **Run containers as non-root** | small | Cheap, standard containment |
| 6 | **Add CSP + frame-ancestors + Permissions-Policy** | small | Defence in depth for the browser |
| 7 | **Reduce what PII we store** | medium | Best protection is not holding it |
| 8 | **Off-host backups, tested restore** | medium | Ransomware and mistakes, not just hacks |

Items 1, 2, 5, 6 are safe to do immediately with no downtime. Item 3 is the one that needs a
maintenance window and a fresh volume.

---

## How bad is a breach right now, honestly?

Small, because the service is small: **1 real user** (plus test accounts), **0 items** of
saved content, and a 9 MB database. So the practical exposure today is a handful of email
addresses.

The reason to fix this **now** rather than later is that the cost of doing it is low while
there is nothing to lose, and the cost of doing it after a leak is not. The architectural
exposure — plaintext PII plus a key sitting next to it — does not get better on its own.

---

## What I did not check

Being explicit about the limits of this review:

- No penetration test was run against the live host.
- No automated secret scanner (`gitleaks`/`trufflehog`) was installed; the git history was
  checked by filename and pattern only.
- Google OAuth, OpenRouter PKCE and the Meta webhook were reviewed by reading code, not by
  attack.
- Backups, log retention and GDPR obligations were not audited.
- The mobile app's local storage was not reviewed.
