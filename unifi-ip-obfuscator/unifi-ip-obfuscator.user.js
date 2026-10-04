// ==UserScript==
// @name         UniFi Stream Privacy - Public IP Masker
// @namespace    atlas.unifi.privacy
// @version      3.1.0
// @description  Masks public WAN IPs in UniFi and exports rendered table rows locally as CSV or JSON.
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
    const EXPORT_ATTR = 'data-atlas-table-export';

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

            [${EXPORT_ATTR}] {
                position: relative;
                margin: 4px 0;
                font: 12px/1.5 system-ui, sans-serif;
                color: inherit;
            }
            [${EXPORT_ATTR}] > summary { cursor: pointer; width: fit-content; }
            [${EXPORT_ATTR}] > div {
                padding: 10px;
                border: 1px solid #888;
                border-radius: 4px;
                max-width: 560px;
            }
            [${EXPORT_ATTR}] p { margin: 4px 0; white-space: pre-line; }
            [${EXPORT_ATTR}] button, [${EXPORT_ATTR}] select { margin: 4px; font: inherit; }
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
        if (el.closest(`[${EXPORT_ATTR}]`)) return true;

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
     * Local table export: semantic DOM only, never application state/API.
     * Add a UniFi-specific adapter only after inspecting sanitized DOM.
     ************************************************************/

    const TABLE_SELECTOR = 'table, [role="table"], [role="grid"]';
    const ROW_SELECTOR = 'tr, [role="row"]';
    const CELL_SELECTOR = 'th, td, [role="columnheader"], [role="rowheader"], [role="cell"], [role="gridcell"]';
    const EXPORT_IGNORE = 'button, [role="button"], input, select, textarea, [role="checkbox"], '
        + 'script, style, noscript, svg, canvas, [role="presentation"], [role="img"], '
        + `[${BUTTON_ATTR}], [${EXPORT_ATTR}]`;

    function maskExportText(value) {
        let cursor = 0;
        let result = '';
        for (const match of findIPs(value)) {
            result += value.slice(cursor, match.index) + maskForIP(match.ip);
            cursor = match.end;
        }
        return result + value.slice(cursor);
    }

    function hasMaskPlaceholder(value) {
        return [CONFIG.IPV4_MASK, CONFIG.IPV6_MASK, 'xx:xx:xx:xx:xx:xx'].some(mask => value.includes(mask));
    }

    function exportContext(mode) {
        return { mode, unavailable: new Set(), visibility: new WeakMap() };
    }

    // "Rendered" means mounted and not CSS/ARIA-hidden, including offscreen rows.
    // No scroll/pagination automation; client rectangles cannot prove completeness.
    function exportVisible(el, context) {
        if (!el || el === document.documentElement) return true;
        if (context.visibility.has(el)) return context.visibility.get(el);
        const style = window.getComputedStyle(el);
        const visible = !el.hidden && el.getAttribute('aria-hidden') !== 'true'
            && style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse'
            && exportVisible(el.parentElement, context);
        context.visibility.set(el, visible);
        return visible;
    }

    function exportValue(value, context) {
        if (context.mode === 'masked') return maskExportText(value);
        if (hasMaskPlaceholder(value)) context.unavailable.add('Some values are already redacted without a retained original.');
        return value;
    }

    function exportAttribute(el, name, context) {
        const value = el.getAttribute(name) || '';
        // The masker's attribute map retains the first value, which may be stale
        // after SPA reuse. Do not claim that it is a reliable current original.
        if (context.mode === 'original' && attrOriginalMap.get(el)?.has(name) && hasMaskPlaceholder(value)) {
            context.unavailable.add('An attribute was masked; its current original cannot be verified.');
        }
        return exportValue(value, context);
    }

    function exportCellText(node, context, stateColumn = false) {
        if (node.nodeType === Node.TEXT_NODE) return exportValue(node.nodeValue || '', context);
        if (node.nodeType !== Node.ELEMENT_NODE || !exportVisible(node, context)) return '';
        if (node.matches(`[${MASK_ATTR}="true"]`)) {
            const original = node.getAttribute(ORIGINAL_ATTR);
            const text = node.textContent || '';
            if (original && (isIPv4(original) || isIPv6(original) || isMacAddress(original))
                && (text === original || text === maskForIP(original))) {
                return context.mode === 'masked' ? maskExportText(original) : original;
            }
            context.unavailable.add('A masked field has no reliable retained original.');
            return exportValue(text, context);
        }
        const role = node.getAttribute('role');
        if (stateColumn && (role === 'img' || node.localName === 'svg')) {
            return exportAttribute(node, 'aria-label', context) || exportAttribute(node, 'title', context);
        }
        if (role === 'switch' || (stateColumn && (role === 'checkbox' || node.matches('input[type="checkbox"]')))) {
            const checked = node.matches('input[type="checkbox"]')
                ? (node.indeterminate ? 'mixed' : String(node.checked)) : node.getAttribute('aria-checked');
            if (!['true', 'false', 'mixed'].includes(checked)) throw new Error('A status control has no readable state.');
            return checked === 'true' ? 'Enabled' : checked === 'false' ? 'Disabled' : 'Mixed';
        }
        if (node.matches(EXPORT_IGNORE)) return '';
        if (node.tagName === 'BR') return '\n';
        // A sorting button may wrap an entire header label. Read its label only
        // in header extraction below; ordinary row action buttons are excluded.
        let result = '';
        for (const child of node.childNodes) {
            const value = exportCellText(child, context, stateColumn);
            if (!value) continue;
            if (child.nodeType === Node.ELEMENT_NODE && child.matches('div, p, li') && result && !result.endsWith('\n')) result += '\n';
            result += value;
        }
        if (!result.trim()) result = exportAttribute(node, 'aria-label', context);
        return result;
    }

    function exportHeaderText(cell, context) {
        const text = exportCellText(cell, context);
        if (text.trim()) return text;
        const sortButton = cell.querySelector('button, [role="button"]');
        if (!sortButton || !exportVisible(sortButton, context)) return '';
        // Recurse into children to continue excluding SVG/icon decoration.
        return Array.from(sortButton.childNodes, child => exportCellText(child, context)).join('')
            || exportAttribute(sortButton, 'aria-label', context);
    }

    function tableCells(row, table) {
        return Array.from(row.querySelectorAll(CELL_SELECTOR))
            .filter(cell => cell.closest(ROW_SELECTOR) === row && cell.closest(TABLE_SELECTOR) === table);
    }

    function checkSimpleCells(cells) {
        for (const [index, cell] of cells.entries()) {
            for (const attr of ['colspan', 'rowspan', 'aria-colspan', 'aria-rowspan']) {
                if (cell.hasAttribute(attr) && cell.getAttribute(attr) !== '1') {
                    throw new Error('Merged cells are not supported by the semantic table adapter.');
                }
            }
            if (cell.hasAttribute('aria-colindex') && Number(cell.getAttribute('aria-colindex')) !== index + 1) {
                throw new Error('Missing or reordered columns cannot be mapped reliably.');
            }
        }
    }

    function tableLabel(table, context, ordinal) {
        const labelledBy = (table.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
        const labels = labelledBy.map(id => document.getElementById(id)).filter(Boolean)
            .map(el => exportCellText(el, context)).filter(Boolean);
        const caption = table.querySelector('caption');
        return labels.join(' ') || exportAttribute(table, 'aria-label', context)
            || (caption && exportCellText(caption, context)) || `Table ${ordinal}`;
    }

    function tableFilters(table, context) {
        // Only explicit associations, and only search/select controls. Never read
        // arbitrary page inputs, credentials, route/query strings or app stores.
        const observed = [];
        if (table.id) {
            for (const el of document.querySelectorAll('input[type="search"][aria-controls], select[aria-controls]')) {
                if (!(el.getAttribute('aria-controls') || '').split(/\s+/).includes(table.id) || !exportVisible(el, context)) continue;
                const label = exportAttribute(el, 'aria-label', context)
                    || Array.from(el.labels || [], label => exportCellText(label, context)).join(' ') || 'Associated filter';
                const values = el.tagName === 'SELECT'
                    ? Array.from(el.selectedOptions, option => exportValue(option.textContent || '', context))
                    : [exportValue(el.value, context)];
                observed.push({ label, values });
            }
        }
        return { status: observed.length ? 'partially-observed' : 'unknown', observed,
            note: 'Only explicitly associated search/select controls are captured; other filters may apply.' };
    }

    function captureTable(table, mode = 'masked', ordinal = 1) {
        if (!['masked', 'original'].includes(mode)) throw new Error('Unknown privacy mode.');
        const context = exportContext(mode);
        if (table.closest(`[${HOLD_ATTR}]`) || table.querySelector(`[${HOLD_ATTR}]`)) throw new Error('Privacy masking is settling. Retry in a moment.');
        if (!table.isConnected || !exportVisible(table, context)) throw new Error('This table is no longer rendered.');
        if (table.closest('[aria-busy="true"]') || table.querySelector('[aria-busy="true"]')) throw new Error('The table is still loading. Retry after it settles.');
        if (table.querySelector(TABLE_SELECTOR)) throw new Error('Nested tables need a dedicated adapter.');
        const renderedRows = Array.from(table.querySelectorAll(ROW_SELECTOR))
            .filter(row => row.closest(TABLE_SELECTOR) === table && !row.closest('tfoot') && exportVisible(row, context));
        const headerRows = renderedRows.filter(row => tableCells(row, table).some(cell =>
            cell.matches('[role="columnheader"]') || (cell.tagName === 'TH' && cell.getAttribute('scope') !== 'row')));
        if (headerRows.length !== 1 || headerRows[0] !== renderedRows[0]) throw new Error('A single leading header row is required. A sanitized DOM sample is needed for this layout.');
        const headerCells = tableCells(headerRows[0], table);
        checkSimpleCells(headerCells);
        if (table.hasAttribute('aria-colcount') && Number(table.getAttribute('aria-colcount')) !== headerCells.length) {
            throw new Error('Not all declared columns are rendered.');
        }
        const headers = headerCells.map(cell => exportHeaderText(cell, context));
        const visibleColumns = headerCells.map(cell => exportVisible(cell, context));
        const rows = renderedRows.slice(1).map(row => {
            const cells = tableCells(row, table);
            checkSimpleCells(cells);
            if (cells.length !== headerCells.length || cells.some((cell, i) => exportVisible(cell, context) !== visibleColumns[i])) {
                throw new Error('Rows and headers do not align. Loading, grouped or virtualized columns need a dedicated adapter.');
            }
            return cells.map((cell, i) => exportCellText(cell, context, /^(enabled|status|active)$/i.test(headers[i].trim())));
        });
        const dataCells = renderedRows.slice(1).map(row => tableCells(row, table));
        const columns = headers.map((header, i) => ({ header, i })).filter(({ header, i }) => {
            if (!visibleColumns[i]) return false;
            const values = rows.map(row => row[i]);
            // Exclude action/selection columns even when their header is labelled.
            const controlsOnly = dataCells.length > 0 && dataCells.every((cells, rowIndex) =>
                !values[rowIndex].trim() && cells[i].querySelector(EXPORT_IGNORE));
            if (controlsOnly) return false;
            return header.trim() || values.some(value => value.trim());
        });
        if (!columns.length) throw new Error('No exportable columns were found.');
        if (columns.some(({ header }) => !header.trim())) throw new Error('A data column has no readable header.');
        const integerAttribute = (el, name) => /^-?\d+$/.test(el.getAttribute(name) || '') ? Number(el.getAttribute(name)) : null;
        const rowIndices = renderedRows.slice(1).map(row => integerAttribute(row, 'aria-rowindex'));
        const rowCount = integerAttribute(table, 'aria-rowcount');
        const payload = {
            schemaVersion: 1,
            capturedAt: new Date().toISOString(),
            table: { label: tableLabel(table, context, ordinal), ordinal, adapter: 'semantic-table-v1' },
            privacy: { mode, maskingEnabled: obfuscationEnabled,
                note: mode === 'masked' ? 'Uses the existing IP/MAC masking rules. DNS names and private IPs may remain visible.' : 'Original values for private inventory; do not share publicly.' },
            scope: 'rendered-rows',
            exportedRowCount: rows.length,
            filters: tableFilters(table, context),
            pagination: { status: 'unknown', note: 'Only currently mounted rows are captured; no pages are fetched.' },
            virtualization: { status: rowIndices.some(Boolean) || rowCount !== null ? 'possible' : 'unknown',
                declaredAriaRowCount: rowCount, renderedAriaRowIndices: rowIndices,
                note: 'ARIA counts/indices are hints, may include headers, and do not prove completeness.' },
            completeness: { complete: false, status: 'unverified',
                reason: 'Rendered rows only. The full filtered result and full dataset cannot be verified by this adapter.' },
            headers: columns.map(({ header }) => header),
            rows: rows.map(row => columns.map(({ i }) => row[i])),
        };
        // Apply policy once more to whole strings (including text split across
        // DOM nodes) and metadata; temporary eye reveals never bypass masking.
        function sanitize(value) {
            if (typeof value === 'string') return exportValue(value, context);
            if (Array.isArray(value)) return value.map(sanitize);
            if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sanitize(entry)]));
            return value;
        }
        const result = sanitize(payload);
        if (mode === 'original' && context.unavailable.size) {
            throw new Error(`Original values unavailable: ${Array.from(context.unavailable).join(' ')} Use a masked export.`);
        }
        return result;
    }

    function csvCell(value) {
        const text = String(value);
        // Quote every cell and neutralize formulas even behind whitespace/control
        // characters. JSON retains the exact extracted value without this prefix.
        const safe = /^[\s\u0000-\u001f\u007f-\u009f]*[=+\-@]/u.test(text) || /^[\t\r\n]/.test(text) ? `'${text}` : text;
        return `"${safe.replaceAll('"', '""')}"`;
    }

    function tableCSV(payload) {
        return [payload.headers, ...payload.rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
    }

    function downloadTable(payload, format) {
        const content = format === 'csv' ? '\uFEFF' + tableCSV(payload) : JSON.stringify(payload, null, 2) + '\n';
        const blob = new Blob([content], { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        // Fixed prefix + local ordinal, never table labels, accounts or URL paths.
        link.download = `unifi-table-${payload.table.ordinal}-rendered-${payload.exportedRowCount}-${payload.privacy.mode}-${payload.capturedAt.replaceAll(/[:.]/g, '-')}.${format}`;
        link.href = url;
        link.hidden = true;
        document.body.appendChild(link);
        try { link.click(); } finally {
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
    }

    function createExportControl(table, ordinal) {
        const control = document.createElement('details');
        control.setAttribute(EXPORT_ATTR, 'true');
        const summary = document.createElement('summary');
        summary.textContent = 'Export';
        summary.setAttribute('aria-label', `Export table ${ordinal}`);
        const panel = document.createElement('div');
        const status = document.createElement('p');
        status.setAttribute('role', 'status');
        const scope = document.createElement('p');
        scope.textContent = 'Rendered rows only; filtered results, pagination and virtualized rows may be incomplete.';
        const label = document.createElement('label');
        label.textContent = 'Values: ';
        const mode = document.createElement('select');
        for (const [value, text] of [['masked', 'Masked (existing IP/MAC rules)'], ['original', 'Original values — private inventory']]) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = text;
            mode.appendChild(option);
        }
        label.appendChild(mode);
        const warning = document.createElement('p');
        warning.textContent = 'Masked exports can still contain DNS names and private IPs. Original exports contain sensitive values; keep them private. Originals must be available without revealing them onscreen.';
        panel.append(status, scope, label, warning);
        const buttons = [];
        function refresh() {
            try {
                const preview = captureTable(table, 'masked', ordinal);
                // Do not echo names/values into the control, even for originals.
                status.textContent = `Table ${ordinal}: ${preview.exportedRowCount} rendered rows available; completeness unverified.`;
                buttons.forEach(button => { button.disabled = false; });
            } catch (error) {
                status.textContent = error.message;
                buttons.forEach(button => { button.disabled = true; });
            }
        }
        for (const format of ['csv', 'json']) {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = format.toUpperCase();
            button.addEventListener('click', event => {
                event.preventDefault();
                try {
                    if (mode.value === 'original' && !window.confirm('Export original values for private inventory? This file may contain sensitive IP/MAC addresses and DNS names. Keep it private. The screen will remain masked.')) return;
                    const payload = captureTable(table, mode.value, ordinal);
                    downloadTable(payload, format);
                    status.textContent = `Downloaded ${payload.exportedRowCount} rendered rows (${payload.privacy.mode}); completeness unverified.`;
                } catch (error) {
                    status.textContent = error.message;
                } finally {
                    mode.value = 'masked';
                }
            });
            buttons.push(button);
            panel.appendChild(button);
        }
        control.append(summary, panel);
        control.addEventListener('toggle', () => {
            mode.value = 'masked';
            if (control.open) refresh();
        });
        // Avoid application row/navigation handlers; never change UniFi controls.
        for (const name of ['click', 'pointerdown', 'mousedown', 'change']) control.addEventListener(name, event => event.stopPropagation());
        return control;
    }

    function startTableExports() {
        const controls = new Map();
        const pending = new Set();
        let ordinal = 0;
        let timer = null;
        function ensure(table) {
            if (!table.isConnected || table.closest(`[${EXPORT_ATTR}]`) || table.parentElement?.closest(TABLE_SELECTOR)) return;
            if (!controls.has(table)) controls.set(table, createExportControl(table, ++ordinal));
            const control = controls.get(table);
            if (control.nextElementSibling !== table) table.before(control);
            const hidden = !exportVisible(table, exportContext('masked'));
            if (control.hidden !== hidden) control.hidden = hidden;
        }
        function flush() {
            timer = null;
            for (const [table, control] of controls) {
                if (!table.isConnected || !table.matches(TABLE_SELECTOR) || table.parentElement?.closest(TABLE_SELECTOR)) {
                    control.remove();
                    controls.delete(table);
                } else ensure(table);
            }
            for (const root of pending) {
                if (!root.isConnected) continue;
                if (root.matches(TABLE_SELECTOR)) ensure(root);
                root.querySelectorAll(TABLE_SELECTOR).forEach(ensure);
            }
            pending.clear();
        }
        function queue(node) {
            if (node.nodeType !== Node.ELEMENT_NODE || node.closest(`[${EXPORT_ATTR}], [${WRAPPER_ATTR}]`)) return;
            const table = node.closest(TABLE_SELECTOR);
            if (table && controls.has(table)) return;
            for (const root of pending) if (root.contains(node)) return;
            for (const root of pending) if (node.contains(root)) pending.delete(root);
            pending.add(node);
        }
        // One initial discovery; later discovery is limited to added subtrees.
        queue(document.body);
        flush();
        const observer = new MutationObserver(mutations => {
            let changed = false;
            for (const mutation of mutations) {
                if (mutation.target.nodeType === Node.ELEMENT_NODE && mutation.target.closest(`[${EXPORT_ATTR}]`)) continue;
                // Visibility changes only refresh registered controls, without
                // scanning the changed subtree (e.g. a page-wide theme class).
                if (mutation.type === 'attributes' && mutation.attributeName === 'role') queue(mutation.target);
                for (const node of mutation.addedNodes) queue(node);
                changed = true;
            }
            if (changed && timer === null) timer = window.setTimeout(flush, 100);
        });
        observer.observe(document.body, { childList: true, subtree: true, attributes: true,
            attributeFilter: ['role', 'hidden', 'aria-hidden', 'style', 'class', HOLD_ATTR] });
        // Returning cleanup also makes the lifecycle independently testable.
        return () => {
            observer.disconnect();
            window.clearTimeout(timer);
            controls.forEach(control => control.remove());
            controls.clear();
            pending.clear();
        };
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

        startTableExports();
        log('Started v3.1.0');
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
