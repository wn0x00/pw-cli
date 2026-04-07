# Queue — Batch Actions

Collect multiple actions into a queue and execute them together in a single browser session.

## Subcommands

```bash
pw-cli queue add <command> [args...]   # append an action
pw-cli queue list                       # show pending actions
pw-cli queue run [--fail-fast]          # execute all actions in order
pw-cli queue remove <id-prefix>         # remove one item by id prefix
pw-cli queue clear                      # empty the queue
```

## Queue file

The queue persists to `~/.pw-cli/queue.json` and survives across terminals and sessions.

## Adding actions

Any pw-cli browser command can be queued:

```bash
# Navigation
pw-cli queue add goto https://example.com

# Interactions using refs from snapshot
pw-cli queue add click e3
pw-cli queue add fill e5 "hello world"
pw-cli queue add hover e7
pw-cli queue add check e12
pw-cli queue add press Enter
pw-cli queue add type "search query"

# Interactions using XPath
pw-cli queue add click //button[@type='submit']
pw-cli queue add fill //input[@name='email'] "user@example.com"

# pw-cli extensions
pw-cli queue add run-code "return await page.title()"
pw-cli queue add snapshot

# All playwright-cli native commands also work
pw-cli queue add tab-new https://other.com
pw-cli queue add screenshot --filename=result.png
```

## Running the queue

```bash
# Run all — continues even if individual items fail
pw-cli queue run

# Abort immediately on first failure
pw-cli queue run --fail-fast
```

Output for each item shows `ok` or `FAILED` plus the snapshot output from playwright-cli:

```
Running 3 queued items...
  [1/3] goto https://example.com ... ok
  [2/3] click e3 ... ok
  [3/3] run-code return await page.title() ... ok
All items completed successfully.
```

## Session flag propagation

Global flags placed before `queue` are forwarded to every item:

```bash
# All items run in the "work" named session
pw-cli -s work queue run
```

## Inspecting and editing the queue

```bash
pw-cli queue list
# Queue (3 items):
#   #1 [mnimk9a] goto https://example.com
#   #2 [mnimk9b] fill e5 hello world
#   #3 [mnimk9c] run-code return await page.title()

# Remove by id prefix (4+ characters sufficient)
pw-cli queue remove mnimk9b

pw-cli queue clear
```

## Common patterns

### Login flow

```bash
pw-cli queue add goto https://app.example.com/login
pw-cli queue add fill //input[@name='email'] "user@example.com"
pw-cli queue add fill //input[@name='password'] "secret"
pw-cli queue add click //button[@type='submit']
pw-cli queue add snapshot
pw-cli queue run
```

### Screenshot multiple pages

```bash
for url in https://example.com https://example.com/about https://example.com/contact; do
  slug=$(echo "$url" | sed 's|.*/||')
  pw-cli queue add goto "$url"
  pw-cli queue add screenshot --filename="${slug}.png"
done
pw-cli queue run
```

### Build queue programmatically then review before running

```bash
# Add actions as you figure out what to do
pw-cli queue add goto https://shop.example.com
pw-cli queue add snapshot
pw-cli queue add click e5          # "Add to cart" from snapshot
pw-cli queue add click e9          # "Checkout"
pw-cli queue add fill e12 "John Doe"

# Review before committing
pw-cli queue list

# Execute
pw-cli queue run --fail-fast
```

## Notes

- Queue is global — shared across all terminals and working directories
- `queue run` reuses the already-open browser session across all items
- Each item produces its own snapshot output so you can see what happened at each step
- Refs (e1, e2…) are resolved at run time, not at add time — the page must be in the expected state
