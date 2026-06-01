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
