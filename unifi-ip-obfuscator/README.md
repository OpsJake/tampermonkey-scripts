# UniFi IP Obfuscator

This script hides/obfuscates sensitive UniFi dashboard information for screenshots, streams, and recordings.

It is intended for UniFi Network / UniFi OS dashboards.

## Install

Install from the raw Git URL:

`https://raw.githubusercontent.com/OpsJake/tampermonkey-scripts/main/unifi-ip-obfuscator/unifi-ip-obfuscator.user.js`

Make sure `@downloadURL` and `@updateURL` inside the script match that same URL.

Note: this URL intentionally uses `http://` because this internal Forgejo instance does not have TLS configured.

## Version 3.0.0

- Adds a global obfuscation toggle button (`Hidden` / `Visible`) with persisted state via Tampermonkey storage when available.
- Fixes false positives where Date / Time values were being masked in views like Traffic/Flows/Events.
- Keeps masking sensitive values such as public/WAN IPs, IPv6 addresses, and MAC addresses.
