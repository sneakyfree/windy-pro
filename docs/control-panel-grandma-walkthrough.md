# Control Panel — grandma walk-through script

The acceptance test for the WD-31 Phase 3 launch. Run this as if you've never
seen Windy Word before. Every step should "just work" — no terminal, no
JWT paste, no commit/branch/PR mention. If you see any of those words on
screen, that's a friction point to log.

## Pre-flight

You need:
- A fresh checkout of `sneakyfree/windy-pro` at the commit you're testing
- A built or dev Windy Word app (`npm install && npm run dev`)
- Internet access (the registry lives at `api.windydrops.com`)

Do NOT need: any Windy account, any JWT, any registry credentials, or
any developer tools.

## The walk

### 1. Open the Control Panel

- Launch Windy Word.
- Look for a pulsing **🖥️ Panel** tile (M-H polish, PR #161).
- Click it.

**Expected:** A new window opens. It says **"Echo HQ — updating every 1s"**
in the status bar.

**Failure modes to log:**
- Tile isn't pulsing
- Tile doesn't open anything
- Status bar says anything that includes "IPC", "bridge", "schema",
  "passport", "JWT", or any URL

### 2. See the dashboard render

- Wait one second.
- The window should fill with a cyberpunk vitals dashboard showing your
  machine's hostname, CPU/RAM/disk gauges, and fleet grid.

**Expected:** Real data about THIS computer. CPU% changes per refresh.

**Failure modes:**
- Dashboard never appears
- Numbers all show as "—" or "null" (collector broken)
- "this_machine" is missing from the fleet grid

### 3. Open the drop selector

- In the top bar, click **🖥️ Echo HQ ▾** (the dropdown button).
- A menu should drop down showing **Echo HQ** with a green "built-in"
  badge and a ✓ checkmark.

**Expected:** Menu is readable. No technical terms beyond "built-in".

**Failure modes:**
- Menu doesn't open / doesn't close on outside click
- Item shows `windy-echo-hq` instead of `Echo HQ`
- "built-in" is the only word but it's followed by a path / version
  / commit hash

### 4. Browse more drops

- Close the dropdown (click elsewhere).
- Click **+ Get more drops** in the top right.
- The marketplace overlay should slide in showing a card grid.

**Expected:** Cards for at least 2 drops: **Echo HQ** (with "Built-in"
badge, no install button) and **Glance** (with "+ Install" button).

**Failure modes:**
- Spinner never resolves
- "⚠️ The marketplace isn't available right now" — network or registry issue
- Cards show jargon: schema strings, version constraints, technical
  descriptions
- Echo HQ shows an Install button (would re-install built-in — bug)

### 5. Install a drop

- Click **+ Install** on the Glance card.
- Button changes to **⏳ Installing…**, then to **Installed** badge.

**Expected:** Card flips to the badge within ~1s. Dropdown menu (still
closed) now contains Glance under "installed".

**Failure modes:**
- "⚠️ Couldn't install Glance" with no follow-up — registry unreachable
  or bundle URL wrong
- Button stays on "⏳ Installing…" forever — IPC handler crashed silently
- Install appears to succeed but Glance doesn't show in the dropdown

### 6. Switch to the new drop

- Click **← Back** (top-left of the marketplace).
- Click the top-bar drop selector.
- The menu should now have TWO entries: Echo HQ (built-in, ✓ selected)
  + Glance (installed, no ✓).
- Click **Glance**.

**Expected:**
- Menu closes immediately.
- Status bar flashes **⏳ Switching to Glance…** then **✓ Glance —
  updating every 1s**.
- The dashboard area shows Glance's calm minimal layout (4 big stat
  tiles, status line like "All quiet" / "Working hard" / "Computer's hot").
- Topbar drop name updates to **Glance ▾**.

**Failure modes:**
- Status says "Switching to windy-glance…" (drop ID, not name) — REGRESSION
  from PR #167 polish
- Iframe never replaces — old Echo HQ keeps showing
- Glance renders but text is unreadable (CSS conflict between Echo HQ
  dark cyberpunk and Glance light theme)
- Tile values show "NaN%" or are misaligned

### 7. Switch back

- Click **Glance ▾**, pick **Echo HQ**.
- Echo HQ should re-render (cyberpunk dashboard).

**Expected:** Same swap behavior in reverse. Status bar reflects the
change.

### 8. Close the window

- Close the Control Panel window (red X / Cmd-W).
- Re-open via the **🖥️ Panel** tile.
- Whichever drop you last selected should be the one that loads.

**Expected:** Selection persists across window opens (library.json
saves to userData).

## The grandma test

Walk through steps 1-8 narrating each click out loud as you would to
your grandmother on a phone call. Listen for moments where you'd say
something jargon-y like "click the IPC bridge…" or "open the GitHub
URL…". Those are the friction points that need fixing before launch.

## Logging friction

When you find friction, log it as `docs/control-panel-friction-log.md`
with the step number, what happened, and a screenshot if visual.
