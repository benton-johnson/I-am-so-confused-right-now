// ==UserScript==
// @name         Bronze Pack Auto Opener (FC 27)
// @namespace    http://tampermonkey.net/
// @version      2026.1.2
// @description  Automate bronze pack method opening on the FC 27 web app
// @author       Kogilife
// @match        https://www.ea.com/*/ea-sports-fc/ultimate-team/web-app/*
// @match        https://www.ea.com/ea-sports-fc/ultimate-team/web-app/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=ea.com
// @grant        none
// ==/UserScript==

// NOTE: the original @downloadURL / @updateURL lines were removed on purpose.
// If they stay in, Tampermonkey can "update" this script back to the old
// FC 26 version from Greasy Fork and wipe out your changes.

(function() {
    'use strict';

    // ------------------------------------------------------------------
    // SETTINGS: if EA renames something in FC 27, fix it here first.
    // ------------------------------------------------------------------
    // version from the @version line above (Tampermonkey provides GM_info)
    const SCRIPT_VERSION = typeof GM_info !== 'undefined' ? GM_info.script.version : '';

    const CLASSIC_PACKS_TAB_NAME = "Classic Packs";
    const BIO_COUNTRY_LABEL = "Country/Region";

    // DEFAULT SETTINGS. You can change all of these in the panel's Settings tab
    // instead; what you save there is kept in your browser and survives script updates.
    const DEFAULT_SETTINGS = {
        BRONZE_PACK_TITLE: "Large Bronze Pack",
        // coin limits (0 = no limit)
        MAX_COINS_TO_SPEND: 0,       // most coins to spend on packs each time you press "-"
        STOP_WHEN_COINS_BELOW: 0,    // never buy a pack if it would take your balance below this
        // run limits (0 = no limit)
        MAX_PACKS: 0,                // stop after opening this many packs
        MAX_MINUTES: 0,              // stop after running this many minutes
        // speed: every wait is multiplied by this. 1 = original, 2 = half speed.
        DELAY_MULTIPLIER: 2.5,
        // managers from these countries are expensive, so they go to the transfer list
        // instead of being quick sold. Spelling must match the game exactly.
        important_manager_countries: ["Georgia", "Malawi", "Ivory Coast", "Cameroon", "Nigeria", "France", "Egypt", "Portugal"],
    };

    // where the web app shows your coin balance (first one found is used)
    const COIN_BALANCE_SELECTORS = ['.view-navbar-currency-coins', '.view-navbar-currency .coins', '.ut-navbar-currency-coins'];

    // show the status panel with Start / Stop buttons in the bottom right
    const SHOW_PANEL = true;

    const MAX_RETRIES = 300;
    const DEFAULT_FAST_DELAY = 10;
    const DEFAULT_LONG_DELAY = 300;
    const SPINNER_TIMEOUT = 10000;

    // ------------------------------------------------------------------
    // saved data (kept in this browser only)
    // ------------------------------------------------------------------
    const STORAGE_SETTINGS = 'bpao-settings';
    const STORAGE_HISTORY = 'bpao-history';
    const STORAGE_TOTALS = 'bpao-totals';

    function load_json(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (err) {
            return fallback;
        }
    }

    function save_json(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (err) {
            console.warn('Could not save ' + key, err);
        }
    }

    let settings = Object.assign({}, DEFAULT_SETTINGS, load_json(STORAGE_SETTINGS, {}));

    // global selectors
    const unassigned_section = '.ut-unassigned-view .entityContainer';
    const selected_tab_selector = '.ea-filter-bar-item-view.selected';
    const message_dialog_selector = '.ea-dialog-view.ea-dialog-view-type--message';

    let counter = 0;
    let isRunning = false;
    let coinsSpent = 0;
    let stats = new_stats();
    let status = 'Idle';

    function new_stats() {
        return { packs: 0, players: 0, redeemed: 0, managers: [], startTime: Date.now(), started: false, startBalance: null };
    }

    // for "is it done yet?" checks: always real time, not slowed by the speed setting
    function poll(ms) {
        return new Promise(res => setTimeout(res, ms));
    }

    function delay(ms) {
        return new Promise(res => setTimeout(res, ms * settings.DELAY_MULTIPLIER));
    }

    function text(el) {
        return el ? el.textContent.trim() : '';
    }

    // true if the element is actually on screen (the web app can leave hidden copies of old pages around)
    function is_visible(el) {
        return !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    }

    // cards in the unassigned list that are really showing
    function visible_all(selector) {
        return Array.from(document.querySelectorAll(selector)).filter(is_visible);
    }

    function waitForElement(selector, interval = 100, timeout = 15000) {
        return new Promise((resolve, reject) => {
            const start = Date.now();
            const timer = setInterval(() => {
                const el = document.querySelector(selector);
                if (el) {
                    clearInterval(timer);
                    resolve(el);
                } else if (Date.now() - start > timeout) {
                    clearInterval(timer);
                    reject(new Error(`Timeout waiting for element: ${selector}`));
                }
            }, interval);
        });
    }

    async function waitForSpinner() {
        const start = Date.now();
        while (document.querySelector('.ut-click-shield.showing')) {
            if (Date.now() - start > SPINNER_TIMEOUT) {
                console.warn('Spinner timeout');
                return false;
            }
            await poll(200);
        }
        return true;
    }

    function simulateFullClick(element) {
        if (!element) {
            console.warn('simulateFullClick: element not found, skipping click');
            return false;
        }
        ['mousedown', 'mouseup', 'click'].forEach(eventType => {
            element.dispatchEvent(new MouseEvent(eventType, {
                bubbles: true,
                cancelable: true,
                view: window
            }));
        });
        return true;
    }

    async function select_classic_packs() {
        const menu_bar = document.querySelectorAll('.ea-filter-bar-item-view');

        counter = 0;
        for (const menu_tab of menu_bar) {
            if (text(menu_tab) == CLASSIC_PACKS_TAB_NAME) {
                while (text(document.querySelector(selected_tab_selector)) != CLASSIC_PACKS_TAB_NAME && counter < MAX_RETRIES) {
                    simulateFullClick(menu_tab);
                    await delay(DEFAULT_FAST_DELAY);
                    counter++;
                }
                if (text(document.querySelector(selected_tab_selector)) != CLASSIC_PACKS_TAB_NAME) {
                    console.log("failed to enter classic packs");
                    return false;
                }
                return true;
            }
        }
        console.log("Classic Packs tab not found");
        return false;
    }


    function same_name(a, b) {
        return (a || '').replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function find_coin_button(root) {
        return root.querySelector('button.currency.coins.primary') ||
               root.querySelector('button.currency.coins') ||
               root.querySelector('button.coins');
    }

    // prefer the tradeable version of the pack if both exist
    // prefer packs actually on screen, then the tradeable version
    function pick_pack(packs) {
        const shown = packs.filter(is_visible);
        if (shown.length) packs = shown;
        return packs.find(p => p.classList.contains('is-tradeable')) || packs[0] || null;
    }

    function find_bronze_pack() {
        // 1. pack element tagged with the name (how FC 26 did it)
        const by_attribute = Array.from(document.querySelectorAll('[data-title]'))
            .filter(el => same_name(el.getAttribute('data-title'), settings.BRONZE_PACK_TITLE));
        if (by_attribute.length) return pick_pack(by_attribute);

        // 2. fall back to the name shown on screen: find the text, then walk up to the
        //    nearest box that also holds a coin buy button
        const found = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
            if (!same_name(walker.currentNode.textContent, settings.BRONZE_PACK_TITLE)) continue;
            let el = walker.currentNode.parentElement;
            while (el && el !== document.body && !find_coin_button(el)) {
                el = el.parentElement;
            }
            if (el && el !== document.body && !found.includes(el)) found.push(el);
        }
        return pick_pack(found);
    }

    // logs every pack name the script can see, to help fix the pack name setting
    function log_visible_packs() {
        const titles = Array.from(document.querySelectorAll('[data-title]'))
            .map(el => el.getAttribute('data-title'));
        const cards = Array.from(document.querySelectorAll('.ut-store-pack-details-view, [class*="pack-details"], [class*="store-pack"]'))
            .map(el => el.className + ' | ' + text(el).slice(0, 80));
        console.log('Pack names found (data-title):', titles);
        console.log('Pack boxes found:', cards);
        return titles;
    }

    function parse_coins(str) {
        const digits = (str || '').replace(/[^0-9]/g, '');
        return digits ? parseInt(digits, 10) : null;
    }

    function read_coin_balance() {
        for (const selector of COIN_BALANCE_SELECTORS) {
            const coins = parse_coins(text(document.querySelector(selector)));
            if (coins != null) return coins;
        }
        return null;
    }

    // throws (which stops the bot) if buying one more pack would break a coin limit
    function check_coin_limits(price) {
        if (!settings.MAX_COINS_TO_SPEND && !settings.STOP_WHEN_COINS_BELOW) return;

        if (price == null) {
            throw new Error("Couldn't read the pack price, so I can't check your coin limits.");
        }
        if (settings.MAX_COINS_TO_SPEND && coinsSpent + price > settings.MAX_COINS_TO_SPEND) {
            throw new Error(`Coin limit reached: spent ${coinsSpent.toLocaleString()} of ${settings.MAX_COINS_TO_SPEND.toLocaleString()} coins. Another pack costs ${price.toLocaleString()}.`);
        }
        if (settings.STOP_WHEN_COINS_BELOW) {
            const balance = read_coin_balance();
            if (balance == null) {
                throw new Error("Couldn't read your coin balance. Check COIN_BALANCE_SELECTORS at the top of the script.");
            }
            if (balance - price < settings.STOP_WHEN_COINS_BELOW) {
                throw new Error(`Stopped to keep at least ${settings.STOP_WHEN_COINS_BELOW.toLocaleString()} coins. Balance is ${balance.toLocaleString()} and a pack costs ${price.toLocaleString()}.`);
            }
        }
    }

    async function locate_and_open_bronze_pack() {
        const bronze_pack = find_bronze_pack();
        if (!bronze_pack) {
            const titles = log_visible_packs();
            const hint = titles.length ? ` Packs I can see: ${titles.join(', ')}.` : ' Scroll down so the pack is on screen, then try again.';
            throw new Error(`Could not find "${settings.BRONZE_PACK_TITLE}".${hint} See the console (F12) for details.`);
        }
        const open_button = find_coin_button(bronze_pack);
        if (!open_button) {
            throw new Error('Could not find the coin buy button on the bronze pack');
        }

        const price = parse_coins(text(open_button));
        check_coin_limits(price);

        // click once, then wait for the confirm popup (click again only if it never shows)
        for (let tries = 0; tries < 5 && document.querySelector(message_dialog_selector) == null; tries++) {
            simulateFullClick(open_button);
            for (let waited = 0; waited < 1500 && document.querySelector(message_dialog_selector) == null; waited += 100) {
                await poll(100);
            }
        }
        if (document.querySelector(message_dialog_selector) == null) {
            console.warn('Buy confirmation popup did not show up');
        }

        // click ok
        counter = 0;
        while (document.querySelector(message_dialog_selector + ' .btn-standard.primary') && counter < MAX_RETRIES) {
            simulateFullClick(document.querySelector(message_dialog_selector + ' .btn-standard.primary'));
            await delay(DEFAULT_FAST_DELAY);
            counter++;
        }

        if (price != null) {
            coinsSpent += price;
            const budget = settings.MAX_COINS_TO_SPEND ? ` of ${settings.MAX_COINS_TO_SPEND.toLocaleString()}` : '';
            console.log(`Coins spent this run: ${coinsSpent.toLocaleString()}${budget}`);
        }
    }

    // players still waiting in unassigned that are NOT already in the club
    // a card that is already in your club. FC 26 used "club-duplicated"; to be safe,
    // anything marked with "dup" (duplicate, dupe, ...) on the card counts too.
    // Sending a duplicate to the club crashes the web app, so this must never miss one.
    function is_duplicate(container) {
        const row = container.closest('.listFUTItem') || container;
        return /dup/i.test(container.className) ||
               /dup/i.test(row.className) ||
               !!row.querySelector('[class*="dup" i]');
    }

    function non_duplicate_players(skip) {
        return visible_all(unassigned_section + ' .player').filter(p => {
            const container = p.closest('.entityContainer');
            return container && !is_duplicate(container) && !skip.has(container);
        });
    }

    function is_disabled(btn) {
        return btn.disabled ||
               btn.getAttribute('aria-disabled') === 'true' ||
               /disabled/i.test(btn.className) ||
               !!btn.closest('[class*="disabled" i]');
    }

    function find_send_to_club_button() {
        return visible_all('.send-to-club').find(btn => !is_disabled(btn)) || null;
    }

    // logs how each unassigned card is labelled, to help track down problems
    function log_unassigned_cards() {
        const rows = visible_all(unassigned_section).map(c => {
            const row = c.closest('.listFUTItem') || c;
            const kind = c.querySelector('.player') ? 'player' : c.querySelector('.manager, .staff') ? 'manager' : 'item';
            return `${kind}${is_duplicate(c) ? ' (duplicate)' : ''}: ${row.className} | ${c.className}`;
        });
        console.log('Unassigned cards:\n' + rows.join('\n'));
    }

    async function send_non_duplicate_bronze_player_to_club() {
        // cards that refused to go to the club, so we don't get stuck on them
        const skip = new Set();
        let processedCount = 0;

        for (let round = 0; round < 40 && isRunning; round++) {
            const players = non_duplicate_players(skip);
            if (players.length === 0) {
                console.log('No more non duplicate players');
                break;
            }

            const player = players[0];
            const container = player.closest('.entityContainer');
            const playerName = text(container.querySelector('.name')) || 'player ' + (processedCount + 1);
            const countBefore = players.length;

            // select the card, then wait for its Send to Club button
            let store_btn = null;
            for (let tries = 0; tries < 5 && !store_btn; tries++) {
                simulateFullClick(player);
                await poll(300); // let the card details switch over first
                for (let waited = 0; waited < 1000 && !store_btn; waited += 100) {
                    await poll(100);
                    store_btn = find_send_to_club_button();
                }
            }
            await delay(DEFAULT_FAST_DELAY * 10); // short pause before clicking
            if (!store_btn) {
                console.log('No Send to Club button for ' + playerName + ', skipping it');
                skip.add(container);
                continue;
            }

            simulateFullClick(store_btn);
            await waitForSpinner();

            // wait until the card actually leaves the unassigned list
            let stored = false;
            for (let waited = 0; waited < 3000; waited += 100) {
                if (!document.contains(container) || non_duplicate_players(skip).length < countBefore) {
                    stored = true;
                    break;
                }
                await poll(100);
            }

            if (stored) {
                processedCount++;
                console.log('Stored in club: ' + playerName);
            } else {
                console.log('Card did not leave the list, skipping it: ' + playerName);
                skip.add(container);
            }
            await delay(DEFAULT_LONG_DELAY); // let the list re-render
        }

        stats.players += processedCount;
        update_panel();
        console.log(`Stored ${processedCount} players in the club`);
    }

    async function check_manager_country() {
        await delay(DEFAULT_FAST_DELAY);
        const bioRows = document.querySelectorAll('.ut-item-bio-row-view');

        for (const row of bioRows) {
            const label = row.querySelector('h1');
            if (label && label.textContent.trim() === BIO_COUNTRY_LABEL) {
                return text(row.querySelector('h2'));
            }
        }
        return null;
    }

    function unassigned_managers() {
        return visible_all(unassigned_section + ' .small.manager.staff');
    }

    async function send_important_managers_to_transfer_list() {
        await delay(DEFAULT_LONG_DELAY * 2);
        console.log('manager list length: ' + unassigned_managers().length);
        if (unassigned_managers().length == 0) return;

        await waitForElement('.listFUTItem');
        // managers we keep (not important) stay in the list, so walk it by position
        let index = 0;
        for (let round = 0; round < 20 && isRunning; round++) {
            const managers = unassigned_managers();
            if (index >= managers.length) break;
            const manager = managers[index];

            simulateFullClick(manager);
            console.log('clicking manager');
            await delay(DEFAULT_LONG_DELAY);
            simulateFullClick(document.querySelector('.more'));

            let country = await check_manager_country();
            console.log('manager country: ' + country);
            let back_button = document.querySelectorAll('.ut-navigation-button-control')[1]; // hard coded back button.. might error if failed
            simulateFullClick(back_button);
            await delay(DEFAULT_LONG_DELAY);

            if (country == null || !settings.important_manager_countries.includes(country)) {
                index++;
                continue;
            }

            const manager_name = text(manager.closest('.entityContainer')?.querySelector('.name'));
            const countBefore = unassigned_managers().length;
            const send_button = document.querySelector('.send-to-transfer-list');
            if (!send_button || send_button.disabled || send_button.classList.contains('disabled')) {
                throw new Error(`Found a ${country} manager but can't send it to the transfer list (it may be full). Make room, then press "-" again.`);
            }
            simulateFullClick(send_button);
            await waitForSpinner();

            // make sure it actually left, otherwise quick sell would sell it
            let sent = false;
            for (let waited = 0; waited < 3000; waited += 100) {
                if (unassigned_managers().length < countBefore) {
                    sent = true;
                    break;
                }
                await poll(100);
            }
            if (!sent) {
                throw new Error(`A ${country} manager didn't go to the transfer list (it may be full, max 100). I stopped so it doesn't get quick sold. Make room, then press "-" again.`);
            }
            stats.managers.push(country);
            add_to_history(country, manager_name);
            update_panel();
            console.log('Sent ' + country + ' manager to the transfer list');
            await delay(DEFAULT_LONG_DELAY);
        }
    }

    // the Redeem button for whatever item is selected (coins, packs, etc.)
    function find_redeem_button() {
        const by_class = document.querySelector('.redeem-item');
        if (by_class && !by_class.disabled) return by_class;
        return Array.from(document.querySelectorAll('button'))
            .find(b => /^redeem/i.test(text(b)) && !b.disabled && b.offsetParent !== null) || null;
    }

    // coin cards and other misc items still in unassigned (not players, managers or consumables)
    function redeemable_items() {
        return visible_all(unassigned_section).filter(c =>
            !c.querySelector('.player') &&
            !c.querySelector('.manager, .staff') &&
            (c.querySelector('.misc') || /coin/i.test(text(c))));
    }

    // clicks OK on a popup if one opened (e.g. a redeem confirmation)
    async function confirm_popup() {
        const ok = document.querySelector(message_dialog_selector + ' .btn-standard.primary');
        if (ok) {
            simulateFullClick(ok);
            await waitForSpinner();
            await delay(DEFAULT_LONG_DELAY);
        }
    }

    // redeems every item from get_items() that has a Redeem button, returns how many
    async function redeem_from(get_items) {
        let redeemed = 0;
        // items without a Redeem button stay in the list, so walk it by position
        let index = 0;

        for (let round = 0; round < 20 && isRunning; round++) {
            const items = get_items();
            if (index >= items.length) break;

            const item = items[index];
            const countBefore = items.length;

            simulateFullClick(item.querySelector('.misc') || item.firstElementChild || item);
            let redeem_button = null;
            for (let waited = 0; waited < 1500 && !redeem_button; waited += 100) {
                await poll(100);
                redeem_button = find_redeem_button();
            }
            if (!redeem_button) {
                index++; // not redeemable, quick sell handles it
                continue;
            }

            console.log('redeem_misc_items: redeeming an item');
            simulateFullClick(redeem_button);
            await waitForSpinner(); // wait for server roundtrip
            await delay(DEFAULT_LONG_DELAY);
            await confirm_popup();

            const errorDialog = document.querySelector('.ea-dialog-view.ea-dialog-view-type--error');
            if (errorDialog) {
                throw new Error('Redeeming an item failed: ' + text(errorDialog).slice(0, 150));
            }

            // wait until the item actually leaves the list
            let gone = false;
            for (let waited = 0; waited < 3000; waited += 100) {
                if (get_items().length < countBefore) {
                    gone = true;
                    break;
                }
                await poll(100);
            }
            if (gone) {
                redeemed++;
                stats.redeemed++;
                update_panel();
            } else {
                index++;
            }
            await delay(DEFAULT_LONG_DELAY);
        }
        return redeemed;
    }

    // coin cards can't be quick sold or discarded, only redeemed, so redeem
    // everything that has a Redeem button before quick selling
    async function redeem_misc_items() {
        console.log('redeem_misc_items: start');
        try {
            await waitForElement('.listFUTItem'); // wait for list
        } catch (err) {
            console.log('redeem_misc_items: no list found, skipping');
            return;
        }
        await delay(DEFAULT_LONG_DELAY); // small buffer

        const redeemed = await redeem_from(redeemable_items);

        // a coin card that is still here would make quick sell fail
        const stuck = redeemable_items().filter(c => /coin/i.test(c.className + ' ' + text(c)));
        if (stuck.length) {
            throw new Error("A coin card couldn't be redeemed, so I stopped before quick selling. Redeem it by hand, then press \"-\" again.");
        }

        console.log(`redeem_misc_items: redeemed ${redeemed} item(s)`);
    }



    async function sort_players() {
        counter = 0;
        let items = visible_all(unassigned_section);
        while (items.length == 0 && counter < MAX_RETRIES) {
            items = visible_all(unassigned_section);
            await delay(DEFAULT_FAST_DELAY);
            counter++;
        }

        log_unassigned_cards();
        await send_non_duplicate_bronze_player_to_club();

        // one more pass in case the list was slow to update
        if (isRunning && non_duplicate_players(new Set()).length > 0) {
            console.log('Non duplicate players left over, trying once more');
            await delay(DEFAULT_LONG_DELAY * 2);
            await send_non_duplicate_bronze_player_to_club();
        }

        // never quick sell players you don't own yet: stop instead
        if (isRunning && non_duplicate_players(new Set()).length > 0) {
            throw new Error('Some new players could not be sent to the club, so I stopped before quick selling them. Store them by hand, then press "-" again.');
        }

        if (!isRunning) return;
        console.log('entering manager');
        await send_important_managers_to_transfer_list();
        console.log('exiting manager');

        if (!isRunning) return;
        await redeem_misc_items();
    }

    function unassigned_left() {
        return visible_all(unassigned_section);
    }

    // short description of the cards still in unassigned, for error messages
    function describe_left() {
        const names = unassigned_left().slice(0, 5).map(c => text(c).replace(/\s+/g, ' ').slice(0, 40) || '(no text)');
        return names.join('; ') + (unassigned_left().length > 5 ? '; ...' : '');
    }

    function find_quick_sell_button() {
        return visible_all('.currency.primary.coins')
            .find(b => !b.closest('.ut-store-pack-details-view, [data-title]')) || null;
    }

    async function quick_sell() {
        console.log('inside quick sell');
        await delay(DEFAULT_LONG_DELAY * 2);

        for (let tries = 0; tries < 3 && unassigned_left().length && isRunning; tries++) {
            let quick_sell_button = null;
            for (let waited = 0; waited < 3000 && !quick_sell_button; waited += 100) {
                quick_sell_button = find_quick_sell_button();
                if (!quick_sell_button) await poll(100);
            }
            if (!quick_sell_button) {
                // e.g. only a coin card is left, so there is nothing to quick sell
                console.log('No quick sell button, trying to redeem what is left');
                if (await redeem_from(unassigned_left)) continue;
                break;
            }

            simulateFullClick(quick_sell_button);
            await delay(DEFAULT_LONG_DELAY * 2);
            simulateFullClick(document.querySelector('.ut-st-button-group .btn-standard.primary'));
            await waitForSpinner();

            // e.g. an item that can't be quick sold: close the popup and stop
            const errorDialog = document.querySelector('.ea-dialog-view.ea-dialog-view-type--error');
            if (errorDialog) {
                const message = text(errorDialog).slice(0, 150);
                simulateFullClick(errorDialog.querySelector('.btn-standard'));
                throw new Error('Quick sell failed: ' + message);
            }

            // give the list time to update
            for (let waited = 0; waited < 5000 && unassigned_left().length; waited += 100) {
                await poll(100);
            }

            // something quick sell skipped, usually a coin card: redeem it, then try again
            if (unassigned_left().length && isRunning) {
                console.log('Left after quick sell: ' + describe_left());
                await redeem_from(unassigned_left);
            }
            await delay(DEFAULT_LONG_DELAY);
        }
        if (unassigned_left().length && isRunning) {
            throw new Error(`Quick sell didn't clear the unassigned items. Left: ${describe_left()}. Clear them by hand, then press "-" again.`);
        }
    }


    async function mainLoop() {
        // ensure we are in packs -> classic packs
        console.log("running = true, checking classic pack");
        let menu_bar = document.querySelector(selected_tab_selector);
        if (!menu_bar) {
            alert("Please click into My Packs.");
            isRunning = false;
            return false;
        }

        if (text(menu_bar) != CLASSIC_PACKS_TAB_NAME) {
            alert(`Not inside ${CLASSIC_PACKS_TAB_NAME}. Please navigate to ${CLASSIC_PACKS_TAB_NAME} first.`);
            isRunning = false;
            return false;
        }

        stats.started = true;
        while (isRunning) {
            if (settings.MAX_PACKS && stats.packs >= settings.MAX_PACKS) {
                return `Pack limit reached (${settings.MAX_PACKS} packs).`;
            }
            if (settings.MAX_MINUTES && Date.now() - stats.startTime >= settings.MAX_MINUTES * 60000) {
                return `Time limit reached (${settings.MAX_MINUTES} minutes).`;
            }

            if (!(await select_classic_packs())) {
                throw new Error(`Couldn't get back to ${CLASSIC_PACKS_TAB_NAME} after pack ${stats.packs}. Go to Store > Packs > ${CLASSIC_PACKS_TAB_NAME} and press "-" again.`);
            }

            if (!isRunning) break;
            set_status('Opening pack ' + (stats.packs + 1));
            await locate_and_open_bronze_pack();
            stats.packs++;
            update_panel();

            if (!isRunning) break;
            set_status('Sorting players, managers and items');
            await sort_players();

            if (!isRunning) break;
            set_status('Quick selling the rest');
            await quick_sell();

            if (!isRunning) break;
            set_status('Going back to the packs');
            // the web app sometimes returns to the store by itself after quick selling
            if (!is_visible(find_bronze_pack())) {
                simulateFullClick(visible_all('.ut-navigation-button-control')[0]);
            }
            await waitForSpinner();
            await delay(DEFAULT_LONG_DELAY);
        }
        return 'Stopped by you.';
    }

    async function startAutomation() {
        if (isRunning) return;
        isRunning = true;
        coinsSpent = 0;
        stats = new_stats();
        stats.startBalance = read_coin_balance();
        set_status('Running');
        console.log('Bronze Pack Auto Opener started');
        let reason = '';
        try {
            reason = await mainLoop();
        } catch (err) {
            console.error('Bronze Pack Auto Opener error:', err);
            reason = err.message;
        } finally {
            // always reset so pressing "-" works again
            isRunning = false;
            set_status('Stopped');
            console.log('Bronze Pack Auto Opener stopped');
        }
        if (stats.started) {
            await delay(DEFAULT_LONG_DELAY); // let the balance catch up after the last quick sell
            const profit = current_profit();
            add_to_totals(profit);
            const summary = run_summary(profit);
            console.log(summary);
            update_panel();
            alert('Bronze Pack Auto Opener stopped: ' + reason + '\n\n' + summary);
        }
    }

    function format_coins(n) {
        return (n > 0 ? '+' : '') + n.toLocaleString();
    }

    // coins now minus coins at the start of the run, or null if the balance can't be read
    function current_profit() {
        const now = read_coin_balance();
        return stats.startBalance == null || now == null ? null : now - stats.startBalance;
    }

    function run_summary(profit) {
        const minutes = Math.round((Date.now() - stats.startTime) / 60000);
        const managers = stats.managers.length
            ? `${stats.managers.length} (${stats.managers.join(', ')})`
            : '0';
        const profitLine = profit == null
            ? "Profit: couldn't read your coin balance"
            : `Profit: ${format_coins(profit)} coins (${stats.startBalance.toLocaleString()} to ${(stats.startBalance + profit).toLocaleString()})`;
        const lines = [
            `Packs opened: ${stats.packs}`,
            `Coins spent on packs: ${coinsSpent.toLocaleString()}`,
            profitLine,
            `Players stored in club: ${stats.players}`,
            `Items redeemed: ${stats.redeemed}`,
            `Managers sent to transfer list: ${managers}`,
            `Time: ${minutes} min`,
        ];
        if (stats.managers.length) {
            lines.push('', 'Profit does not include the managers on your transfer list until they sell.');
        }
        return lines.join('\n');
    }

    // ------------------------------------------------------------------
    // pull history and all time totals
    // ------------------------------------------------------------------
    function add_to_history(country, name) {
        const history = load_json(STORAGE_HISTORY, []);
        history.unshift({ date: new Date().toISOString(), country: country, name: name || '' });
        save_json(STORAGE_HISTORY, history.slice(0, 200));
    }

    function add_to_totals(profit) {
        const totals = load_json(STORAGE_TOTALS, { runs: 0, packs: 0, spent: 0, profit: 0, managers: 0 });
        totals.runs++;
        totals.packs += stats.packs;
        totals.spent += coinsSpent;
        totals.managers += stats.managers.length;
        if (profit != null) totals.profit += profit;
        save_json(STORAGE_TOTALS, totals);
    }

    // ------------------------------------------------------------------
    // status panel
    // ------------------------------------------------------------------
    let panel = null;
    let panelView = 'main'; // 'main', 'settings' or 'history'

    const SETTING_FIELDS = [
        ['BRONZE_PACK_TITLE', 'Pack name', 'text'],
        ['MAX_PACKS', 'Max packs (0 = no limit)', 'number'],
        ['MAX_MINUTES', 'Max minutes (0 = no limit)', 'number'],
        ['MAX_COINS_TO_SPEND', 'Max coins to spend (0 = no limit)', 'number'],
        ['STOP_WHEN_COINS_BELOW', 'Keep at least this many coins', 'number'],
        ['DELAY_MULTIPLIER', 'Speed (1 = original, 2 = half speed)', 'number'],
        ['important_manager_countries', 'Manager countries to keep (comma separated)', 'list'],
    ];

    function set_status(message) {
        status = message;
        console.log(message);
        update_panel();
    }

    function el(tag, style, textValue) {
        const node = document.createElement(tag);
        if (style) node.style.cssText = style;
        if (textValue != null) node.textContent = textValue;
        return node;
    }

    // !important so the web app's own button styles can't override these
    const BUTTON_STYLE = 'margin:6px 6px 0 0 !important;padding:4px 10px !important;cursor:pointer !important;' +
        'font:bold 12px sans-serif !important;color:#fff !important;border:none !important;border-radius:4px !important;' +
        'opacity:1 !important;text-shadow:none !important;box-shadow:none !important;';
    const BUTTON_COLORS = { green: '#1f9d55', red: '#d64545', blue: '#2f6fed', grey: '#4a5568' };
    const INPUT_STYLE = 'width:100% !important;box-sizing:border-box !important;margin:2px 0 6px !important;padding:3px !important;' +
        'font:12px sans-serif !important;color:#000 !important;background:#fff !important;border:1px solid #888 !important;border-radius:3px !important;';

    function button(label, onClick, color) {
        const b = el('button', BUTTON_STYLE + `background:${BUTTON_COLORS[color || 'grey']} !important;`, label);
        b.addEventListener('click', onClick);
        return b;
    }

    function build_panel() {
        panel = el('div', 'position:fixed;right:12px;bottom:12px;z-index:2147483647;width:250px;max-height:80vh;overflow:auto;' +
            'padding:10px 12px;border-radius:8px;background:rgba(15,20,30,0.94);color:#fff;' +
            'font:12px/1.5 sans-serif;box-shadow:0 4px 16px rgba(0,0,0,0.4);');
        panel.id = 'bpao-panel';
        // keep panel clicks and typing away from the web app and the "-" / "=" keys
        ['mousedown', 'mouseup', 'click', 'keydown', 'keyup', 'keypress'].forEach(type =>
            panel.addEventListener(type, e => e.stopPropagation()));
    }

    function render_main() {
        const budget = settings.MAX_COINS_TO_SPEND ? ` / ${settings.MAX_COINS_TO_SPEND.toLocaleString()}` : '';
        const packs = settings.MAX_PACKS ? ` / ${settings.MAX_PACKS}` : '';
        const profit = isRunning || stats.started ? current_profit() : null;
        panel.appendChild(el('div', '', (isRunning ? 'Running: ' : '') + status));
        panel.appendChild(el('div', 'margin:6px 0;white-space:pre-line;opacity:0.85',
            `Packs: ${stats.packs}${packs}\n` +
            `Coins spent: ${coinsSpent.toLocaleString()}${budget}\n` +
            `Profit: ${profit == null ? '-' : format_coins(profit)}\n` +
            `Players stored: ${stats.players}\n` +
            `Managers listed: ${stats.managers.length}`));
        panel.appendChild(button('Start', () => startAutomation(), 'green'));
        panel.appendChild(button('Stop', () => stopAutomation(), 'red'));
        panel.appendChild(button('Settings', () => { panelView = 'settings'; update_panel(true); }));
        panel.appendChild(button('History', () => { panelView = 'history'; update_panel(true); }));
    }

    function render_settings() {
        const inputs = {};
        for (const [key, label, type] of SETTING_FIELDS) {
            panel.appendChild(el('div', 'opacity:0.85', label));
            const input = el(type === 'list' ? 'textarea' : 'input', INPUT_STYLE + (type === 'list' ? 'height:60px;' : ''));
            if (type === 'number') {
                input.type = 'number';
                input.min = '0';
                input.step = 'any';
            }
            input.value = type === 'list' ? settings[key].join(', ') : settings[key];
            inputs[key] = input;
            panel.appendChild(input);
        }
        panel.appendChild(button('Save', () => {
            const next = {};
            for (const [key, , type] of SETTING_FIELDS) {
                const raw = inputs[key].value;
                if (type === 'list') {
                    next[key] = raw.split(',').map(x => x.trim()).filter(Boolean);
                } else if (type === 'number') {
                    const n = parseFloat(raw);
                    next[key] = isFinite(n) && n >= 0 ? n : DEFAULT_SETTINGS[key];
                } else {
                    next[key] = raw.trim() || DEFAULT_SETTINGS[key];
                }
            }
            if (!(next.DELAY_MULTIPLIER > 0)) next.DELAY_MULTIPLIER = DEFAULT_SETTINGS.DELAY_MULTIPLIER;
            settings = Object.assign({}, DEFAULT_SETTINGS, next);
            save_json(STORAGE_SETTINGS, settings);
            panelView = 'main';
            set_status('Settings saved');
        }, 'blue'));
        panel.appendChild(button('Reset to defaults', () => {
            settings = Object.assign({}, DEFAULT_SETTINGS);
            save_json(STORAGE_SETTINGS, settings);
            update_panel(true);
        }));
        panel.appendChild(button('Back', () => { panelView = 'main'; update_panel(true); }));
    }

    function render_history() {
        const totals = load_json(STORAGE_TOTALS, null);
        panel.appendChild(el('div', 'white-space:pre-line;margin-bottom:6px;opacity:0.85', totals
            ? `All time: ${totals.runs} runs, ${totals.packs} packs\n` +
              `Spent: ${totals.spent.toLocaleString()}  Profit: ${format_coins(totals.profit)}\n` +
              `Managers kept: ${totals.managers}`
            : 'No runs yet.'));

        const history = load_json(STORAGE_HISTORY, []);
        panel.appendChild(el('div', 'font-weight:bold', `Valuable managers (${history.length})`));
        if (!history.length) panel.appendChild(el('div', 'opacity:0.7', 'None yet.'));
        for (const entry of history.slice(0, 50)) {
            const when = new Date(entry.date).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            panel.appendChild(el('div', 'border-top:1px solid rgba(255,255,255,0.1);padding:2px 0',
                `${entry.country}${entry.name ? ' - ' + entry.name : ''} (${when})`));
        }
        panel.appendChild(button('Clear history', () => {
            if (!confirm('Clear the manager history and all time totals?')) return;
            save_json(STORAGE_HISTORY, []);
            save_json(STORAGE_TOTALS, null);
            update_panel(true);
        }));
        panel.appendChild(button('Back', () => { panelView = 'main'; update_panel(true); }));
    }

    // rebuild the panel. Settings and history only redraw when asked (force),
    // so the 2 second refresh doesn't wipe what you're typing.
    function update_panel(force) {
        if (!SHOW_PANEL || !document.body) return;
        if (!panel) build_panel();
        if (!document.body.contains(panel)) document.body.appendChild(panel);
        if (panelView !== 'main' && !force && panel.childElementCount) return;

        panel.textContent = '';
        const title = el('div', 'font-weight:bold;margin-bottom:4px', 'Bronze Auto Opener' +
            (panelView === 'settings' ? ': Settings' : panelView === 'history' ? ': History' : ''));
        if (SCRIPT_VERSION) title.appendChild(el('span', 'font-weight:normal;opacity:0.6;margin-left:6px', 'v' + SCRIPT_VERSION));
        panel.appendChild(title);
        if (panelView === 'settings') render_settings();
        else if (panelView === 'history') render_history();
        else render_main();
    }

    function stopAutomation() {
        if (!isRunning) return;
        set_status('Stopping after the current step...');
        isRunning = false;
    }

    window.addEventListener('keydown', (e) => {
        // don't trigger while typing in a search box / price field
        const tag = (e.target && e.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;

        if (e.key === '-') {
            startAutomation();
        } else if (e.key === '=' || e.key === '+') {
            stopAutomation();
        }
    });

    update_panel();
    // the web app sometimes rebuilds the page, so put the panel back if it disappears
    if (SHOW_PANEL) setInterval(update_panel, 2000);

    console.log(`Bronze Pack Auto Opener (FC 27) ${SCRIPT_VERSION ? 'v' + SCRIPT_VERSION + ' ' : ''}loaded. Press "-" to start, "=" to stop.`);

})();
