# Add / Compose (`/compose`, also the `/share` target; `pages/Compose.tsx`)

Overrides [MASTER](../MASTER.md) for the capture moment.

**Job.** Get a link, text or file in with one thumb and leave. A full page on phones (not a
modal) so the keyboard, the mode control and the button never fight for space.

**Layout.** Big paste field (URL or text, auto-grows), note field (cursor here when a URL was
prefilled by the share target), **mode** as a segmented control (`components/ModeControl.tsx`:
Auto · Quick · Standard · Deep with a one-line hint under the selected one), **brain** via a
Base UI Menu showing each adapter's health, then a full-width primary **Research** button
pinned above the safe area. Cost hint in mono under the button when a cap is near.

**After send.** Navigate to the new chat with a view transition; the chat opens in its live
state. Offline (native wrappers) queues and toasts "Saved, will send when online".

**Errors.** Inline under the field that caused them (bad URL, cap reached, brain down), the
text preserved. Never a blocking dialog.

**Do not.** Ask for a title; show more than one hint at a time; open a modal on phones; use
chips for the mode (they wrap and look like tags).
