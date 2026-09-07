# Welcome / pairing (`pages/Welcome.tsx`)

Overrides [MASTER](../MASTER.md) for the first screen and for signed-out state.

**Job.** Say what Doubletake is in one line and get the person in with the right method for
their device.

**Layout.** Two columns from 900 px: brand statement on paper (the mark, the one-sentence
product line, three short "how it works" lines with icons) and the form; a single column on
phones with the statement compressed to the mark plus one line. Tabs on the form: **Pairing code**
(default on phones: scan the QR the desktop shows, or type the six-character code, with the
server address field when native) and **Password** (default on laptops). Primary button says
**Pair this device** or **Sign in**, never "Submit".

**States.** Wrong code or password: inline error under the field, input kept. Server
unreachable: a banner with the URL being tried and a Retry. Pairing success: toast and
navigate to Inbox with a view transition.

**Do not.** Show marketing copy longer than three lines; use a hero image; mention "AI".
