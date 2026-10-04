'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '../unifi-ip-obfuscator/unifi-ip-obfuscator.user.js'), 'utf8');
const expose = `
    window.testAPI = { captureTable, tableCSV, csvCell, scan, startTableExports,
        createMaskedNode, revealMaskedNode, hideMaskedNode, findIPs, downloadTable,
        setEnabled(value) { obfuscationEnabled = value; applyObfuscationState(); },
        getEnabled() { return obfuscationEnabled; },
        setPrivate(value) { CONFIG.MASK_PRIVATE_IPS = value; }
    };
`;
function fixture(t, html, { boot = false, storedState = true } = {}) {
    const dom = new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`, {
        url: 'https://example.test/network', runScripts: 'outside-only', pretendToBeVisual: true,
    });
    t.after(() => dom.window.close());
    const { window } = dom;
    window.GM_getValue = () => storedState;
    window.GM_setValue = () => {};
    window.fetch = () => { throw new Error('Unexpected network request'); };
    window.XMLHttpRequest = class { constructor() { throw new Error('Unexpected network request'); } };
    const marker = '    obfuscationEnabled = loadObfuscationState();';
    assert.equal(source.split(marker).length, 2);
    window.eval(boot ? source.replace(marker, expose + marker) : source.slice(0, source.indexOf(marker)) + expose + '\n})();');
    return { window, document: window.document, api: window.testAPI, table: window.document.querySelector('table, [role="grid"], [role="table"]') };
}
const plain = value => JSON.parse(JSON.stringify(value));
const tick = (window, ms = 160) => new Promise(resolve => window.setTimeout(resolve, ms));
const dns = `<section>
    <h2 id="dns-title">DNS records</h2>
    <input type="search" aria-label="Search records" aria-controls="dns" value="example.test">
    <select aria-label="Record type" aria-controls="dns"><option selected>A</option><option>CNAME</option></select>
    <table id="dns" aria-labelledby="dns-title">
      <thead><tr><th><input type="checkbox" aria-label="Select all"></th><th>Name</th><th>Type</th><th>Target</th><th>Enabled</th><th>TTL</th><th>Actions</th></tr></thead>
      <tbody>
        <tr><td><input type="checkbox" checked></td><td>gateway.example.test</td><td>Host (A)</td><td>198.51.100.10</td><td><button role="switch" aria-checked="true"><svg></svg></button></td><td>Auto</td><td><button>Edit</button></td></tr>
        <tr><td><input type="checkbox"></td><td>alias.example.test</td><td>CNAME</td><td>gateway.example.test</td><td><span role="switch" aria-checked="false"></span></td><td>300</td><td><button>Delete</button></td></tr>
      </tbody>
    </table>
</section>`;
const simple = (value = 'example.test') => `<table><thead><tr><th>Name</th></tr></thead><tbody><tr><td>${value}</td></tr></tbody></table>`;

test('extracts DNS fields and semantic status; excludes selection, action and icon decoration', t => {
    const { api, table } = fixture(t, dns);
    const data = plain(api.captureTable(table));
    assert.deepEqual(data.headers, ['Name', 'Type', 'Target', 'Enabled', 'TTL']);
    assert.deepEqual(data.rows, [
        ['gateway.example.test', 'Host (A)', '198.51.100.10', 'Enabled', 'Auto'],
        ['alias.example.test', 'CNAME', 'gateway.example.test', 'Disabled', '300'],
    ]);
    assert.equal(data.table.label, 'DNS records');
    assert.equal(data.exportedRowCount, 2);
    assert.equal(data.scope, 'rendered-rows');
    assert.equal(data.completeness.complete, false);
    assert.equal(data.filters.status, 'partially-observed');
    assert.deepEqual(data.filters.observed, [
        { label: 'Search records', values: ['example.test'] }, { label: 'Record type', values: ['A'] },
    ]);
    assert.equal(new Date(data.capturedAt).toISOString(), data.capturedAt);
});

test('ARIA grid, sorting headers, row headers, multiline values and duplicate headers retain their positions', t => {
    const { api, table } = fixture(t, `<div role="grid" aria-label="DNS" aria-colcount="3">
      <div role="row"><div role="columnheader"><button>Name<svg><title>sort icon</title></svg></button></div><div role="columnheader">Target</div><div role="columnheader">Target</div></div>
      <div role="row"><div role="rowheader">txt.example.test</div><div role="gridcell">line one<br>line two</div><div role="gridcell"><div>first</div><div>second</div></div></div>
    </div>`);
    const data = plain(api.captureTable(table));
    assert.deepEqual(data.headers, ['Name', 'Target', 'Target']);
    assert.deepEqual(data.rows, [['txt.example.test', 'line one\nline two', 'first\nsecond']]);
});

test('native status checkboxes are values; row selection checkboxes remain excluded', t => {
    const { api, table } = fixture(t, `<table><tr><th>Select</th><th>Name</th><th>Status</th></tr>
      <tr><td><input type="checkbox"></td><td>example.test</td><td><input type="checkbox" checked></td></tr></table>`);
    assert.deepEqual(plain(api.captureTable(table).rows), [['example.test', 'Enabled']]);
});

test('accessible status icons are retained without decorative icons from other columns', t => {
    const { api, table } = fixture(t, `<table><tr><th>Name</th><th>Status</th></tr>
      <tr><td><svg aria-label="decoration"></svg>example.test</td><td><span role="img" aria-label="Enabled"></span></td></tr>
      <tr><td>other.example.test</td><td><svg aria-label="Disabled"></svg></td></tr></table>`);
    assert.deepEqual(plain(api.captureTable(table).rows), [['example.test', 'Enabled'], ['other.example.test', 'Disabled']]);
});

test('hidden rows/columns and table footers are excluded; rendered rows can be offscreen', t => {
    const { api, table } = fixture(t, `<table><tr><th>Name</th><th hidden>Secret</th></tr>
      <tr><td>example.test</td><td hidden>omitted</td></tr>
      <tr style="display:none"><td>hidden.example.test</td><td hidden>omitted</td></tr>
      <tr aria-hidden="true"><td>aria.example.test</td><td hidden>omitted</td></tr>
      <tr style="position:absolute;top:10000px"><td>offscreen.example.test</td><td hidden>omitted</td></tr>
      <tfoot><tr><td>Total</td><td hidden>omitted</td></tr></tfoot></table>`);
    const data = plain(api.captureTable(table));
    assert.deepEqual(data.headers, ['Name']);
    assert.deepEqual(data.rows, [['example.test'], ['offscreen.example.test']]);
    assert.equal(data.completeness.complete, false);
});

test('empty table is a zero-row snapshot, never a complete dataset', t => {
    const { api, table } = fixture(t, '<table><tr><th>Name</th><th>Target</th></tr></table>');
    const data = api.captureTable(table);
    assert.equal(data.exportedRowCount, 0);
    assert.equal(data.completeness.complete, false);
    assert.equal(data.filters.status, 'unknown');
    assert.equal(data.pagination.status, 'unknown');
});

test('virtualization hints and even matching ARIA counts cannot promote a snapshot to all rows', t => {
    const { api, table } = fixture(t, simple());
    for (const count of ['-1', '2', '1000']) {
        table.setAttribute('aria-rowcount', count);
        table.querySelector('tbody tr').setAttribute('aria-rowindex', '20');
        const data = plain(api.captureTable(table));
        assert.equal(data.completeness.complete, false);
        assert.equal(data.virtualization.status, 'possible');
        assert.equal(data.virtualization.declaredAriaRowCount, Number(count));
        assert.deepEqual(data.virtualization.renderedAriaRowIndices, [20]);
        assert.equal(data.exportedRowCount, 1);
    }
});

test('ambiguous, loading, nested and incomplete column layouts fail without silently truncating', t => {
    const cases = [
        ['<table><tr><td>no headers</td></tr></table>', /header row/],
        ['<table><tr><th>A</th><th>B</th></tr><tr><td>short row</td></tr></table>', /do not align/],
        ['<table><tr><th colspan="2">Name</th></tr></table>', /Merged cells/],
        ['<table><tr><th>Name</th></tr><tr><td><table></table></td></tr></table>', /Nested tables/],
        ['<table aria-colcount="8"><tr><th>Name</th></tr></table>', /declared columns/],
        ['<table><tr><th aria-colindex="2">Name</th></tr></table>', /reordered columns/],
        ['<table aria-busy="true"><tr><th>Name</th></tr></table>', /still loading/],
        ['<table><tr><th>Name</th></tr><tr><th>second header</th></tr></table>', /single leading/],
        ['<table><tr><th></th></tr><tr><td>unlabelled</td></tr></table>', /no readable header/],
    ];
    for (const [html, error] of cases) {
        const { api, table } = fixture(t, html);
        assert.throws(() => api.captureTable(table), error);
    }
});

test('masked and original exports never toggle masking or mutate/reveal the source DOM', t => {
    const { api, table, document } = fixture(t, simple('8.8.8.8 / 2606:4700:4700::1111 / 02:00:00:00:00:01'));
    api.scan(document.body);
    const before = table.outerHTML;
    const masked = api.captureTable(table);
    assert.deepEqual(plain(masked.rows), [['xxx.xxx.xxx.xxx / xxxx:xxxx:xxxx:xxxx / xx:xx:xx:xx:xx:xx']]);
    assert.equal(api.captureTable(table, 'original').rows[0][0], '8.8.8.8 / 2606:4700:4700::1111 / 02:00:00:00:00:01');
    assert.equal(table.outerHTML, before);
    assert.equal(api.getEnabled(), true);
    const field = table.querySelector('[data-atlas-ip-mask]');
    api.revealMaskedNode(field, field.nextElementSibling);
    assert.match(table.textContent, /8\.8\.8\.8/);
    assert.equal(api.captureTable(table).rows[0][0], masked.rows[0][0]);
});

test('exports follow existing private-IP configuration and default to masked even with masking off', t => {
    const { api, table } = fixture(t, simple('8.8.8.8 198.51.100.10 2001:db8::10'));
    api.setEnabled(false);
    assert.equal(api.captureTable(table).privacy.mode, 'masked');
    assert.equal(api.captureTable(table).privacy.maskingEnabled, false);
    assert.equal(api.captureTable(table).rows[0][0], 'xxx.xxx.xxx.xxx 198.51.100.10 2001:db8::10');
    assert.equal(api.captureTable(table, 'original').rows[0][0], '8.8.8.8 198.51.100.10 2001:db8::10');
    api.setPrivate(true);
    assert.equal(api.captureTable(table).rows[0][0], 'xxx.xxx.xxx.xxx xxx.xxx.xxx.xxx xxxx:xxxx:xxxx:xxxx');
});

test('missing retained originals block original exports, including masked attributes that may be stale', t => {
    const { api, table, document } = fixture(t, simple('8.8.8.8'));
    api.scan(document.body);
    table.querySelector('[data-atlas-ip-mask]').removeAttribute('data-atlas-original-ip');
    assert.throws(() => api.captureTable(table, 'original'), /Original values unavailable/);
    assert.equal(api.captureTable(table).rows[0][0], 'xxx.xxx.xxx.xxx');
    const second = fixture(t, '<table aria-label="8.8.8.8"><tr><th>Name</th></tr><tr><td>example.test</td></tr></table>');
    second.api.scan(second.document.body);
    assert.throws(() => second.api.captureTable(second.table, 'original'), /attribute was masked/);
    assert.equal(second.api.captureTable(second.table).table.label, 'xxx.xxx.xxx.xxx');
});

test('redacted values without wrappers are not invented; split text and metadata are masked', t => {
    const { api, table, document } = fixture(t, `<input type="search" aria-controls="records" value="8.8.8.8">
      <input type="password" value="synthetic-credential-must-not-export">
      <input type="text" aria-controls="records" value="unrelated-text-must-not-export">
      <h2 id="title">DNS <span>8.8.</span><span>8.8</span></h2>
      <table id="records" aria-labelledby="title"><tr><th>8.8.8.8</th></tr><tr><td><span>8.8.</span><span>8.8</span></td></tr></table>`);
    const data = api.captureTable(table);
    const json = JSON.stringify(data);
    assert.doesNotMatch(json, /8\.8\.8\.8|synthetic-credential|unrelated-text/);
    assert.equal(data.table.label, 'DNS xxx.xxx.xxx.xxx');
    document.querySelector('td').textContent = 'xxx.xxx.xxx.xxx';
    assert.throws(() => api.captureTable(table, 'original'), /already redacted/);
});

test('a reused mask span with contradictory text is not exported as a stale original', t => {
    const { api, table, document } = fixture(t, simple('8.8.8.8'));
    api.scan(document.body);
    table.querySelector('[data-atlas-ip-mask]').textContent = '1.1.1.1';
    assert.throws(() => api.captureTable(table, 'original'), /no reliable retained original/);
    assert.equal(api.captureTable(table).rows[0][0], 'xxx.xxx.xxx.xxx');
});

test('CSV quotes commas, quotes, CRLF and formulas in headers and cells; JSON retains exact values', t => {
    const { api, table, document } = fixture(t, simple());
    const values = ['a,b', 'say "hello"', 'one\r\ntwo', '=SUM(1,2)', '+cmd', '-2', '@x', ' \u0000=1', '\ttext', '\rtext', '\ntext', '  exact spaces  '];
    assert.equal(api.csvCell('a,b'), '"a,b"');
    assert.equal(api.csvCell('say "hello"'), '"say ""hello"""');
    assert.equal(api.csvCell('one\r\ntwo'), '"one\r\ntwo"');
    for (const value of values.slice(3, 11)) assert.equal(api.csvCell(value), '"\'' + value.replaceAll('"', '""') + '"');
    document.querySelector('th').textContent = '=header';
    for (const value of values) {
        document.querySelector('td').textContent = value;
        const data = api.captureTable(table);
        assert.equal(JSON.parse(JSON.stringify(data)).rows[0][0], value);
        assert.equal(api.tableCSV(data), '"\'=header"\r\n' + api.csvCell(value) + '\r\n');
    }
});

test('existing masker still skips dates/times and private ranges; eye hide/reveal and toggle persist behavior', t => {
    const { api, document, table } = fixture(t, simple('today at 12:30 2026-10-03 198.51.100.10 8.8.8.8'));
    api.scan(document.body);
    assert.equal(table.querySelectorAll('[data-atlas-ip-mask]').length, 1);
    const field = table.querySelector('[data-atlas-ip-mask]');
    api.revealMaskedNode(field, field.nextElementSibling);
    assert.equal(field.textContent, '8.8.8.8');
    api.hideMaskedNode(field, field.nextElementSibling);
    assert.equal(field.textContent, 'xxx.xxx.xxx.xxx');
    api.setEnabled(false);
    assert.equal(field.textContent, '8.8.8.8');
    api.setEnabled(true);
    assert.equal(field.textContent, 'xxx.xxx.xxx.xxx');
    assert.match(table.textContent, /today at 12:30 2026-10-03 198\.51\.100\.10/);
});

test('SPA replacement, row recycling, multiple tables and removed controls do not duplicate or retain stale tables', async t => {
    const { api, document, window, table } = fixture(t, `<main>${simple('first.example.test')}${simple('second.example.test')}</main>`);
    const stop = api.startTableExports();
    const count = () => document.querySelectorAll('[data-atlas-table-export]').length;
    assert.equal(count(), 2);
    const firstControl = table.previousElementSibling;
    table.querySelector('td').textContent = 'recycled.example.test';
    await tick(window);
    assert.equal(count(), 2);
    assert.equal(table.previousElementSibling, firstControl);
    assert.equal(api.captureTable(table).rows[0][0], 'recycled.example.test');
    firstControl.remove();
    await tick(window);
    assert.equal(count(), 2);
    table.outerHTML = simple('replacement.example.test');
    await tick(window);
    assert.equal(count(), 2);
    assert.equal(firstControl.isConnected, false);
    assert.throws(() => api.captureTable(table), /no longer rendered/);
    document.querySelector('main').innerHTML = simple('new-route.example.test');
    await tick(window);
    assert.equal(count(), 1);
    stop();
    assert.equal(count(), 0);
});

test('new ARIA table roles are discovered; hidden tables and nested tables do not duplicate controls', async t => {
    const { api, document, window } = fixture(t, '<div id="later"><div role="row"><div role="columnheader">Name</div></div></div>');
    const stop = api.startTableExports();
    const later = document.getElementById('later');
    later.setAttribute('role', 'table');
    await tick(window);
    assert.equal(document.querySelectorAll('[data-atlas-table-export]').length, 1);
    later.hidden = true;
    await tick(window);
    assert.equal(later.previousElementSibling.hidden, true);
    later.hidden = false;
    await tick(window);
    assert.equal(later.previousElementSibling.hidden, false);
    later.insertAdjacentHTML('beforeend', simple());
    await tick(window);
    assert.equal(document.querySelectorAll('[data-atlas-table-export]').length, 1);
    stop();
});

test('controls recover from CSS/ancestor visibility changes and privacy holds without a rescan', async t => {
    const { api, table, document, window } = fixture(t, `<section>${simple()}</section>`);
    const stop = api.startTableExports();
    const control = table.previousElementSibling;
    const section = document.querySelector('section');
    const style = document.createElement('style');
    style.textContent = '.test-hidden { display: none; }';
    document.head.appendChild(style);
    section.className = 'test-hidden';
    await tick(window);
    assert.equal(control.hidden, true);
    section.className = '';
    await tick(window);
    assert.equal(control.hidden, false);
    table.style.display = 'none';
    await tick(window);
    assert.equal(control.hidden, true);
    table.style.display = '';
    table.setAttribute('data-atlas-privacy-hold', 'true');
    assert.throws(() => api.captureTable(table), /Privacy masking is settling/);
    await tick(window);
    table.removeAttribute('data-atlas-privacy-hold');
    await tick(window);
    assert.equal(control.hidden, false);
    assert.equal(table.previousElementSibling, control);
    stop();
});

function downloads(window) {
    const blobs = [];
    const files = [];
    const revoked = [];
    window.URL.createObjectURL = blob => { blobs.push(blob); return `blob:local-test-${blobs.length}`; };
    window.URL.revokeObjectURL = url => revoked.push(url);
    window.HTMLAnchorElement.prototype.click = function () { files.push({ filename: this.download, href: this.href }); };
    return { blobs, files, revoked };
}
function blobText(window, blob) {
    return new Promise((resolve, reject) => {
        const reader = new window.FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsText(blob);
    });
}

test('UI reports count/scope, confirms originals per export, resets privacy and downloads locally with safe filenames', async t => {
    const { api, table, window, document } = fixture(t, simple('8.8.8.8'));
    api.scan(document.body);
    const before = table.outerHTML;
    const captured = downloads(window);
    const stop = api.startTableExports();
    const control = table.previousElementSibling;
    control.open = true;
    await tick(window, 10);
    assert.match(control.textContent, /1 rendered rows available; completeness unverified/);
    const [csv, json] = control.querySelectorAll('button');
    const mode = control.querySelector('select');
    assert.equal(mode.value, 'masked');
    mode.value = 'original';
    window.confirm = () => false;
    json.click();
    assert.equal(captured.files.length, 0);
    assert.equal(mode.value, 'masked');
    mode.value = 'original';
    let confirmations = 0;
    window.confirm = text => { confirmations++; assert.match(text, /sensitive/); return true; };
    json.click();
    assert.equal(confirmations, 1);
    assert.equal(mode.value, 'masked');
    assert.equal(JSON.parse(await blobText(window, captured.blobs[0])).rows[0][0], '8.8.8.8');
    csv.click();
    assert.match(await blobText(window, captured.blobs[1]), /xxx\.xxx\.xxx\.xxx/);
    assert.equal(confirmations, 1);
    assert.match(captured.files[0].filename, /^unifi-table-1-rendered-1-original-\d{4}-.*\.json$/);
    assert.doesNotMatch(captured.files[0].filename, /example|8\.8|console|account/);
    assert.match(control.textContent, /Downloaded 1 rendered rows \(masked\); completeness unverified/);
    assert.equal(document.querySelector('a[download]'), null);
    assert.equal(table.outerHTML, before);
    await tick(window, 1050);
    assert.equal(captured.revoked.length, 2);
    stop();
});

test('download recaptures rows after rerender and refuses unavailable originals without a file', async t => {
    const { api, table, window } = fixture(t, simple());
    const captured = downloads(window);
    const stop = api.startTableExports();
    const control = table.previousElementSibling;
    control.open = true;
    await tick(window, 10);
    table.querySelector('td').textContent = 'new.example.test';
    control.querySelectorAll('button')[1].click();
    assert.equal(JSON.parse(await blobText(window, captured.blobs[0])).rows[0][0], 'new.example.test');
    table.querySelector('td').textContent = 'xxx.xxx.xxx.xxx';
    control.querySelector('select').value = 'original';
    window.confirm = () => true;
    control.querySelectorAll('button')[1].click();
    assert.equal(captured.files.length, 1);
    assert.match(control.textContent, /Original values unavailable/);
    assert.equal(control.querySelector('select').value, 'masked');
    stop();
});

test('full userscript startup retains stored mask state and initializes a single export control', async t => {
    const { document, api, window } = fixture(t, simple('8.8.8.8'), { boot: true, storedState: false });
    await tick(window, 350);
    assert.equal(api.getEnabled(), false);
    assert.equal(document.getElementById('atlas-unifi-obfuscation-toggle').textContent, 'Visible');
    assert.equal(document.querySelectorAll('[data-atlas-table-export]').length, 1);
    document.getElementById('atlas-unifi-obfuscation-toggle').click();
    await tick(window, 350);
    assert.equal(api.getEnabled(), true);
    assert.equal(document.querySelectorAll('[data-atlas-table-export]').length, 1);
    assert.equal(document.querySelector('[data-atlas-ip-mask]').textContent, 'xxx.xxx.xxx.xxx');
});
