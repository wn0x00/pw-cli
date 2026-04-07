# Browser Session Management

Run multiple isolated browser sessions concurrently with state persistence.

## Default session behaviour (pw-cli)

pw-cli's default session is **global and persistent**:
- The same browser and profile (`~/.pw-cli/profiles/default`) are used regardless of working directory
- The browser opens automatically on the first command — no `open` required
- The browser is always headed
- Sessions survive across terminal restarts as long as the browser process is running

```bash
# These all use the exact same browser, from any directory
pw-cli goto https://example.com
pw-cli snapshot
pw-cli close
```

## Named Browser Sessions

Use the `-s` flag to create isolated browser contexts with independent cookies, storage, and history:

```bash
# Browser 1: Authentication flow
pw-cli -s=auth goto https://app.example.com/login

# Browser 2: Public browsing (separate cookies, storage)
pw-cli -s=public goto https://example.com

# Commands are isolated by session
pw-cli -s=auth fill e1 "user@example.com"
pw-cli -s=public snapshot
```

## Browser Session Isolation Properties

Each named session has independent:
- Cookies
- LocalStorage / SessionStorage
- IndexedDB
- Cache
- Browsing history
- Open tabs

## Browser Session Commands

```bash
# List all browser sessions
pw-cli list

# Stop a browser session
pw-cli close                 # stop the default browser
pw-cli -s=mysession close    # stop a named browser

# Stop all browser sessions
pw-cli close-all

# Forcefully kill all daemon processes (for stale/zombie processes)
pw-cli kill-all

# Delete browser session user data (profile directory)
pw-cli delete-data                 # delete default browser data
pw-cli -s=mysession delete-data    # delete named browser data
```

## Environment Variable

Set a default browser session name via environment variable:

```bash
export PLAYWRIGHT_CLI_SESSION="mysession"
pw-cli goto https://example.com  # uses "mysession" automatically
```

## Common Patterns

### Concurrent Scraping

```bash
#!/bin/bash
# Scrape multiple sites in parallel named sessions

pw-cli -s=site1 goto https://site1.com &
pw-cli -s=site2 goto https://site2.com &
pw-cli -s=site3 goto https://site3.com &
wait

# Take snapshots from each
pw-cli -s=site1 snapshot
pw-cli -s=site2 snapshot
pw-cli -s=site3 snapshot

pw-cli close-all
```

### A/B Testing Sessions

```bash
pw-cli -s=variant-a goto "https://app.com?variant=a"
pw-cli -s=variant-b goto "https://app.com?variant=b"

pw-cli -s=variant-a screenshot --filename=variant-a.png
pw-cli -s=variant-b screenshot --filename=variant-b.png
```

### Custom Profile for Named Session

```bash
# Use a custom profile directory for a named session
pw-cli -s=mysession open https://example.com --profile=/path/to/profile

# Default session always uses ~/.pw-cli/profiles/default
```

## Best Practices

### 1. Name Browser Sessions Semantically

```bash
# GOOD: Clear purpose
pw-cli -s=github-auth goto https://github.com
pw-cli -s=docs-scrape goto https://docs.example.com

# AVOID: Generic names
pw-cli -s=s1 goto https://github.com
```

### 2. Always Clean Up Named Sessions

```bash
pw-cli -s=auth close
pw-cli -s=scrape close

# Or all at once
pw-cli close-all

# If browsers become unresponsive
pw-cli kill-all
```

### 3. Delete Stale Browser Data

```bash
pw-cli -s=oldsession delete-data
```
