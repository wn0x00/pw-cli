# pw-cli

`pw-cli` is a small Node.js CLI that keeps a Playwright browser session alive and makes repeat browser automation commands faster to run.

It is designed for a local, interactive workflow:

- Default to headed mode instead of headless
- Reuse a persistent browser/profile between commands
- Run inline code or `.js` scripts against the active page
- Queue multiple actions and execute them in order
- Add convenience behavior around Playwright CLI sessions and XPath-based commands

## Why this project exists

Raw Playwright is excellent for test suites and scripted automation, but ad hoc browser control from the terminal is often slower than it needs to be. `pw-cli` optimizes for that interactive loop by reusing a browser session and exposing a CLI-first interface.

## Features

- Persistent Chromium session reuse
- Headed mode by default
- Named profile support
- `run-code` for inline JavaScript or piped stdin
- `run-script` for executing local JavaScript files with `main` function convention
- `run-script` supports standard CommonJS modules (`require`, `__filename`, `__dirname`) and also bare-code scripts
- Queue management for multi-step flows
- Automatic browser launch when needed
- XPath command conversion for common actions

## Requirements

- Node.js 18+
- `playwright`
- `@playwright/cli`

`pw-cli` declares Playwright packages as peer dependencies because many users already have them installed globally or inside their automation environment.

## Installation

Install the package itself:

```bash
npm install -g @guanzhu.me/pw-cli
```

Install the required Playwright packages if they are not already available:

```bash
npm install -g playwright @playwright/cli
```

## Quick start

Open a page:

```bash
pw-cli open https://example.com
```

Run inline automation:

```bash
pw-cli run-code "await page.goto('https://example.com'); return await page.title()"
```

Pipe code from stdin:

```bash
echo "return await page.url()" | pw-cli run-code
```

Run a local script:

```bash
pw-cli run-script ./scrape.js --url https://example.com
```

`run-script` is intended for multi-step automation. Define an `async function main` that receives Playwright globals as a single object:

```javascript
// scripts/extract-links.js
const fs = require('fs');

async function main({ page, args }) {
  const url = args[args.indexOf('--url') + 1] || 'https://example.com';
  const output = args[args.indexOf('--output') + 1] || 'links.json';

  await page.goto(url, { waitUntil: 'domcontentloaded' });

  const links = await page.locator('a').evaluateAll(nodes =>
    nodes
      .map(a => ({
        text: a.textContent.trim(),
        href: a.href,
      }))
      .filter(item => item.href)
  );

  fs.writeFileSync(
    output,
    JSON.stringify(
      {
        url,
        count: links.length,
        links,
      },
      null,
      2
    )
  );

  return `saved ${links.length} links to ${output}`;
}
```

```bash
pw-cli run-script ./scripts/extract-links.js --url https://example.com --output links.json
```

Reuse a page that was opened through `pw-cli open`:

```bash
pw-cli open https://www.amazon.com
pw-cli run-script ./collect-rank-node.js "wireless earbuds" --pages 3
```

Use XPath with common commands:

```bash
pw-cli click "//button[contains(., 'Submit')]"
```

Use the queue:

```bash
pw-cli queue add goto https://example.com
pw-cli queue add snapshot
pw-cli queue run
```

Inspect browser sessions:

```bash
pw-cli list
```

## How pw-cli differs from playwright-cli

`pw-cli` keeps the `playwright-cli` command model and command grouping, but adds a few workflow-oriented behaviors:

- `open` injects headed and persistent defaults
- Browser-backed commands can auto-open a browser session if needed
- `run-code` accepts stdin and plain inline statements
- `run-script` executes a local `.js` file — auto-detects `main` function, `module.exports`, or bare code
- Common element commands accept XPath refs
- `queue` lets you batch multiple commands and run them in order

## Command reference

The structure below intentionally follows `playwright-cli`, with `pw-cli` differences called out inline.

### Usage

```text
pw-cli <command> [args] [options]
pw-cli -s=<session> <command> [args] [options]
```

### Core

```text
open [url]                  open the browser
                            pw-cli: injects headed + persistent defaults
                            pw-cli: if url is provided, opens first and then navigates
close                       close the browser
goto <url>                  navigate to a url
type <text>                 type text into editable element
click <ref> [button]        perform click on a web page
                            pw-cli: accepts XPath ref
dblclick <ref> [button]     perform double click on a web page
                            pw-cli: accepts XPath ref
fill <ref> <text>           fill text into editable element
                            pw-cli: accepts XPath ref
drag <startRef> <endRef>    perform drag and drop between two elements
                            pw-cli: accepts XPath refs
hover <ref>                 hover over element on page
                            pw-cli: accepts XPath ref
select <ref> <val>          select an option in a dropdown
                            pw-cli: accepts XPath ref
upload <file>               upload one or multiple files
check <ref>                 check a checkbox or radio button
                            pw-cli: accepts XPath ref
uncheck <ref>               uncheck a checkbox or radio button
                            pw-cli: accepts XPath ref
snapshot                    capture page snapshot to obtain element ref
eval <func> [ref]           evaluate javascript expression on page or element
dialog-accept [prompt]      accept a dialog
dialog-dismiss              dismiss a dialog
resize <w> <h>              resize the browser window
delete-data                 delete session data
```

### Navigation

```text
go-back                     go back to the previous page
go-forward                  go forward to the next page
reload                      reload the current page
```

### Keyboard

```text
press <key>                 press a key on the keyboard, `a`, `arrowleft`
keydown <key>               press a key down on the keyboard
keyup <key>                 press a key up on the keyboard
```

### Mouse

```text
mousemove <x> <y>           move mouse to a given position
mousedown [button]          press mouse down
mouseup [button]            press mouse up
mousewheel <dx> <dy>        scroll mouse wheel
```

### Save as

```text
screenshot [ref]            screenshot of the current page or element
pdf                         save page as pdf
```

### Tabs

```text
tab-list                    list all tabs
tab-new [url]               create a new tab
tab-close [index]           close a browser tab
tab-select <index>          select a browser tab
```

### Storage

```text
state-load <filename>       loads browser storage (authentication) state from a file
state-save [filename]       saves the current storage (authentication) state to a file
cookie-list                 list all cookies (optionally filtered by domain/path)
cookie-get <name>           get a specific cookie by name
cookie-set <name> <value>   set a cookie with optional flags
cookie-delete <name>        delete a specific cookie
cookie-clear                clear all cookies
localstorage-list           list all localstorage key-value pairs
localstorage-get <key>      get a localstorage item by key
localstorage-set <key> <value> set a localstorage item
localstorage-delete <key>   delete a localstorage item
localstorage-clear          clear all localstorage
sessionstorage-list         list all sessionstorage key-value pairs
sessionstorage-get <key>    get a sessionstorage item by key
sessionstorage-set <key> <value> set a sessionstorage item
sessionstorage-delete <key> delete a sessionstorage item
sessionstorage-clear        clear all sessionstorage
```

### Network

```text
route <pattern>             mock network requests matching a url pattern
route-list                  list all active network routes
unroute [pattern]           remove routes matching a pattern (or all routes)
```

### DevTools

```text
console [min-level]         list console messages
run-code <code>             run playwright code snippet
                            pw-cli: reads code from stdin when <code> is omitted
                            pw-cli: wraps plain statements in an async function
run-script <file> [...]     run a local JavaScript file (main function or module.exports)
network                     list all network requests since loading the page
tracing-start               start trace recording
tracing-stop                stop trace recording
video-start                 start video recording
video-stop                  stop video recording
show                        show browser devtools
devtools-start              show browser devtools
```

### Install

```text
install                     initialize workspace
install-browser             install browser
```

### Browser sessions

```text
list                        list browser sessions
close-all                   close all browser sessions
kill-all                    forcefully kill all browser sessions (for stale/zombie processes)
```

### pw-cli queue

```text
queue add <command> [args...]   add a command to the queue
queue list                      show queued commands
queue run [--fail-fast]         execute queued commands in order
queue remove <id>               remove a queued command by id prefix
queue clear                     clear the queue
```

Run `pw-cli queue help` for queue-specific help text.

### Global options

```text
--help [command]            print help
-h                          print help
--version                   print version
-s, --session <name>        choose browser session
--headless                  used by pw-cli-managed browser launches
```

## Examples

```bash
pw-cli open https://example.com
pw-cli run-code "await page.goto('https://example.com'); return await page.title()"
echo "return await page.url()" | pw-cli run-code
pw-cli run-script ./scripts/smoke.js --env prod
pw-cli run-script ./scripts/extract-links.js --url https://example.com --output links.json
pw-cli click "//button[contains(., 'Submit')]"
pw-cli queue add goto https://example.com
pw-cli queue add snapshot
pw-cli queue run
```

## Development

Clone the repository and install dependencies if you want local Playwright integration:

```bash
npm install
```

Run the validation suite:

```bash
npm run verify
```

Current automated checks focus on syntax and non-browser unit coverage. Browser-level integration testing can be added later once the public CLI contract is finalized.

## Project layout

```text
bin/        Executable entrypoint
src/        CLI logic, browser management, executor, queue, state helpers
examples/   Example assets
skills/     Internal skill/reference material used by the authoring workflow
test/       Node.js built-in test suite
```

## Roadmap

- Add integration tests for browser lifecycle and session reuse
- Publish versioned release notes
- Clarify compatibility with upstream Playwright CLI changes
- Add example scripts for common workflows

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Security

See [SECURITY.md](./SECURITY.md).

## License

MIT. See [LICENSE](./LICENSE).
