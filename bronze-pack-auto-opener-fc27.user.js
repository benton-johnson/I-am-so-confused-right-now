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

    function delay(ms) {
        return new Promise(res => setTimeout(res, ms));
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
            }
        }
        return true;
    }


    async function locate_and_open_bronze_pack() {
        const bronze_pack = document.querySelector(`.ut-store-pack-details-view.is-tradeable[data-title="${BRONZE_PACK_TITLE}"]`);
        if (!bronze_pack) {
            throw new Error(`Could not find a pack with data-title="${BRONZE_PACK_TITLE}"`);
        }
        const open_button = bronze_pack.querySelector('button.currency.coins.primary');
        if (!open_button) {
            throw new Error('Could not find the coin buy button on the bronze pack');
        }

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
    }

    async function send_non_duplicate_bronze_player_to_club() {
        const storedPlayers = new Set();
        let processedCount = 0;
        const maxPlayers = 13;

        while (processedCount < maxPlayers && isRunning) {
            // Get FRESH list each iteration
            const player_list = document.querySelectorAll(unassigned_section + ' .player');

            if (player_list.length === 0) {
                console.log('No more players found');
                break;
            }

            // Find first player that hasn't been stored yet
            let player = null;
            let playerName = null;
            let playerId = null;

            for (const p of player_list) {
                const container = p.closest('.entityContainer');
                if (!container) continue;

                // Use data-definition-id or name as unique identifier
                playerId = container.getAttribute('data-definition-id') ||
                        container.querySelector('.name')?.textContent;

                if (!storedPlayers.has(playerId)) {
                    player = p;
                    playerName = container.querySelector('.name')?.textContent || 'Unknown';
                    break;
                } else {
                    console.log(`Already stored ${playerId}, skipping`);
                }
            }

            if (!player) {
                console.log('All visible players already processed');
                break;
            }

            let tries = 0;
            let selected = false;

            while (tries < MAX_RETRIES) {
                const listItem = player.closest('.listFUTItem');
                if (!listItem) break;

                if (listItem.classList.contains('selected')) {
                    selected = true;
                    break;
                }

                console.log('attempting to click player: ' + playerName);
                simulateFullClick(player);
                await delay(DEFAULT_LONG_DELAY);
                tries++;
            }

            if (selected || tries > 0) {
                console.log('Selected player: ' + playerName);
                await delay(DEFAULT_LONG_DELAY);

                let store_btn = document.querySelector('.send-to-club');
                if (store_btn) {
                    simulateFullClick(store_btn);
                    console.log('Stored in club: ' + playerName);
                    storedPlayers.add(playerId); // Mark as stored
                    processedCount++;
                } else {
                    console.log('Send to club button not found, stopping player sort');
                    break;
                }

                await delay(DEFAULT_LONG_DELAY * 2); // Wait for potential re-render
            } else {
                console.log('Failed to select player, breaking');
                break;
            }
        }

        console.log(`Processed ${processedCount} players`);
        console.log('Stored player IDs:', Array.from(storedPlayers));
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

        // after sending the non dupes to club, check if there are any more non dupe players left.
        // if there are, exit to the store and re-enter the unassigned menu
        const leftover = document.querySelector(unassigned_section + ' .player');
        if (leftover && !leftover.closest('.entityContainer').classList.contains('club-duplicated')) {
            simulateFullClick(document.querySelector('.icon-store'));
            await waitForSpinner();
            await delay(DEFAULT_FAST_DELAY);
            simulateFullClick(document.querySelector('.ut-unassigned-tile-view'));

            counter = 0;
            while (document.querySelectorAll(unassigned_section).length === 0 && counter < MAX_RETRIES) {
                await delay(DEFAULT_FAST_DELAY);
                counter++;
            }
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

        while (isRunning) {
            try {
                if (!(await select_classic_packs())) {
                    isRunning = false;
                    break;
                }
            } catch (err) {
                console.log("Failed to select classic pack somewhere", err);
                isRunning = false;
                return false;
            }

            if (!isRunning) break;
            try {
                await locate_and_open_bronze_pack();
            } catch (err) {
                console.log("Failed to locate or open bronze pack:", err.message);
                alert("Bronze Pack Auto Opener stopped: " + err.message);
                isRunning = false;
                break;
            }

            if (!isRunning) break;
            await sort_players();

            if (!isRunning) break;
            await quick_sell();

            if (!isRunning) break;
            simulateFullClick(document.querySelector('.ut-navigation-button-control'));
            await waitForSpinner();
        }
        console.log('Bronze Pack Auto Opener stopped');
    }

    async function startAutomation() {
        if (isRunning) return;
        isRunning = true;
        console.log('Bronze Pack Auto Opener started');
        await mainLoop();
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
