# Doubletake

**Share it now, get a researched answer later.**

You are scrolling. A reel says "use this Claude skill when vibe coding", a comment thread argues about a note app, a video lists five skiing tips. You will never go back to check any of it. Doubletake fixes that: share the post to your own server from the share sheet (or to a shadow Instagram account you control), type a question if you have one, keep scrolling. A few minutes later your phone buzzes with a researched answer, and each shared item is its own chat you can ask follow-ups in.

Doubletake is **self-hosted** (it runs on the laptop you already work on), **open source** (AGPL-3.0), and built for **one owner per instance**.

> Status: **M1 vertical slice runs** (compose a URL or text → Claude Agent SDK researches it → chat with entity cards, cost line, follow-ups, Markdown export). No media pipeline, share sheet, or Instagram channel yet. See [docs/ROADMAP.md](docs/ROADMAP.md).

## The 60-second flow

1. **Capture.** Android share sheet → tiny Doubletake sheet (URL detected, optional note, mode chips) → done. Or DM the reel to your shadow Instagram account with a note. Or @mention that account under a post's comment: a top-level mention makes the comments the focus, a mention inside a reply thread makes *that thread* the focus. Or paste anything into the app's compose box.
2. **Understand.** The server downloads the media, transcribes the audio locally, OCRs the frames, describes key frames, and pulls the caption and comments. Everything scraped is wrapped and labelled as untrusted before an AI ever sees it.
3. **Research.** A pluggable "brain" (Claude Agent SDK by default; any headless CLI harness or OpenAI-compatible API also works) researches your question with web search and read access to your own files, in Quick, Standard, or Deep mode.
4. **Answer.** Push notification. Open the chat: answer, claim-by-claim verdicts with sources, cost of the run. Ask a follow-up (cheap) or tap **Research this** to escalate. Every finished chat is also exported as Markdown into a notes folder you can open in Obsidian.

## Why not an existing tool?

| | Doubletake | SaveToList | SuperBrain | Karakeep | Recall |
|---|---|---|---|---|---|
| Capture from IG share / DM | ✓ | ✓ (comment tag, iOS) | Android share | browser + share | share |
| Comment @mention capture, thread focus | ✓ (silent) | ✓ (public reply) | – | – | – |
| Reads reels: transcript + OCR + vision | ✓ local | partial | summary only | archive only | – |
| **Researches the claim** with web search | ✓ | – | – | – | grounded chat |
| Per-item chat with follow-ups | ✓ | – | – | – | ✓ |
| Uses **your local files** for context | ✓ | – | – | – | – |
| Self-hosted | ✓ | – | ✓ | ✓ | – |
| Pluggable AI backend | ✓ | – | ✓ | partial | – |

Doubletake also does what the capture bots do: every run extracts the place, recipe, product,
or tool in the post into categorised collections, even when you asked nothing.

## Documentation

- [Architecture](docs/ARCHITECTURE.md), the living design document
- [Architecture decision records](docs/adr/README.md)
- [Data model](docs/DATA-MODEL.md) · [Brain adapters](docs/BRAIN-ADAPTERS.md) · [Media pipeline](docs/MEDIA-PIPELINE.md) · [Research modes](docs/RESEARCH-MODES.md)
- Channels: [Instagram](docs/channels/instagram-setup.md) · [Android share sheet](docs/channels/android-share.md)
- [Security](docs/SECURITY.md) and [threat model](docs/THREAT-MODEL.md)
- [Deployment](docs/DEPLOYMENT.md) (macOS launchd, Linux systemd, Tailscale, tunnels)
- [Roadmap](docs/ROADMAP.md) · [Contributing](CONTRIBUTING.md)

## Quick start

```sh
git clone https://github.com/roowus/doubletake && cd doubletake
scripts/doctor.sh              # checks node 22, pnpm 10, uv, ffmpeg
cp .env.example .env           # set your brain credentials (ANTHROPIC_API_KEY or a logged-in `claude`)
pnpm install
pnpm --filter @doubletake/web build   # the server serves the built PWA at /
pnpm --filter @doubletake/server dev  # http://127.0.0.1:7391 — first visit sets the owner password
```

`pnpm dev` runs the server and the Vite dev server (hot reload on :5173) together.

Supported link types today: Instagram posts/reels, TikTok, YouTube videos and Shorts,
X/Twitter posts, Reddit threads, Gemini/ChatGPT/Claude share links, any web page, or plain
text. Adding a platform is one file; see [the media pipeline doc](docs/MEDIA-PIPELINE.md#adding-a-platform).

## Requirements

Apple Silicon Mac or a 12th-gen-or-newer Intel laptop with no GPU is the target; Linux and Windows are supported but tested less. Node 22, pnpm 10, Python 3.12 via uv, ffmpeg. Instagram capture needs a free Meta developer app and an Instagram Business/Creator account you control (see the [Instagram guide](docs/channels/instagram-setup.md)); the share sheet and compose box need nothing extra.

## License

[AGPL-3.0](LICENSE). If you run a modified Doubletake as a service for others, you must publish your changes.
