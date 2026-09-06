# Privacy policy

Doubletake is self-hosted software, published under the AGPL at
<https://github.com/roowus/doubletake>. There is no Doubletake service: every installation is
run by one person ("the owner") on hardware they control. This document describes what a
Doubletake installation stores and does with data, so an owner can point platforms (Meta, for
the Instagram channel) at it. The owner is the data controller for their own installation.

## What is stored

- **Shares.** URLs and text the owner sends in (share sheet, compose box, Instagram DM or
  comment mention), plus derived text: page text, captions, transcripts, OCR, frame
  descriptions, comments, and the brain's answer. Stored in a SQLite database and a media
  folder under the owner's data directory (`~/.doubletake` by default) and as Markdown notes
  in the owner's notes folder (`~/Doubletake` by default).
- **Instagram data**, only when the owner connects their own Instagram professional account:
  the account's user id and username, an access token (encrypted at rest, see
  [SECURITY.md](SECURITY.md)), and the webhook events the owner's account receives (DM shares
  sent to it, comments that @mention it). Media referenced by a DM is downloaded once to the
  media folder. Nothing is posted publicly; the only outbound action is a reaction on the DM
  that was processed.
- **Device tokens** for the owner's paired phones and browsers, and push-notification
  subscriptions (Web Push endpoints or Firebase Cloud Messaging tokens) if the owner enables
  notifications.

## Who receives data

- **The brain the owner configured.** Extracted text is sent to the model provider the owner
  chose (for example Anthropic via the Claude Agent SDK, or an OpenAI-compatible endpoint) to
  produce the answer. Which provider, and under which key or subscription, is the owner's
  choice; see [BRAIN-ADAPTERS.md](BRAIN-ADAPTERS.md).
- **Push relays.** Notification title and body ("Answer ready") go through Web Push or FCM.
  Answer text is never included.
- **Nobody else.** Doubletake has no analytics, no telemetry, and no hosted component. The
  project maintainers never receive any data from an installation.

## Retention and deletion

Data stays until the owner deletes it. Deleting a chat in the app removes the item, its
extractions, media and the exported note. Disconnecting Instagram in Settings deletes the
stored token and stops webhook processing; Instagram event rows can be removed with the
database tools described in [DEPLOYMENT.md](DEPLOYMENT.md). Deleting the data directory
removes everything.

## Data deletion requests (Instagram)

A Doubletake installation only ever holds data about its owner's own Instagram account and the
messages that account received. If you sent a message to a Doubletake-connected account and
want it removed, contact the account's owner; they can delete the chat from their library. For
installations run by the project author, open an issue at
<https://github.com/roowus/doubletake/issues> or email the address on the GitHub profile, and
the data will be deleted within 30 days.

## Changes

This document lives in the repository; its history is the change log.

_Last updated 2026-09-06._
