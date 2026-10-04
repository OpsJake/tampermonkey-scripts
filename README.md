# Tampermonkey Scripts

This repository stores personal Tampermonkey/userscripts.

## Installation

Install a script by opening its raw `.user.js` URL in a browser with Tampermonkey installed.

For this internal Forgejo instance, install/update URLs intentionally use `http://` (not `https://`) because TLS is not configured on that host.

## Script Metadata Requirements

Each userscript should include:

- `@downloadURL`
- `@updateURL`

These should point to the script's raw URL so Tampermonkey can install and update reliably.

## Branching and Releases

- Treat `main` as the stable branch.
- Bump userscript metadata version numbers before pushing updates.

## Local validation

The UniFi userscript includes local CSV/JSON export of rendered semantic table rows.
See [usage and support limits](unifi-ip-obfuscator/README.md).

With Node.js 18 or newer:

```sh
npm ci --ignore-scripts
npm test
npm run check
```

Tests use pinned development-only `jsdom`; the userscript remains self-contained.
`npm run check` checks JavaScript and publisher shell syntax and diff whitespace.
Neither command invokes the publishing workflow.

Do not use `scripts/publish_public.sh --dry-run` or `--no-push` for validation:
both recreate `public-build/`, initialize a Git repository and **commit** there.
The normal publisher and the Forgejo workflow also push a public mirror.
