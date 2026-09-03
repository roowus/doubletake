# Competitor landscape

Researched 2026-09-03 across 31 products (share-to-save bots, self-hosted bookmark managers,
reel summarisers, "second brain" apps). Condensed here; the point is to know what already
exists and where Doubletake is genuinely different.

## The closest analogues

| Product | What it is | How it captures | AI | Self-host | Traction / price |
|---|---|---|---|---|---|
| **SaveToList** (savetolist.com) | iOS app + Instagram comment bot `@save.to.list` that extracts posts into lists (places, recipes, products) | Tag the bot in a comment; it replies publicly and DMs you | Extraction into structured lists; no research, no chat | No | v1 May 2026; 4.0★ on ~10 App Store ratings; $2.99/week or $39.99/year |
| **SuperBrain** (GitHub, AGPL) | Android share → FastAPI → LLM (Groq / Gemini / OpenRouter / Ollama) → SQLite → push | Android share sheet | Summary + tags per item | Yes | ~451★; solo maintainer |
| **Karakeep** (ex-Hoarder, AGPL) | Self-hosted bookmark manager with archiving, yt-dlp video download, AI tags | Browser extension, mobile share, API | Tagging and summaries; no chat (feature discussion #709) | Yes | ~28.8k★; IG reels download broken (issue #1842) |
| **Recall** (getrecall.ai) | Cloud knowledge base with web-grounded chat over your saves | Share / extension | Summaries + chat across library | No | Paid SaaS; no reels support |
| **Remio**, **Curiosity** | Desktop "second brain" that indexes local files and browsing | Desktop capture | Local-file RAG chat | Partly (local app) | Niche; no mobile capture bots |
| **MyMind**, **Raindrop**, **Readwise Reader** | Premium bookmark/read-later with AI summaries | Share / extension | Summaries, highlights | No | Established; $8–12/month tier for AI |
| Reel summariser apps (a dozen: "ReelSummary", "Vidnote", …) | Paste a reel link, get a transcript + summary | Paste / share | Transcript + summary | No | Credit-metered, $5–15/month; churny |

## Verified gaps (nobody does these)
1. **Research the claim.** Every product summarises or files; none checks whether the reel's
   advice is true or compares the thing being praised with alternatives.
2. **Question at capture, answer asynchronously by push.** SaveToList comes closest with the
   comment bot but returns an extraction, not an answer to your question.
3. **Per-item chat with follow-ups grounded in the media and web.** Recall has library chat;
   nothing has "this reel, this question, keep asking".
4. **Reading the comment thread.** No product treats the discussion under a post as the
   object of analysis, let alone a specific reply thread.
5. **Local files as context.** Only Remio/Curiosity index local files and they have no
   capture bot; nothing combines "what I saw on my phone" with "what is on my laptop".
6. **Self-hosted + multimodal + agentic** is an empty intersection: Karakeep and SuperBrain
   are self-hosted but not agentic; Recall is agentic but cloud.

## Positioning for Doubletake
- Sell **the answer**, not the archive. The archive (Markdown export, FTS, tags) is a
  by-product.
- Headline: *research + your files*, with self-hosting as the trust story that makes reading
  your files acceptable.
- Own the **comment thread** as a first-class object (`focus`).
- Stay horizontal (any topic) with optional structured output templates per question type
  rather than vertical lists like SaveToList.
- Integrate rather than compete with Karakeep / Memos / Obsidian: Markdown export now, MCP
  server later.
- **Share sheet first**; the Instagram bot is an optional module and is documented as
  ToS-fragile (mention webhook availability under Standard Access is unverified).

## Pricing reference (for anyone who later hosts it for others)
Storage-only products charge $3–5/month; AI tiers $8–12/month; reel-specific apps meter by
credits. Doubletake's self-hosted cost is the owner's own model spend (daily cap in config).
