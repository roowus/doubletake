# Doubletake, explained simply

This is the whole system in plain words. No prior knowledge assumed. If you only read one
section, read [The one-paragraph version](#the-one-paragraph-version) and
[The parts, one at a time](#the-parts-one-at-a-time).

For the precise technical version, see [`ARCHITECTURE.md`](./ARCHITECTURE.md). That file is
for programmers; this one is for you.

---

## The one-paragraph version

Doubletake is a **notebook that fills itself in**. You send it something you found (a reel, a
link, a photo), and later it hands you a written answer about it. To do that it needs four
things: a place to **show** things (your phone or browser), a **brain** that does the work
running on a computer somewhere, a place to **remember** things (a database), and a way to
**get in** (Instagram, or the website). That is the whole architecture. Everything below is
detail about those four.

---

## First, the words

These words get used constantly. Learning them is most of the battle.

| Word | What it really means |
|---|---|
| **Front end** | The part you see and touch. Buttons, text, colours. Runs on *your* device. |
| **Back end** | The part you never see. Runs on a *computer you rent*, always switched on. |
| **Server** | A computer that waits for requests and answers them. Ours runs in the cloud. |
| **Database** | A very organised filing cabinet. It keeps things even when the power goes off. |
| **Stack** | The list of tools someone chose to build with. "What's your stack?" = "what did you use?" |
| **Deploy** | Copying new code onto the live server so real people get it. |
| **Container** | A sealed box holding one program plus everything it needs to run. |
| **API** | The agreed way two programs ask each other for things. Like a restaurant menu. |
| **Endpoint** | One specific item on that menu. E.g. "give me your library" is one endpoint. |
| **Request / Response** | You ask (request), it answers (response). Every interaction is this. |
| **Token** | A temporary password-ish string proving who you are. |
| **Brain** | Our word for the AI that reads your link and writes the answer. |
| **Webhook** | A way for one company to *push* a message to us, instead of us asking repeatedly. |
| **Migration** | A scripted change to the filing cabinet's shape (add a drawer, rename a folder). |

---

## The big picture

```
   YOU
    │
    │  1. send a reel / link
    ▼
┌──────────────────────┐
│  INSTAGRAM  or  WEB  │   ← the front door
└──────────┬───────────┘
           │ 2. "someone sent something"
           ▼
┌──────────────────────────────────────────┐
│  THE BACK END  (one rented Linux computer)│
│                                           │
│   ┌─────────────┐      ┌──────────────┐  │
│   │  The server │─────▶│  The brain   │  │
│   │ (Fastify)   │◀─────│ (an AI)      │  │
│   └──────┬──────┘      └──────────────┘  │
│          │                                │
│          │ 3. save it                     │
│          ▼                                │
│   ┌─────────────────────┐                 │
│   │  THE DATABASE       │  ← the memory   │
│   │  (PostgreSQL)       │                 │
│   └─────────────────────┘                 │
└──────────────────────────────────────────┘
           │
           │ 4. "here's your answer"
           ▼
   YOU (website, phone app, or your own AI agent)
```

Steps 1 to 4 are the entire product. Everything else is making those steps fast, safe,
and reliable.

---

## The parts, one at a time

### 1. The front end (what you see)

There are **three** ways in, and they all share the same look:

| Way in | What it is | Who it's for |
|---|---|---|
| **The website** (`doubletake.gg`) | A web page that works like an app | Most people |
| **The phone app** | The same thing, wrapped so it can be installed and appear in your phone's Share menu | People who want to share straight from Instagram |
| **Instagram** (`@dt.save`) | You DM a reel to an account | People who don't want another app |

The website and phone app are built from **one codebase**. That's deliberate: writing the
same screen twice (once for iPhone, once for Android, once for web) is three times the work
and three times the bugs. So it's written once and packaged three ways.

It's also a **PWA**, which means "Progressive Web App" — a fancy name for a website that can
be installed to your home screen and can work a bit offline. That matters here because people
share things in places with bad signal.

**The tool:** React (for building the screens) + Vite (for packing them up small and fast).

### 2. The back end (the part that does the work)

This is one program on one rented computer. Its job is to answer questions like:

- "This person sent a reel, what do I do?"
- "Show me this person's library."
- "Is this person allowed in?"

**The tool:** Fastify. It's a **web framework** — a starting kit for building a server, so you
don't hand-write the boring, dangerous parts (parsing requests, handling errors, security
headers). We chose it because it's fast and, more importantly, **well-documented and boring**.
Boring is good in a back end.

### 3. The database (the memory)

**We use PostgreSQL.** That's the direct answer to your question.

Think of it as an extremely well-organised filing cabinet with 30 drawers (tables) holding
about 9 MB of your data. It survives restarts. It lets many things read and write at once
without corrupting each other. It can search text. And critically, it enforces rules: if two
people both try to claim the same Instagram pairing code at the same instant, it guarantees
only one of them gets it.

Here's the thing worth knowing: **there are actually two databases in this project**, and
that's on purpose.

| Database | Where it's used | Why |
|---|---|---|
| **PostgreSQL** | The live service (doubletake.gg) | Many users at once, safely separated |
| **SQLite** | When you run it yourself on your own laptop | It's a *single file*. No setup, no server, no password. Just a file. |

Why both? Because the project has two audiences. Someone who wants to run Doubletake for
themselves should be able to do it in one command, and SQLite means "your data is a file you
can copy, back up, or delete." But a public service with many users needs PostgreSQL.

Supporting two is real work — every query has to work on both — and it's the single biggest
source of complexity in this codebase. It's a deliberate trade: convenience for self-hosters,
safety for the hosted service.

**The tool:** Drizzle. It lets us write database queries in TypeScript instead of raw SQL
strings, so the computer catches typos before they reach real users.

> **A coffee-cup way to feel the difference:** SQLite is a notebook on your desk. Only you can
> write in it, it's simple, and if you lose it you've lost it. PostgreSQL is a bank. Many
> people use it at once, it has rules about who owns what, and it keeps a proper audit trail.

### 4. The brain (the AI that does the reading)

When you send a link, something has to actually *understand* it. That's the brain. It's a
separate program we talk to over the internet, and there is a deliberate design decision here:

**You bring your own key.** We call it BYOK ("bring your own key"). Instead of us paying for
everyone's AI usage and charging you a subscription, you connect your own account (or paste
your own key) and the AI runs on *your* bill. We never see your key in readable form — it's
encrypted before it's saved, with a lock whose key lives in a separate file.

Why do it this way? Three honest reasons:

1. **Cost doesn't spiral.** AI usage is metered and unpredictable. If we paid, one heavy user
   could cost us hundreds of pounds a month.
2. **No lock-in.** You can use Claude, or OpenAI, or a model running on your own computer. We
   have an adapter for each, and they're swappable.
3. **It's what technical people prefer.** They already have a key and they'd rather use it.

We also let an AI *agent* (like Claude Code) read your library. That's the **MCP** part — a
standard way for AI tools to plug into a service. Each agent gets its own token you can revoke.

### 5. The media worker (the odd one out)

One small piece is written in a **different language**: Python. It handles video and images —
downloading a reel, pulling out frames, reading text off a screenshot, transcribing speech.

Why Python? Because the tools for that job (ffmpeg wrappers, Whisper for speech-to-text, OCR
for reading text in images) are best in Python. Forcing it into JavaScript would mean using
worse versions of those tools. It runs as a separate little helper that the main server calls
when it needs it.

**This is a normal, healthy thing in a real system.** You don't need one language for
everything; you use the right tool for each job and let them talk over a clear boundary.

---

## How a single thing you send actually flows

This is the part that makes it click. Let's follow one reel.

1. **You DM a reel to `@dt.save`.** Instagram's computers notice and send a message to our
   server. This is the **webhook** — Instagram pushes to us; we don't sit there asking.

2. **We check it's really Instagram.** Anyone can send a web request pretending to be anyone.
   So Instagram *signs* each message with a secret that only they and we know. We check the
   signature. If it doesn't match, we throw the message away. (We learned this the hard way —
   sixteen messages were rejected once because the wrong secret was configured.)

3. **We check who you are.** Have you linked your Instagram account to a Doubletake account?
   If not, we send you a message explaining how, and we *do not* save anything. If yes, we
   know which account the item belongs to.

4. **We save a placeholder row** in the database and reply quickly. This matters: Instagram
   expects a fast answer, and if we're slow they retry, which could save your reel twice.

5. **A worker picks up the job.** The actual work — downloading the video, understanding it,
   writing the answer — happens in the background, not while you wait.

6. **The brain reads it.** It fetches the content, looks for claims worth checking, and writes
   the answer. It records what it cost.

7. **The answer appears** in your library. On the website, the phone app, or through your own
   AI agent.

The clever part is **step 4 being separate from step 5**. "Accept it" and "do the work" are
split, so a slow AI never makes Instagram think we're broken.

---

## Why these choices: the honest version

Every choice is a trade. Here's what we were optimising for.

**Boring and well-documented beats clever.** Fastify, PostgreSQL, React. None are exciting.
All are heavily used, well explained, and easy to hire for or get help with. Excitement in a
back end usually means 3 a.m. debugging.

**One codebase for three front ends.** Less work, fewer bugs, consistent look.

**Two databases, accepting real complexity.** Self-hosters get a single file; the hosted
service gets safety under load.

**Your key, not ours.** Cost stays sane, you keep control, technical users are happier.

**Long-lived connections over polling where possible.** Instagram pushes to us rather than us
asking "anything new?" every few seconds. Fewer wasted requests, faster answers.

**A real, enforced separation between users.** Every query for your data is filtered to *your*
account at one specific place in the code. If that were scattered around, one forgotten filter
would mean one person seeing another's library. This is the single most important correctness
property in the whole system.

**The AI is treated as an unreliable narrator.** It's told to show its sources, mark its
confidence, and separate what it verified from what it's guessing. It *prepares* work; you
confirm. That's a product decision as much as a technical one.

---

## What actually runs, right now

Three **containers** — sealed boxes, each one program — on one rented Linux computer:

| Box | Job |
|---|---|
| **app** | The server, the brain plumbing, the web files. The main one. |
| **postgres** | The database. |
| **caddy** | The doorman. Handles the padlock (HTTPS) and knows which address belongs to which app. |

They start together with a single command. When we change the code, we build a new `app` box
and swap it in — the database box keeps running, so nothing is lost.

That's the whole thing. Three boxes, one computer, doing everything described above.

---

## The stack, in a table

| Piece | Tool | In plain words |
|---|---|---|
| Website / app screens | React + Vite | Building and packing the visible parts |
| Phone app | Capacitor | Wrapping the website so it installs like a real app |
| Server | Fastify (Node.js) | The program that answers requests |
| Language | TypeScript | JavaScript with a spell-checker for types |
| Database (live) | PostgreSQL | The bank — many users, safely separated |
| Database (self-host) | SQLite | The notebook — one simple file |
| Database tooling | Drizzle | Writing queries in TypeScript, not raw SQL |
| Media work | Python + ffmpeg + Whisper | Video, audio, and text-in-images |
| AI | Claude / OpenAI / local, via adapter | The brain. You supply the key. |
| Agent access | MCP | Letting Claude Code read your library |
| Doorman | Caddy | HTTPS, and routing addresses to the app |
| Boxes | Docker Compose | Sealing each program into its own container |
| Code storage | Git + GitHub | History of every change, and backups |

---

## If you remember only five things

1. **Front end** = what you see. **Back end** = the computer doing the work. **Database** =
   the memory.
2. **We use PostgreSQL** for the live service, and **SQLite** when you run it yourself.
3. It's **one front end** packaged three ways (web, phone, Instagram), not three products.
4. **You bring your own AI key**, so costs stay sane and you keep control.
5. The **hardest part** isn't any single tool — it's keeping one person's data strictly
   separate from another's, and there's exactly one place in the code responsible for that.

---

## Where to read more

| If you want... | Read |
|---|---|
| The precise technical version | [`ARCHITECTURE.md`](./ARCHITECTURE.md) |
| Why a specific decision was made | [`adr/`](./adr/) — one short file per decision |
| How to run it yourself | [`../README.md`](../README.md) |
| The look and feel rules | [`../design-system/doubletake/MASTER.md`](../design-system/doubletake/MASTER.md) |
| The plan and what's next | the private repo's `docs/ROADMAP.md` |
