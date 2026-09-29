# Bronze Pack Auto Opener (FC 27)

Tampermonkey userscript that automates the bronze pack method on the EA SPORTS FC 27 Ultimate Team web app.
Ported from the FC 26 script by metaHC.

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
2. Click anywhere on the page (not in a text box) and press **`-`** to start.
3. Press **`=`** (or `+`) to stop. It stops after the current step finishes.

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
| `BRONZE_PACK_TITLE` | Exact pack name. Right-click the pack > **Inspect** and look for `data-title="..."` |
| `BIO_COUNTRY_LABEL` | Label shown on a manager's bio for country |
| `important_manager_countries` | Countries to send to the transfer list; spelling must match the game |

If a whole CSS class was renamed (for example `.send-to-club`), right-click that button in the web app, choose **Inspect**, and update the matching selector in the script.

> Note: automating the web app is against EA's terms of service and can get your account restricted. Use at your own risk.
