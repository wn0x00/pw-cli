---
name: pw-cli
description: Automate browser interactions, test web pages and work with Playwright. Enhanced wrapper over playwright-cli with persistent headed browser, XPath support, run-script, and queue.
allowed-tools: Bash(pw-cli:*)
---

# Browser Automation with pw-cli

pw-cli is a persistent browser CLI built on playwright-cli. The browser **opens automatically** on first use — no `open` command needed.

## Quick start

```bash
# browser opens automatically on first command
pw-cli goto https://playwright.dev
# interact with the page using refs from the snapshot
pw-cli click e15
pw-cli click e15 --force   # force-click through overlays (pointer-events interception)
pw-cli type "page.click"
pw-cli press Enter
# take a screenshot (rarely used, as snapshot is more common)
pw-cli screenshot
# close the browser
pw-cli close
```

## Commands

### Core

```bash
pw-cli goto https://playwright.dev
pw-cli type "search query"
pw-cli click e3
pw-cli click e3 --force    # bypass pointer-events overlay (e.g. locked table columns)
pw-cli dblclick e7
# --submit presses Enter after filling the element
pw-cli fill e5 "user@example.com" --submit
pw-cli drag e2 e8
pw-cli hover e4
pw-cli select e9 "option-value"
pw-cli upload ./document.pdf
pw-cli check e12
pw-cli uncheck e12
pw-cli snapshot
pw-cli eval "() => document.title"           # browser context: document/window available
pw-cli eval "el => el.textContent" e5
# get element id, class, or any attribute not visible in the snapshot
pw-cli eval "el => el.id" e5
pw-cli eval "el => el.getAttribute('data-testid')" e5
pw-cli dialog-accept
pw-cli dialog-accept "confirmation text"
pw-cli dialog-dismiss
pw-cli resize 1920 1080
pw-cli close
```

### XPath (pw-cli extension)

Use XPath expressions directly in any interaction command — no snapshot ref needed:

```bash
pw-cli click //button[@type='submit']
pw-cli click (//li[@class='item'])[1]
pw-cli fill //input[@name='email'] "user@example.com"
pw-cli hover //nav[@id='main-nav']
pw-cli check //input[@type='checkbox'][@name='agree']
pw-cli uncheck //input[@type='checkbox'][@name='newsletter']
pw-cli select //select[@name='country'] "US"
pw-cli dblclick //table/tr[2]/td[1]
pw-cli drag //div[@id='source'] //div[@id='target']
```

XPath is detected by `//`, `(//`, or `xpath=` prefix. pw-cli converts these to `run-code` using `page.locator('xpath=...')`.

> **Git bash on Windows**: bare `//a` is converted to `/a` by MSYS. Use attributes (`//a[@href]`) or set `MSYS_NO_PATHCONV=1`.

### Navigation

```bash
pw-cli go-back
pw-cli go-forward
pw-cli reload
```

### Keyboard

```bash
pw-cli press Enter
pw-cli press ArrowDown
pw-cli keydown Shift
pw-cli keyup Shift
```

### Mouse

```bash
pw-cli mousemove 150 300
pw-cli mousedown
pw-cli mousedown right
pw-cli mouseup
pw-cli mouseup right
pw-cli mousewheel 0 100
```

### Save as

```bash
pw-cli screenshot
pw-cli screenshot e5
pw-cli screenshot --filename=page.png
pw-cli pdf --filename=page.pdf
```

### Tabs

```bash
pw-cli tab-list
pw-cli tab-new
pw-cli tab-new https://example.com/page
pw-cli tab-close
pw-cli tab-close 2
pw-cli tab-select 0
```

### Storage

```bash
pw-cli state-save
pw-cli state-save auth.json
pw-cli state-load auth.json

# Cookies
pw-cli cookie-list
pw-cli cookie-list --domain=example.com
pw-cli cookie-get session_id
pw-cli cookie-set session_id abc123
pw-cli cookie-set session_id abc123 --domain=example.com --httpOnly --secure
pw-cli cookie-delete session_id
pw-cli cookie-clear

# LocalStorage
pw-cli localstorage-list
pw-cli localstorage-get theme
pw-cli localstorage-set theme dark
pw-cli localstorage-delete theme
pw-cli localstorage-clear

# SessionStorage
pw-cli sessionstorage-list
pw-cli sessionstorage-get step
pw-cli sessionstorage-set step 3
pw-cli sessionstorage-delete step
pw-cli sessionstorage-clear
```

### Network

```bash
pw-cli route "**/*.jpg" --status=404
pw-cli route "https://api.example.com/**" --body='{"mock": true}'
pw-cli route-list
pw-cli unroute "**/*.jpg"
pw-cli unroute
```

### DevTools

```bash
pw-cli console
pw-cli console warning
pw-cli network
pw-cli run-code "async page => await page.context().grantPermissions(['geolocation'])"
pw-cli tracing-start
pw-cli tracing-stop
pw-cli video-start video.webm
pw-cli video-chapter "Chapter Title" --description="Details" --duration=2000
pw-cli video-stop
```

### run-code (pw-cli extension)

Execute arbitrary Playwright JavaScript. Runs in **Node.js context** — use `page.*` API, not `document`. Plain statements are **auto-wrapped** — no need to write `async page => {}`. Supports **stdin** for multi-line code.

> **run-code vs eval**: `run-code` = Node.js / Playwright API (`page`, `context`). `eval` = browser JS (`document`, `window`, DOM). Use `eval` when you need `document.querySelectorAll`, `navigator.clipboard`, etc.

```bash
# inline — statements or function form, both work
pw-cli run-code "return await page.title()"
pw-cli run-code "async (page) => { return await page.title() }"
pw-cli run-code "async page => { return await page.title() }"  # parens optional

# stdin
echo "return await page.title()" | pw-cli run-code

cat <<'EOF' | pw-cli run-code
await page.goto('https://example.com');
const links = await page.locator('a').allTextContents();
return links;
EOF
```

### run-script (pw-cli extension)

Execute a full `.js` script file with all Playwright globals:

```bash
pw-cli run-script ./scrape.js
pw-cli run-script ./scrape.js --url https://example.com --output result.json
pw-cli run-script ./screenshot.js https://example.com ./out.png
```

Script globals: `page`, `context`, `browser`, `playwright`, `args`, `require`, `__filename`, `__dirname`

### Queue (pw-cli extension)

Batch multiple actions and run them together:

```bash
pw-cli queue add goto https://example.com
pw-cli queue add click e3
pw-cli queue add fill e5 "hello"
pw-cli queue add run-code "return await page.title()"
pw-cli queue list
pw-cli queue run
pw-cli queue run --fail-fast
pw-cli queue remove <id>
pw-cli queue clear
```

## Open parameters

```bash
# pw-cli always starts headed with a persistent profile by default.
# Use open explicitly only when you need a specific browser or config.
pw-cli open --browser=chrome
pw-cli open --browser=firefox
pw-cli open --browser=webkit
pw-cli open --browser=msedge
# Connect to browser via extension
pw-cli open --extension

# Override the default persistent profile
pw-cli open --profile=/path/to/profile

# Start with config file
pw-cli open --config=my-config.json

# Close the browser
pw-cli close
# Delete user data for the default session
pw-cli delete-data
```

## Snapshots

After each command, pw-cli provides a snapshot of the current browser state.

```bash
> pw-cli goto https://example.com
### Page
- Page URL: https://example.com/
- Page Title: Example Domain
### Snapshot
[Snapshot](.playwright-cli/page-2026-04-03T10-00-00-000Z.yml)
```

Take a snapshot on demand with `pw-cli snapshot`. All options can be combined:

```bash
# default - save to a file with timestamp-based name
pw-cli snapshot

# save to specific file, use when snapshot is part of the workflow result
pw-cli snapshot --filename=after-click.yaml

# snapshot an element instead of the whole page
pw-cli snapshot "#main"

# limit snapshot depth for efficiency
pw-cli snapshot --depth=4
pw-cli snapshot e34
```

## Targeting elements

By default, use refs from the snapshot to interact with elements:

```bash
pw-cli snapshot
pw-cli click e15
```

You can also use CSS selectors, Playwright locators, or XPath:

```bash
# css selector
pw-cli click "#main > button.submit"

# role locator
pw-cli click "getByRole('button', { name: 'Submit' })"

# test id
pw-cli click "getByTestId('submit-button')"

# XPath (pw-cli extension)
pw-cli click //button[@type='submit']
```

## Browser Sessions

pw-cli uses a **global persistent session** by default — the same browser and profile regardless of working directory. Named sessions work the same as playwright-cli.

```bash
# default session — always the same browser, always persistent, always headed
pw-cli goto https://example.com
pw-cli click e6

# named sessions (isolated cookies, storage, history)
pw-cli -s=mysession goto https://example.com
pw-cli -s=mysession click e6
pw-cli -s=mysession close

pw-cli list
pw-cli close-all
pw-cli kill-all
```

## Example: Form submission

```bash
pw-cli goto https://example.com/form
pw-cli snapshot

pw-cli fill e1 "user@example.com"
pw-cli fill e2 "password123"
pw-cli click e3
pw-cli snapshot
```

## Example: XPath form fill

```bash
pw-cli goto https://example.com/form
pw-cli fill //input[@name='email'] "user@example.com"
pw-cli fill //input[@name='password'] "secret"
pw-cli click //button[@type='submit']
pw-cli snapshot
```

## Example: Multi-tab workflow

```bash
pw-cli goto https://example.com
pw-cli tab-new https://example.com/other
pw-cli tab-list
pw-cli tab-select 0
pw-cli snapshot
pw-cli close
```

## Example: Batch actions with queue

```bash
pw-cli queue add goto https://example.com/login
pw-cli queue add fill //input[@name='email'] "user@example.com"
pw-cli queue add fill //input[@name='password'] "secret"
pw-cli queue add click //button[@type='submit']
pw-cli queue add snapshot
pw-cli queue run
```

## Example: Debugging with DevTools

```bash
pw-cli goto https://example.com
pw-cli tracing-start
pw-cli click e4
pw-cli fill e7 "test"
pw-cli console
pw-cli network
pw-cli tracing-stop
pw-cli close
```

## Specific tasks

* **Running and Debugging Playwright tests** [references/playwright-tests.md](references/playwright-tests.md)
* **Request mocking** [references/request-mocking.md](references/request-mocking.md)
* **Running Playwright code** [references/running-code.md](references/running-code.md)
* **run-script (Node.js script files)** [references/run-script.md](references/run-script.md)
* **Queue (batch actions)** [references/queue.md](references/queue.md)
* **XPath element targeting** [references/xpath.md](references/xpath.md)
* **Browser session management** [references/session-management.md](references/session-management.md)
* **Storage state (cookies, localStorage)** [references/storage-state.md](references/storage-state.md)
* **Tracing** [references/tracing.md](references/tracing.md)
* **Video recording** [references/video-recording.md](references/video-recording.md)
* **Inspecting element attributes** [references/element-attributes.md](references/element-attributes.md)
