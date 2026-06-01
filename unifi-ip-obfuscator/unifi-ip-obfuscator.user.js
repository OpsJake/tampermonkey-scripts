// ==UserScript==
// @name         UniFi Stream Privacy - Public IP Masker
// @namespace    atlas.unifi.privacy
// @version      3.0.0
// @description  Masks public WAN IPs in UniFi with fast side-panel protection and per-field reveal buttons.
// @author       Snacks + ChatGPT
// @downloadURL  https://raw.githubusercontent.com/OpsJake/tampermonkey-scripts/main/unifi-ip-obfuscator/unifi-ip-obfuscator.user.js
// @updateURL    https://raw.githubusercontent.com/OpsJake/tampermonkey-scripts/main/unifi-ip-obfuscator/unifi-ip-obfuscator.user.js
// @match        https://unifi.ui.com/*
// @match        https://*.ui.com/*
// @match        http://192.168.*/*
// @match        https://192.168.*/*
// @match        http://10.*/*
// @match        https://10.*/*
// @match        http://172.16.*/*
// @match        https://172.16.*/*
// @match        http://172.17.*/*
// @match        https://172.17.*/*
// @match        http://172.18.*/*
// @match        https://172.18.*/*
// @match        http://172.19.*/*
// @match        https://172.19.*/*
// @match        http://172.20.*/*
// @match        https://172.20.*/*
// @match        http://172.21.*/*
// @match        https://172.21.*/*
// @match        http://172.22.*/*
// @match        https://172.22.*/*
// @match        http://172.23.*/*
// @match        https://172.23.*/*
// @match        http://172.24.*/*
// @match        https://172.24.*/*
// @match        http://172.25.*/*
// @match        https://172.25.*/*
// @match        http://172.26.*/*
// @match        https://172.26.*/*
// @match        http://172.27.*/*
// @match        https://172.27.*/*
// @match        http://172.28.*/*
// @match        https://172.28.*/*
// @match        http://172.29.*/*
// @match        https://172.29.*/*
// @match        http://172.30.*/*
// @match        https://172.30.*/*
// @match        http://172.31.*/*
// @match        https://172.31.*/*
// @run-at       document-start
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(() => {
    'use strict';

    const CONFIG = {
        MASK_PUBLIC_IPV4: true,
        MASK_PUBLIC_IPV6: true,

        // Set true only if you also want LAN addresses like hidden.
        MASK_PRIVATE_IPS: false,

        IPV4_MASK: 'xxx.xxx.xxx.xxx',
        IPV6_MASK: 'xxxx:xxxx:xxxx:xxxx',

        // Per-field eye reveal auto-hide.
        AUTO_HIDE_SECONDS: 8,

        // When you click something that opens a UniFi side panel, the script briefly
        // hides newly injected panel/dialog content while it masks sensitive fields.
        SIDE_PANEL_HOLD_MS: 220,

        // After any click, treat newly added large/fixed UI chunks as risky.
        CLICK_PREHIDE_WINDOW_MS: 700,

        DEBUG: false,
    };

    const WRAPPER_ATTR = 'data-atlas-ip-mask-wrapper';
    const MASK_ATTR = 'data-atlas-ip-mask';
    const ORIGINAL_ATTR = 'data-atlas-original-ip';
    const BUTTON_ATTR = 'data-atlas-ip-toggle';
    const HOLD_ATTR = 'data-atlas-privacy-hold';
    const GLOBAL_TOGGLE_ID = 'atlas-unifi-obfuscation-toggle';
    const STORAGE_KEY = 'atlas_unifi_obfuscation_enabled';

    let clickPrehideUntil = 0;
    let obfuscationEnabled = true;
    const attrOriginalMap = new WeakMap();

    function log(...args) {
        if (CONFIG.DEBUG) console.log('[UniFi IP Mask]', ...args);
    }

    /************************************************************
     * Early CSS
     ************************************************************/

    function injectStyle() {
        if (document.getElementById('atlas-unifi-ip-mask-style')) return;

        const style = document.createElement('style');
        style.id = 'atlas-unifi-ip-mask-style';

        style.textContent = `
            [${WRAPPER_ATTR}="true"] {
                display: inline-flex !important;
                align-items: center !important;
                gap: 4px !important;
                white-space: nowrap !important;
                max-width: 100% !important;
            }

            [${MASK_ATTR}="true"] {
                font-family: inherit !important;
                color: inherit !important;
                background: rgba(255, 193, 7, 0.16) !important;
                border: 1px solid rgba(255, 193, 7, 0.35) !important;
                border-radius: 4px !important;
                padding: 0 4px !important;
                line-height: inherit !important;
            }

            [${BUTTON_ATTR}="true"] {
                all: unset !important;
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                width: 16px !important;
                min-width: 16px !important;
                height: 16px !important;
                border-radius: 4px !important;
                cursor: pointer !important;
                opacity: 0.7 !important;
                font-size: 11px !important;
                line-height: 1 !important;
                color: inherit !important;
                background: rgba(255, 255, 255, 0.08) !important;
                user-select: none !important;
            }

            [${BUTTON_ATTR}="true"]:hover {
                opacity: 1 !important;
                background: rgba(255, 255, 255, 0.18) !important;
            }

            [${HOLD_ATTR}="true"] {
                visibility: hidden !important;
            }

            #${GLOBAL_TOGGLE_ID} {
                position: fixed !important;
                right: 12px !important;
                bottom: 12px !important;
                z-index: 2147483647 !important;
                border: 1px solid rgba(255, 255, 255, 0.25) !important;
                border-radius: 8px !important;
                background: rgba(20, 20, 20, 0.82) !important;
                color: #fff !important;
                font-size: 12px !important;
                line-height: 1 !important;
                padding: 8px 10px !important;
                cursor: pointer !important;
                user-select: none !important;
            }

            #${GLOBAL_TOGGLE_ID}:hover {
                background: rgba(20, 20, 20, 0.95) !important;
            }
        `;

        const target = document.head || document.documentElement;
        if (typeof GM_addStyle === 'function') {
            GM_addStyle(style.textContent);
        } else {
            target.appendChild(style);
        }
    }

    injectStyle();

    /************************************************************
     * IP detection
     ************************************************************/

    const ipv4Regex = /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g;
    const ipv6CandidateRegex = /(?<![\w])(?:[A-Fa-f0-9:]{2,})(?![\w])/g;
    const macRegex = /\b(?:[A-Fa-f0-9]{2}:){5}[A-Fa-f0-9]{2}\b/g;
    const simpleTimeRegex = /^(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?(?:\s?[AP]M)?$/i;
    const dateTimeRegex = /^(?:today|yesterday)\s+at\s+\d{1,2}:\d{2}(?::\d{2})?\s?(?:am|pm)?$|^\d{1,4}[/-]\d{1,2}[/-]\d{1,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AP]M)?)?$|^\d{4}-\d{2}-\d{2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/i;

    function isLikelyTime(text) {
        return simpleTimeRegex.test(String(text || '').trim());
    }

    function isLikelyDateTime(text) {
        const value = String(text || '').trim();
        return dateTimeRegex.test(value) || value.includes(' at ') && /\d{1,2}:\d{2}/.test(value);
    }

    function isMacAddress(text) {
        return /^(?:[A-Fa-f0-9]{2}:){5}[A-Fa-f0-9]{2}$/.test(text);
    }

    function isIPv4(text) {
        return /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(text);
    }

    function isIPv6(text) {
        const ip = String(text || '').trim();
        if (!ip || ip.includes('%')) return false;
        if (isLikelyTime(ip) || isLikelyDateTime(ip)) return false;
        if (!ip.includes(':')) return false;

        const colonCount = (ip.match(/:/g) || []).length;
        if (colonCount < 3) return false;
        if (!/^[A-Fa-f0-9:]+$/.test(ip)) return false;

        const hasDouble = ip.includes('::');
        if (hasDouble && ip.indexOf('::') !== ip.lastIndexOf('::')) return false;

        const parts = ip.split(':');
        if (parts.length < 3 || parts.length > 8 + (hasDouble ? 1 : 0)) return false;

        for (const part of parts) {
            if (!part) continue;
            if (!/^[A-Fa-f0-9]{1,4}$/.test(part)) return false;
        }

        return true;
    }

    function isPrivateIPv4(ip) {
        const [a, b] = ip.split('.').map(Number);

        return (
            a === 10 ||
            a === 127 ||
            a === 0 ||
            a >= 224 ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168) ||
            (a === 169 && b === 254) ||
            (a === 100 && b >= 64 && b <= 127) ||
            (a === 192 && b === 0) ||
            (a === 192 && b === 2) ||
            (a === 198 && (b === 18 || b === 19)) ||
            (a === 198 && b === 51) ||
            (a === 203 && b === 0) ||
            ip === '255.255.255.255'
        );
    }

    function isPrivateIPv6(ip) {
        const v = ip.toLowerCase();

        return (
            v === '::1' ||
            v.startsWith('fe80:') ||
            v.startsWith('fc') ||
            v.startsWith('fd') ||
            v.startsWith('2001:db8:')
        );
    }

    function shouldMaskIP(ip) {
        if (ip.includes('.')) {
            if (CONFIG.MASK_PRIVATE_IPS) return true;
            return CONFIG.MASK_PUBLIC_IPV4 && !isPrivateIPv4(ip);
        }

        if (isMacAddress(ip)) return true;

        if (isIPv6(ip)) {
            if (CONFIG.MASK_PRIVATE_IPS) return true;
            return CONFIG.MASK_PUBLIC_IPV6 && !isPrivateIPv6(ip);
        }

        return false;
    }

    function maskForIP(ip) {
        if (isMacAddress(ip)) return 'xx:xx:xx:xx:xx:xx';
        return isIPv6(ip) ? CONFIG.IPV6_MASK : CONFIG.IPV4_MASK;
    }

    function findIPs(text) {
        const found = [];

        if (!text) return found;

        for (const regex of [ipv4Regex, macRegex]) {
            regex.lastIndex = 0;
            let match;
            while ((match = regex.exec(text)) !== null) {
                const value = match[0];
                if (!shouldMaskIP(value)) continue;
                found.push({ ip: value, index: match.index, end: match.index + value.length });
            }
        }

        ipv6CandidateRegex.lastIndex = 0;
        let ipv6Match;
        while ((ipv6Match = ipv6CandidateRegex.exec(text)) !== null) {
            const value = ipv6Match[0];
            if (!value.includes(':')) continue;
            if (isLikelyTime(value) || isLikelyDateTime(value)) continue;
            if (!isIPv6(value)) continue;
            if (!shouldMaskIP(value)) continue;
            found.push({ ip: value, index: ipv6Match.index, end: ipv6Match.index + value.length });
        }

        return found
            .sort((a, b) => a.index - b.index)
            .filter((entry, i, arr) => i === 0 || entry.index >= arr[i - 1].end);
    }

    function containsMaskableIPText(root) {
        if (!root) return false;

        const text = root.nodeType === Node.TEXT_NODE
            ? root.nodeValue
            : root.textContent;

        if (!text || (!text.includes('.') && !text.includes(':'))) return false;

        return findIPs(text).length > 0;
    }

    /************************************************************
     * DOM helpers
     ************************************************************/

    function shouldSkipElement(el) {
        if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;

        const tag = el.tagName.toLowerCase();

        if (
            tag === 'script' ||
            tag === 'style' ||
            tag === 'noscript' ||
            tag === 'textarea' ||
            tag === 'input' ||
            tag === 'select' ||
            tag === 'option' ||
            tag === 'svg' ||
            tag === 'canvas'
        ) {
            return true;
        }

        if (el.closest(`[${WRAPPER_ATTR}="true"]`)) return true;

        return false;
    }

    function looksLikeRiskyPanel(el) {
        if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
        if (shouldSkipElement(el)) return false;

        const role = String(el.getAttribute('role') || '').toLowerCase();
        const ariaModal = String(el.getAttribute('aria-modal') || '').toLowerCase();
        const testId = String(el.getAttribute('data-testid') || '').toLowerCase();
        const className = String(el.className || '').toLowerCase();

        if (role === 'dialog' || role === 'menu' || ariaModal === 'true') return true;

        if (
            testId.includes('panel') ||
            testId.includes('drawer') ||
            testId.includes('modal') ||
            testId.includes('popover') ||
            className.includes('panel') ||
            className.includes('drawer') ||
            className.includes('modal') ||
            className.includes('popover') ||
            className.includes('tooltip')
        ) {
            return true;
        }

        const rect = safeRect(el);
        if (!rect) return false;

        const style = window.getComputedStyle(el);
        const position = style.position;

        const isOverlayish =
            position === 'fixed' ||
            position === 'absolute' ||
            position === 'sticky';

        const isLargeEnough =
            rect.width >= 220 &&
            rect.height >= 160;

        const nearRightSide =
            rect.right >= window.innerWidth - 40;

        return isOverlayish && isLargeEnough && nearRightSide;
    }

    function safeRect(el) {
        try {
            return el.getBoundingClientRect();
        } catch {
            return null;
        }
    }

    function getHoldTarget(node) {
        if (!node) return null;

        let el = node.nodeType === Node.ELEMENT_NODE
            ? node
            : node.parentElement;

        if (!el) return null;

        const closestExplicit = el.closest?.(
            '[role="dialog"], [aria-modal="true"], [data-testid*="panel"], [data-testid*="drawer"], [data-testid*="modal"], [data-testid*="popover"]'
        );

        if (closestExplicit && closestExplicit !== document.body) {
            return closestExplicit;
        }

        let current = el;

        for (let i = 0; i < 8 && current && current !== document.body; i++) {
            if (looksLikeRiskyPanel(current)) {
                return current;
            }

            current = current.parentElement;
        }

        return el;
    }

    function holdTemporarily(el) {
        if (!el || el === document.body || el === document.documentElement) return;

        el.setAttribute(HOLD_ATTR, 'true');

        window.setTimeout(() => {
            try {
                el.removeAttribute(HOLD_ATTR);
            } catch {}
        }, CONFIG.SIDE_PANEL_HOLD_MS);
    }

    function createMaskedNode(ip) {
        const wrapper = document.createElement('span');
        wrapper.setAttribute(WRAPPER_ATTR, 'true');

        const text = document.createElement('span');
        text.setAttribute(MASK_ATTR, 'true');
        text.setAttribute(ORIGINAL_ATTR, ip);
        text.textContent = maskForIP(ip);

        const btn = document.createElement('button');
        btn.setAttribute(BUTTON_ATTR, 'true');
        btn.type = 'button';
        btn.textContent = '👁';
        btn.title = 'Reveal IP temporarily';
        btn.setAttribute('aria-label', 'Reveal IP temporarily');

        btn.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();

            const currentlyRevealed = text.textContent === ip;

            if (currentlyRevealed) {
                hideMaskedNode(text, btn);
            } else {
                revealMaskedNode(text, btn);
            }
        }, true);

        wrapper.appendChild(text);
        wrapper.appendChild(btn);

        return wrapper;
    }

    function revealMaskedNode(textNode, buttonNode) {
        const ip = textNode.getAttribute(ORIGINAL_ATTR);
        if (!ip) return;

        textNode.textContent = ip;
        buttonNode.textContent = '🙈';
        buttonNode.title = 'Hide IP';
        buttonNode.setAttribute('aria-label', 'Hide IP');

        if (CONFIG.AUTO_HIDE_SECONDS > 0) {
            const token = String(Date.now());
            textNode.dataset.atlasRevealToken = token;

            window.setTimeout(() => {
                if (textNode.dataset.atlasRevealToken === token) {
                    hideMaskedNode(textNode, buttonNode);
                }
            }, CONFIG.AUTO_HIDE_SECONDS * 1000);
        }
    }

    function hideMaskedNode(textNode, buttonNode) {
        const ip = textNode.getAttribute(ORIGINAL_ATTR);
        if (!ip) return;

        textNode.textContent = maskForIP(ip);
        buttonNode.textContent = '👁';
        buttonNode.title = 'Reveal IP temporarily';
        buttonNode.setAttribute('aria-label', 'Reveal IP temporarily');
        delete textNode.dataset.atlasRevealToken;
    }

    function setAllMaskedNodesVisibility(hidden) {
        document.querySelectorAll(`[${MASK_ATTR}="true"]`).forEach(node => {
            const textNode = node;
            const wrapper = textNode.closest(`[${WRAPPER_ATTR}="true"]`);
            const buttonNode = wrapper ? wrapper.querySelector(`[${BUTTON_ATTR}="true"]`) : null;

            if (!buttonNode) return;
            if (hidden) hideMaskedNode(textNode, buttonNode);
            else revealMaskedNode(textNode, buttonNode);
        });
    }

    function rememberOriginalAttr(el, attr, value) {
        let tracked = attrOriginalMap.get(el);
        if (!tracked) {
            tracked = new Map();
            attrOriginalMap.set(el, tracked);
        }
        if (!tracked.has(attr)) tracked.set(attr, value);
    }

    function restoreAttributes(root) {
        if (!root || root.nodeType !== Node.ELEMENT_NODE) return;
        const elements = [root, ...root.querySelectorAll('*')];

        for (const el of elements) {
            const tracked = attrOriginalMap.get(el);
            if (!tracked) continue;
            tracked.forEach((value, attr) => el.setAttribute(attr, value));
        }
    }

    function replaceTextNode(textNode) {
        const text = textNode.nodeValue;
        if (!text || !text.trim()) return;

        const parent = textNode.parentElement;
        if (!parent || shouldSkipElement(parent)) return;

        const matches = findIPs(text);
        if (!matches.length) return;

        const frag = document.createDocumentFragment();
        let cursor = 0;

        for (const match of matches) {
            if (match.index > cursor) {
                frag.appendChild(document.createTextNode(text.slice(cursor, match.index)));
            }

            frag.appendChild(createMaskedNode(match.ip));
            cursor = match.end;
        }

        if (cursor < text.length) {
            frag.appendChild(document.createTextNode(text.slice(cursor)));
        }

        textNode.replaceWith(frag);
        log('Masked:', text);
    }

    function maskTextNodes(root) {
        if (!root) return;

        if (root.nodeType === Node.TEXT_NODE) {
            replaceTextNode(root);
            return;
        }

        if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
        if (root.nodeType === Node.ELEMENT_NODE && shouldSkipElement(root)) return;

        const walker = document.createTreeWalker(
            root,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode(node) {
                    const parent = node.parentElement;

                    if (!parent || shouldSkipElement(parent)) {
                        return NodeFilter.FILTER_REJECT;
                    }

                    const value = node.nodeValue;

                    if (!value || (!value.includes('.') && !value.includes(':'))) {
                        return NodeFilter.FILTER_REJECT;
                    }

                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );

        const nodes = [];
        let node;

        while ((node = walker.nextNode())) {
            nodes.push(node);
        }

        nodes.forEach(replaceTextNode);
    }

    function maskAttributes(root) {
        if (!root || root.nodeType !== Node.ELEMENT_NODE) return;

        const attrs = [
            'title',
            'aria-label',
            'placeholder',
            'data-tooltip',
            'data-original-title',
        ];

        const elements = [root, ...root.querySelectorAll('*')];

        for (const el of elements) {
            if (shouldSkipElement(el)) continue;

            for (const attr of attrs) {
                const value = el.getAttribute(attr);
                if (!value) continue;

                const matches = findIPs(value);
                if (!matches.length) continue;
                rememberOriginalAttr(el, attr, value);

                let newValue = value;

                for (const match of matches) {
                    newValue = newValue.replaceAll(match.ip, maskForIP(match.ip));
                }

                el.setAttribute(attr, newValue);
            }
        }
    }

    function scan(root = document.body) {
        if (!obfuscationEnabled) return;
        if (!root) return;

        try {
            maskTextNodes(root);

            if (root.nodeType === Node.ELEMENT_NODE) {
                maskAttributes(root);
            } else if (document.body) {
                maskAttributes(document.body);
            }
        } catch (err) {
            console.warn('[UniFi IP Mask] scan failed:', err);
        }
    }

    /************************************************************
     * Click pre-hide
     ************************************************************/

    function markClickPrehideWindow() {
        clickPrehideUntil = Date.now() + CONFIG.CLICK_PREHIDE_WINDOW_MS;
    }

    window.addEventListener('pointerdown', markClickPrehideWindow, true);
    window.addEventListener('mousedown', markClickPrehideWindow, true);
    window.addEventListener('click', markClickPrehideWindow, true);

    /************************************************************
     * Mutation observer
     ************************************************************/

    function handleAddedNode(node) {
        if (!node) return;
        if (!obfuscationEnabled) return;

        const now = Date.now();
        const inClickPrehideWindow = now < clickPrehideUntil;

        let shouldHold = false;

        if (node.nodeType === Node.TEXT_NODE) {
            if (containsMaskableIPText(node)) {
                const holdTarget = getHoldTarget(node);
                holdTemporarily(holdTarget);
                replaceTextNode(node);
            }

            return;
        }

        if (node.nodeType !== Node.ELEMENT_NODE) return;
        if (shouldSkipElement(node)) return;

        if (inClickPrehideWindow && looksLikeRiskyPanel(node)) {
            shouldHold = true;
        }

        if (!shouldHold && containsMaskableIPText(node)) {
            shouldHold = true;
        }

        const holdTarget = shouldHold ? getHoldTarget(node) : null;

        if (holdTarget) {
            holdTemporarily(holdTarget);
        }

        scan(node);
    }

    function startObserver() {
        if (!document.body) {
            window.setTimeout(startObserver, 20);
            return;
        }

        scan(document.body);

        const observer = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                if (mutation.type === 'characterData') {
                    const node = mutation.target;

                    if (containsMaskableIPText(node)) {
                        if (!obfuscationEnabled) continue;
                        const holdTarget = getHoldTarget(node);
                        holdTemporarily(holdTarget);
                        replaceTextNode(node);
                    }

                    continue;
                }

                if (mutation.type === 'childList') {
                    for (const node of mutation.addedNodes) {
                        handleAddedNode(node);
                    }
                }
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true,
        });

        // Startup/render settling scans.
        [50, 100, 250, 500, 1000, 2000, 4000].forEach(ms => {
            window.setTimeout(() => scan(document.body), ms);
        });

        log('Started v3.0.0');
    }

    function loadObfuscationState() {
        try {
            if (typeof GM_getValue === 'function') {
                return Boolean(GM_getValue(STORAGE_KEY, true));
            }
        } catch {}
        return true;
    }

    function saveObfuscationState(value) {
        try {
            if (typeof GM_setValue === 'function') {
                GM_setValue(STORAGE_KEY, Boolean(value));
            }
        } catch {}
    }

    function applyObfuscationState() {
        if (!document.body) return;
        if (obfuscationEnabled) {
            setAllMaskedNodesVisibility(true);
            scan(document.body);
        } else {
            setAllMaskedNodesVisibility(false);
            restoreAttributes(document.body);
        }

        const button = document.getElementById(GLOBAL_TOGGLE_ID);
        if (button) {
            button.textContent = obfuscationEnabled ? 'Hidden' : 'Visible';
            button.title = obfuscationEnabled ? 'Obfuscation ON (click to show values)' : 'Obfuscation OFF (click to hide values)';
            button.setAttribute('aria-label', button.title);
        }
    }

    function ensureGlobalToggleButton() {
        if (!document.body || document.getElementById(GLOBAL_TOGGLE_ID)) return;

        const button = document.createElement('button');
        button.id = GLOBAL_TOGGLE_ID;
        button.type = 'button';
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            obfuscationEnabled = !obfuscationEnabled;
            saveObfuscationState(obfuscationEnabled);
            applyObfuscationState();
        }, true);

        document.body.appendChild(button);
        applyObfuscationState();
    }

    obfuscationEnabled = loadObfuscationState();
    window.setInterval(ensureGlobalToggleButton, 1000);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            ensureGlobalToggleButton();
            startObserver();
        }, { once: true });
    } else {
        ensureGlobalToggleButton();
        startObserver();
    }
})();
