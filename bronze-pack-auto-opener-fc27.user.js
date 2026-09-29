// ==UserScript==
// @name         Bronze Pack Auto Opener (FC 27)
// @namespace    http://tampermonkey.net/
// @version      2026.1.0
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
    const CLASSIC_PACKS_TAB_NAME = "Classic Packs";
    const BRONZE_PACK_TITLE = "Large Bronze Pack";
    const BIO_COUNTRY_LABEL = "Country/Region";

    // COIN LIMITS (0 = no limit)
    // most coins to spend on packs each time you press "-"
    const MAX_COINS_TO_SPEND = 0;
    // never buy a pack if it would take your balance below this
    const STOP_WHEN_COINS_BELOW = 0;
    // where the web app shows your coin balance (first one found is used)
    const COIN_BALANCE_SELECTORS = ['.view-navbar-currency-coins', '.view-navbar-currency .coins', '.ut-navbar-currency-coins'];

    // SPEED: every wait is multiplied by this. 1 = normal, 1.5 = 50% slower, 2 = half speed.
    // Raise it if the web app lags and the bot clicks before a screen has loaded.
    const DELAY_MULTIPLIER = 1.5;

    const MAX_RETRIES = 300;
    const DEFAULT_FAST_DELAY = 10;
    const DEFAULT_LONG_DELAY = 300;
    const SPINNER_TIMEOUT = 10000;
    let important_manager_countries = ["Georgia", "Malawi", "Ivory Coast", "Cameroon", "Nigeria", "France", "Egypt", "Portugal"];
    // managers from these countries are expensive, so they go to the transfer list instead of being quick sold
    // just make sure that the game spells it exactly the same (capital letters, space)

    // global selectors
    const unassigned_section = '.ut-unassigned-view .entityContainer';
    const selected_tab_selector = '.ea-filter-bar-item-view.selected';
    const message_dialog_selector = '.ea-dialog-view.ea-dialog-view-type--message';

    let counter = 0;
    let isRunning = false;
    let coinsSpent = 0;

    function delay(ms) {
        return new Promise(res => setTimeout(res, ms * DELAY_MULTIPLIER));
    }

    function text(el) {
        return el ? el.textContent.trim() : '';
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
            await delay(200);
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
    function pick_pack(packs) {
        return packs.find(p => p.classList.contains('is-tradeable')) || packs[0] || null;
    }

    function find_bronze_pack() {
        // 1. pack element tagged with the name (how FC 26 did it)
        const by_attribute = Array.from(document.querySelectorAll('[data-title]'))
            .filter(el => same_name(el.getAttribute('data-title'), BRONZE_PACK_TITLE));
        if (by_attribute.length) return pick_pack(by_attribute);

        // 2. fall back to the name shown on screen: find the text, then walk up to the
        //    nearest box that also holds a coin buy button
        const found = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
            if (!same_name(walker.currentNode.textContent, BRONZE_PACK_TITLE)) continue;
            let el = walker.currentNode.parentElement;
            while (el && el !== document.body && !find_coin_button(el)) {
                el = el.parentElement;
            }
            if (el && el !== document.body && !found.includes(el)) found.push(el);
        }
        return pick_pack(found);
    }

    // logs every pack name the script can see, to help fix BRONZE_PACK_TITLE
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
        if (!MAX_COINS_TO_SPEND && !STOP_WHEN_COINS_BELOW) return;

        if (price == null) {
            throw new Error("Couldn't read the pack price, so I can't check your coin limits.");
        }
        if (MAX_COINS_TO_SPEND && coinsSpent + price > MAX_COINS_TO_SPEND) {
            throw new Error(`Coin limit reached: spent ${coinsSpent.toLocaleString()} of ${MAX_COINS_TO_SPEND.toLocaleString()} coins. Another pack costs ${price.toLocaleString()}.`);
        }
        if (STOP_WHEN_COINS_BELOW) {
            const balance = read_coin_balance();
            if (balance == null) {
                throw new Error("Couldn't read your coin balance. Check COIN_BALANCE_SELECTORS at the top of the script.");
            }
            if (balance - price < STOP_WHEN_COINS_BELOW) {
                throw new Error(`Stopped to keep at least ${STOP_WHEN_COINS_BELOW.toLocaleString()} coins. Balance is ${balance.toLocaleString()} and a pack costs ${price.toLocaleString()}.`);
            }
        }
    }

    async function locate_and_open_bronze_pack() {
        const bronze_pack = find_bronze_pack();
        if (!bronze_pack) {
            const titles = log_visible_packs();
            const hint = titles.length ? ` Packs I can see: ${titles.join(', ')}.` : ' Scroll down so the pack is on screen, then try again.';
            throw new Error(`Could not find "${BRONZE_PACK_TITLE}".${hint} See the console (F12) for details.`);
        }
        const open_button = find_coin_button(bronze_pack);
        if (!open_button) {
            throw new Error('Could not find the coin buy button on the bronze pack');
        }

        const price = parse_coins(text(open_button));
        check_coin_limits(price);

        counter = 0;
        while (document.querySelector(message_dialog_selector) == null && counter < MAX_RETRIES) {
            simulateFullClick(open_button);
            await delay(DEFAULT_FAST_DELAY);
            counter++;
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
            const budget = MAX_COINS_TO_SPEND ? ` of ${MAX_COINS_TO_SPEND.toLocaleString()}` : '';
            console.log(`Coins spent this run: ${coinsSpent.toLocaleString()}${budget}`);
        }
    }

    // players still waiting in unassigned that are NOT already in the club
    function non_duplicate_players(skip) {
        return Array.from(document.querySelectorAll(unassigned_section + ' .player')).filter(p => {
            const container = p.closest('.entityContainer');
            return container && !container.classList.contains('club-duplicated') && !skip.has(container);
        });
    }

    function find_send_to_club_button() {
        const btn = document.querySelector('.send-to-club');
        return btn && !btn.disabled && !btn.classList.contains('disabled') ? btn : null;
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
            for (let tries = 0; tries < 10 && !store_btn; tries++) {
                simulateFullClick(player);
                await delay(DEFAULT_LONG_DELAY);
                store_btn = find_send_to_club_button();
            }
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
                await delay(100);
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

    async function send_important_managers_to_transfer_list() {
        await delay(DEFAULT_LONG_DELAY * 2);
        let manager_list = document.querySelectorAll('.entityContainer .small.manager.staff');
        console.log('manager list length: ' + manager_list.length);
        if (manager_list.length == 0) return;

        await waitForElement('.listFUTItem');
        for (const manager of manager_list) {
            if (!isRunning) return;
            simulateFullClick(manager);
            console.log('clicking manager');
            await delay(DEFAULT_LONG_DELAY);
            simulateFullClick(document.querySelector('.more'));

            let country = await check_manager_country();
            console.log('manager country: ' + country);
            let back_button = document.querySelectorAll('.ut-navigation-button-control')[1]; // hard coded back button.. might error if failed
            simulateFullClick(back_button);
            await delay(DEFAULT_LONG_DELAY);

            if (country != null && important_manager_countries.includes(country)) {
                simulateFullClick(document.querySelector('.send-to-transfer-list'));
                await delay(DEFAULT_FAST_DELAY);
            }
        }
    }

    async function redeem_misc_items() {
        console.log('redeem_misc_items: start');
        try {
            await waitForElement('.listFUTItem'); // wait for list
        } catch (err) {
            console.log('redeem_misc_items: no list found, skipping');
            return;
        }
        await delay(DEFAULT_LONG_DELAY); // small buffer

        while (isRunning) {
            // Always query fresh
            const misc = document.querySelector('.small.misc');
            if (!misc) {
                console.log('redeem_misc_items: no misc items left');
                break;
            }

            // Select the misc item (if needed)
            simulateFullClick(misc);
            await delay(DEFAULT_LONG_DELAY);

            // Find redeem button safely
            const redeem_button = document.querySelector('.redeem-item');
            if (!redeem_button) {
                console.log('redeem_misc_items: redeem button not found, aborting');
                break;
            }

            console.log('redeem_misc_items: redeeming one misc item');
            simulateFullClick(redeem_button);
            await waitForSpinner(); // wait for server roundtrip
            await delay(DEFAULT_LONG_DELAY * 4); // give UI time to settle

            const errorDialog = document.querySelector('.ea-dialog-view.ea-dialog-view-type--error');
            if (errorDialog) {
                console.log('redeem_misc_items: error dialog detected, stopping');
                break;
            }
        }

        console.log('redeem_misc_items: done');
    }



    async function sort_players() {
        counter = 0;
        let items = document.querySelectorAll(unassigned_section);
        while (items.length == 0 && counter < MAX_RETRIES) {
            items = document.querySelectorAll(unassigned_section);
            await delay(DEFAULT_FAST_DELAY);
            counter++;
        }

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

    async function quick_sell() {
        console.log('inside quick sell');
        await delay(DEFAULT_LONG_DELAY * 2);
        let quick_sell_button = document.querySelector('.currency.primary.coins');
        counter = 0;
        while (!quick_sell_button && counter < MAX_RETRIES) {
            quick_sell_button = document.querySelector('.currency.primary.coins');
            await delay(DEFAULT_FAST_DELAY);
            counter++;
        }
        counter = 0;
        while (quick_sell_button && counter < MAX_RETRIES && isRunning) {
            simulateFullClick(quick_sell_button);
            await delay(DEFAULT_LONG_DELAY * 2);
            simulateFullClick(document.querySelector('.ut-st-button-group .btn-standard.primary'));

            await waitForSpinner();
            quick_sell_button = document.querySelector('.currency.primary.coins');
            counter++;
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

        let packsOpened = 0;
        while (isRunning) {
            if (!(await select_classic_packs())) {
                throw new Error(`Couldn't get back to ${CLASSIC_PACKS_TAB_NAME} after pack ${packsOpened}. Go to Store > Packs > ${CLASSIC_PACKS_TAB_NAME} and press "-" again.`);
            }

            if (!isRunning) break;
            console.log('Step 1: opening pack ' + (packsOpened + 1));
            await locate_and_open_bronze_pack();

            if (!isRunning) break;
            console.log('Step 2: sorting players, managers and items');
            await sort_players();

            if (!isRunning) break;
            console.log('Step 3: quick selling the rest');
            await quick_sell();

            if (!isRunning) break;
            console.log('Step 4: going back to the packs');
            simulateFullClick(document.querySelector('.ut-navigation-button-control'));
            await waitForSpinner();
            await delay(DEFAULT_LONG_DELAY);
            packsOpened++;
        }
    }

    async function startAutomation() {
        if (isRunning) return;
        isRunning = true;
        coinsSpent = 0;
        console.log('Bronze Pack Auto Opener started');
        try {
            await mainLoop();
        } catch (err) {
            console.error('Bronze Pack Auto Opener error:', err);
            alert('Bronze Pack Auto Opener stopped: ' + err.message);
        } finally {
            // always reset so pressing "-" works again
            isRunning = false;
            console.log('Bronze Pack Auto Opener stopped');
        }
    }

    function stopAutomation() {
        if (isRunning) console.log('Bronze Pack Auto Opener stopping after the current step...');
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

    console.log('Bronze Pack Auto Opener (FC 27) loaded. Press "-" to start, "=" to stop.');

})();
