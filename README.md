# Bronze Pack Auto Opener (FC 27)

Tampermonkey userscript that automates the bronze pack method on the EA SPORTS FC 27 Ultimate Team web app.
By Kogilife.

## Install in Tampermonkey

1. Install the Tampermonkey extension for your browser (Chrome, Edge, Firefox, etc.).
2. **Chrome / Edge only:** go to `chrome://extensions` (or `edge://extensions`), open Tampermonkey's **Details**, and turn on **Allow User Scripts** (older versions: turn on **Developer mode** at the top right). Without this, no scripts run.
3. If you still have the old FC 26 script installed: click the Tampermonkey icon, **Dashboard**, and disable or delete "Bronze Pack Auto Opener" so the two don't both run.
4. Click the Tampermonkey icon, then **Create a new script...**
5. Delete everything in the editor, paste the full contents of `bronze-pack-auto-opener-fc27.user.js`, then press **Ctrl+S** (Cmd+S on Mac) to save.
6. Make sure the script is toggled **on** in the Dashboard.
7. Open (or refresh) the FC 27 web app. Press **F12**, go to the **Console** tab, and you should see:
   `Bronze Pack Auto Opener (FC 27) loaded. Press "-" to start, "=" to stop.`

## Use

1. In the web app go to **Store > Packs**, then select the **Classic Packs** tab.
2. Click **Start** on the panel in the bottom right, or press **`-`** (not while typing in a text box).
3. Click **Stop** or press **`=`** (or `+`) to stop. It stops after the current step finishes.
4. When it stops, a popup shows why and a summary: packs opened, coins spent, players stored, items redeemed, and which managers went to the transfer list.

The panel shows live progress, including profit. Set `SHOW_PANEL = false` in the script to hide it.

## Settings

Click **Settings** on the panel, change what you want, and click **Save**. Settings are saved in your browser, so pasting in a new version of the script does not reset them. **Reset to defaults** goes back to the values in the script.

| Setting | What it does |
| --- | --- |
| Pack name | Pack to open, as shown in the store (default "Large Bronze Pack") |
| Max packs | Stop after this many packs. `0` = no limit |
| Max minutes | Stop after this many minutes. `0` = no limit |
| Max coins to spend | Most coins spent on packs each run. Example: `15000` stops after 20 packs at 750 |
| Keep at least this many coins | Never buy a pack that would take your balance under this |
| Speed | Multiplies every pause. `1` = original, `2.5` = default, higher = slower |
| Manager countries to keep | Comma separated. Managers from these go to the transfer list instead of being quick sold. Spelling must match the game |

If you get "Couldn't read your coin balance", right-click your coin total at the top of the web app, choose **Inspect**, and add its class to `COIN_BALANCE_SELECTORS` in the script.

## Profit and history

- The summary after each run shows your coin balance at the start and end, and the profit. It does not count managers on your transfer list until they sell.
- Click **History** on the panel for all time totals (runs, packs, coins spent, profit) and a list of the valuable managers the bot has kept, with dates. **Clear history** resets it.

## Safety stops

The bot stops, instead of quick selling something valuable, when:
- a new player can't be sent to the club
- a coin card can't be redeemed
- a manager from your countries list can't go to the transfer list (usually because it is full at 100 items)

## Changelog

The version shows next to the panel title and in the console (F12) when the script loads.

### 2026.1.1
- Fixed: the bot stopped with "Quick sell didn't clear the unassigned items" even though the list was empty. The web app keeps a hidden copy of the old list after quick selling, and the bot was counting those hidden cards. It now only looks at cards that are actually on screen.
- Quick sell never uses a pack's buy button by mistake after the web app jumps back to the store.
- No extra back click when the web app has already returned to the store.
- If cards really are left after quick selling, the bot tries to redeem them, and the error names what's left.
- Version number shown on the panel.

### 2026.1.0
- First FC 27 release: opens Large Bronze Packs, stores new players in the club, sends managers from chosen countries to the transfer list, redeems coin cards and quick sells the rest.
- Panel with Start/Stop, live stats and profit, a Settings tab saved in the browser, and a History tab with all time totals and valuable managers.
- Coin limits, pack and time limits, speed setting, and safety stops so nothing valuable is quick sold.

## What changed from the FC 26 version

- `@match` now covers any language/region URL (`/en-au/`, `/en-gb/`, `/en-us/`, none at all, etc.), so it runs on the FC 27 web app wherever you open it.
- Removed `@downloadURL` / `@updateURL`. Those pointed at the old FC 26 Greasy Fork script, so Tampermonkey could auto-update over your version.
- Fixed retry loops that never counted up (they could spin forever if a button was missing).
- Stops with a clear message instead of silently failing when the bronze pack can't be found.
- Null checks before every click, and `-` / `=` no longer trigger while you type in a search or price box.
- Pressing stop is now respected inside the player, manager, misc and quick sell steps.

## If something doesn't work in FC 27

EA sometimes renames things between years. Open the console (F12) to see where the script stopped, then check the **SETTINGS** block at the top of the script:

| Setting | What to check |
| --- | --- |
| `CLASSIC_PACKS_TAB_NAME` | Exact text of the pack tab (e.g. "Classic Packs") |
| `BIO_COUNTRY_LABEL` | Label shown on a manager's bio for country |

If the pack can't be found, the error and the console (F12) list the pack names the script can see; set the right one in the panel's Settings.

If a whole CSS class was renamed (for example `.send-to-club`), right-click that button in the web app, choose **Inspect**, and update the matching selector in the script.

> Note: automating the web app is against EA's terms of service and can get your account restricted. Use at your own risk.
