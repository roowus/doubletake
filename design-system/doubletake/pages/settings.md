# Settings (`/settings`, `/settings/<section>`; `pages/settings/*`)

Overrides [MASTER](../MASTER.md). Settings must feel like settings: a grouped list, one
section per page, values visible before you tap.

**Index** (`SettingsIndex.tsx`): a search field over row labels, then groups with a small caps
heading each and rows of label · current value or hint (muted, right-aligned) · chevron.
Groups and sections:

| Group | Section (`/settings/…`) | Contents |
|---|---|---|
| Account & devices | `devices` | This device, Pair a device (QR + code), Devices list with Revoke (Confirm) |
| Research | `research` | Brain adapters with health and model, default brain, daily cap and today's spend as stat rows, modes explained inline |
| Notifications | `notifications` | Push toggle (Switch) + Test, quiet hours, ntfy / Telegram status |
| Channels | `instagram` | Connect / status / check comment access / poll / Disconnect (Confirm) |
| Data | `data` | Import (Karakeep) and export (Memos), notes folder, backup hint |
| Appearance | `appearance` | Theme System / Paper / Ink, prose size S / M / L, reduce motion (all `localStorage`, applied as `data-*` on `<html>`) |
| About | `about` | Version, server URL, link to the docs |

**Rows** (`.srow`): 56 px min, label in the sans at 15 px, value in `--text-muted`, whole row
is the target; destructive rows in `--err` and always behind a Confirm dialog. Toggles are
Base UI Switch with the label as the click target. Section pages have a back link, the
section title and the same row style; stat rows (cap, spend) use mono numerals.

**Feedback.** Saving is immediate and confirmed with a toast; errors stay inline in a `Note`
with `role="alert"`.

**Do not.** Stack seven identical cards; put a form on the index; hide the current value
behind the chevron; use red for anything that is not destructive.
