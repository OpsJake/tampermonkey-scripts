# UniFi IP Obfuscator

This script hides/obfuscates sensitive UniFi dashboard information for screenshots, streams, and recordings.

It is intended for UniFi Network / UniFi OS dashboards.

## Version 3.1.0: local table export

An **Export** disclosure appears immediately before each semantic HTML table or
ARIA table/grid. Open it to see the currently rendered row count, choose values,
then select **CSV** or **JSON**. Each download captures the current DOM again.
The export control does not navigate, scroll, select rows, change filters or write
UniFi configuration. No new userscript grants or external requests are used.
Files are created locally using a Blob download; no export data is stored by the
script. Filenames contain a local table ordinal, rendered-row count, privacy
mode and UTC timestamp, with no console/account identifiers or table labels.

### Privacy

- Every export starts with **Masked**, including when the global toggle is
  `Visible`. The export follows the existing IP/MAC masking rules and configuration.
  Temporary eye-button reveals do not make a masked export reveal those values.
- Masking is **not full anonymization**: DNS names, record targets that are names,
  and private IP addresses remain intact by default, just as on the dashboard.
- **Original values — private inventory** is a per-export choice with a warning
  and confirmation. The choice resets after every attempt or reopening the menu.
  Original values come only from current readable DOM values and the masker's
  retained text originals. The export never toggles masking or reveals values in
  the page. Keep these files private.
- Missing text originals, recognizable redactions without originals, or masked
  attributes with potentially stale originals stop an original export with an
  explanation. They are not replaced with invented values. The script cannot
  reconstruct application-redacted data or values that were never rendered.

### Supported scope and limitations

This is a **semantic DOM adapter**, tested with synthetic DNS tables. On
2026-10-03, the owner reported **basic live table export success in UniFi**.
The remaining browser verification checks below are pending; the report does
not establish complete layout, privacy-mode or pagination/virtualization coverage.
A screenshot does not establish markup. A UniFi-specific adapter requires a small
sanitized DOM sample containing the container, one header row, one or two data
rows, status controls, and nearby filters/pagination. Use `example.test` and
documentation addresses, and remove identifiers and credentials before sharing.

- HTML `table` and ARIA `role="table"` / `role="grid"` need one leading header
  row and aligned cells. All mounted, non-hidden rows are captured, including
  offscreen/overscan rows; hidden rows and table footers are excluded.
- Headers and data preserve column order. Text and line breaks are retained;
  block children are separated by newlines. Selection checkboxes, action buttons
  and decorative elements are excluded. A sorting button can supply a header
  label. Text/accessible labels and `role="switch"` states are supported.
  In columns named `Enabled`, `Status` or `Active`, checkboxes and accessible
  status icons are also supported. Color-only status is not inferred.
- Merged cells, nested tables, multiple header rows, missing headers, mismatched
  columns, declared missing ARIA columns and loading states are rejected. Tables
  without semantic markup, CSS-only virtual columns, shadow roots and canvas
  renderers need separate evidence/adapters. Unsupported tables may show an
  Export control that explains why capture is unavailable.
- **Every export is rendered rows only, with completeness unverified.** Filtering
  may limit those rows; pagination may leave other pages absent; virtualization
  may leave most rows unmounted. Scrolling between exports produces independent
  snapshots; rows are never accumulated across views. Selection does not limit
  which rendered rows are exported. There is no all-rows option.
- JSON records capture time, table label (caption/accessible name or local
  ordinal), adapter, privacy mode, headers, positional row arrays, exported count,
  filters, pagination, virtualization hints and `completeness.complete: false`.
  Arrays preserve duplicate column labels. Only visible native search/select
  controls explicitly associated via `aria-controls` are observed as filters;
  filter coverage remains partial/unknown. ARIA row counts/indices are hints,
  not proof of completeness, and can include headers. URLs, document titles,
  application stores and unrelated input fields are not read for metadata.
- CSV contains only headers and rows. Every cell is quoted, quotes are doubled,
  multiline cells are retained, and records use CRLF with a UTF-8 BOM for
  spreadsheet compatibility. Formula-like cells (including headers and leading
  whitespace/control characters) receive a leading apostrophe. JSON retains
  extracted values without CSV formula neutralization, subject to the selected
  privacy mode. Use JSON for inventory fidelity and scope metadata.
- Table discovery runs once at startup, then uses a debounced observer on added
  subtrees and semantic visibility/role changes. Each table has one control;
  removed tables are released. Extraction runs on menu opening/download, not on
  a polling loop. Counts shown in an open menu are a preview; the download
  reports its freshly captured count. Existing masking scans remain in place.

### Validation

Run `npm ci --ignore-scripts`, `npm test` and `npm run check` from the repository
root. Tests use only synthetic example names/addresses. They cover HTML/ARIA
extraction, status controls, CSV escaping/formula safety, privacy modes and
missing originals, metadata boundaries, rerenders, multiple tables, local
downloads and partial-data handling. They also exercise existing masking,
eye reveal/hide and the stored global toggle. jsdom is a DOM simulation, not a
live browser or UniFi acceptance test. No real inventory exports belong in this
repository.

Basic live export is owner-reported as successful. The detailed browser checks
below remain pending and are to be performed by the operator separately:

1. In a private browser session using a reviewed test copy, visit Policy Engine
   DNS. Confirm a single Export control is associated with the table. Compare
   exported DNS names, record types, targets, enabled/status and other columns
   to the rendered rows. If there is no control or the layout is rejected,
   collect the sanitized DOM excerpt described above before claiming support.
2. Download CSV and JSON with masking enabled, including while one public IP is
   temporarily revealed. Confirm exports stay masked, eye buttons/selection/UI
   decoration are absent, the toggle setting is unchanged, and names/private
   addresses follow the documented policy. Use a private session for any reveal.
3. Choose original values, cancel once, then confirm a new original export.
   Verify the page stays masked, only available originals are exported and the
   choice resets. Do not share this file. A missing-original error must produce
   no file; never turn masking off to work around it during streaming.
4. Filter, paginate and scroll a virtualized table if available. Compare each
   download's count with mounted rows, confirm JSON remains incomplete, and
   check unknown/partial filter and pagination metadata. Do not treat matching
   ARIA counts as proof of a full export.
5. Navigate away/back, trigger rerenders and inspect views with multiple tables.
   Confirm one control per table and no stale rows. Use browser profiling to
   check that export discovery is idle without DOM changes. Confirm via browser
   network tools that export clicks add no requests; normal UniFi traffic is
   separate. Inspect CSV multiline/quote handling and formula-like values in a
   disposable spreadsheet; compare exact extracted values in JSON.

Only basic live export success has been reported by the owner. Completion of
the detailed browser checks above has not been reported or independently verified.

## Install

Install from the raw Git URL:

`https://raw.githubusercontent.com/OpsJake/tampermonkey-scripts/main/unifi-ip-obfuscator/unifi-ip-obfuscator.user.js`

Make sure `@downloadURL` and `@updateURL` inside the script match that same URL.

Note: this URL intentionally uses `http://` because this internal Forgejo instance does not have TLS configured.

## Version 3.0.0

- Adds a global obfuscation toggle button (`Hidden` / `Visible`) with persisted state via Tampermonkey storage when available.
- Fixes false positives where Date / Time values were being masked in views like Traffic/Flows/Events.
- Keeps masking sensitive values such as public/WAN IPs, IPv6 addresses, and MAC addresses.
