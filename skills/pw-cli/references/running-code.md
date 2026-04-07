# Running Custom Playwright Code

Use `run-code` to execute arbitrary Playwright code for advanced scenarios not covered by CLI commands.

## run-code vs eval

| | `run-code` | `eval` |
|---|---|---|
| Runs in | **Node.js** (Playwright API) | **Browser** JS context |
| Access | `page`, `context`, `browser` | `document`, `window`, DOM APIs |
| Use when | Playwright interactions, waits | Reading DOM, dispatching events |

```bash
# run-code — Node.js side, use page.*
pw-cli run-code "return await page.title()"

# eval — browser side, use document.*
pw-cli eval "() => document.querySelectorAll('button').length"
pw-cli eval "() => navigator.clipboard.readText()"
```

## Syntax

```bash
# Function form — both param styles work
pw-cli run-code "async (page) => { return await page.title() }"
pw-cli run-code "async page => { return await page.title() }"

# Statement form — auto-wrapped by pw-cli, no function needed
pw-cli run-code "return await page.title()"

# Stdin — pipe multi-line code
echo "return await page.title()" | pw-cli run-code

cat <<'EOF' | pw-cli run-code
await page.goto('https://example.com');
const items = await page.locator('.item').allTextContents();
return items;
EOF
```

Return values are printed to stdout.

## Available globals

| Global | Description |
|--------|-------------|
| `page` | Current Playwright Page |
| `context` | BrowserContext (persistent profile) |
| `browser` | Browser connected via CDP |
| `playwright` | The playwright module |
| `require` | Node.js require |

Top-level `await` is supported.

## Geolocation

```bash
# Grant geolocation permission and set location
pw-cli run-code "async (page) => {
  await page.context().grantPermissions(['geolocation']);
  await page.context().setGeolocation({ latitude: 37.7749, longitude: -122.4194 });
}"

# Set location to London
pw-cli run-code "async (page) => {
  await page.context().grantPermissions(['geolocation']);
  await page.context().setGeolocation({ latitude: 51.5074, longitude: -0.1278 });
}"

# Clear geolocation override
pw-cli run-code "async (page) => {
  await page.context().clearPermissions();
}"
```

## Permissions

```bash
# Grant multiple permissions
pw-cli run-code "async (page) => {
  await page.context().grantPermissions([
    'geolocation',
    'notifications',
    'camera',
    'microphone'
  ]);
}"

# Grant permissions for specific origin
pw-cli run-code "async (page) => {
  await page.context().grantPermissions(['clipboard-read'], {
    origin: 'https://example.com'
  });
}"
```

## Media Emulation

```bash
# Emulate dark color scheme
pw-cli run-code "await page.emulateMedia({ colorScheme: 'dark' })"

# Emulate reduced motion
pw-cli run-code "await page.emulateMedia({ reducedMotion: 'reduce' })"

# Emulate print media
pw-cli run-code "await page.emulateMedia({ media: 'print' })"
```

## Wait Strategies

```bash
# Wait for element to appear
pw-cli run-code "await page.waitForSelector('.loaded')"

# Wait for element to disappear
pw-cli run-code "await page.waitForSelector('.spinner', { state: 'hidden' })"

# ⚠️ Avoid waitForLoadState('networkidle') on SPAs — it never fires on pages
# with continuous background requests and will cause the session to close.
# Use waitForSelector or waitForFunction instead:
pw-cli run-code "await page.waitForFunction(() => document.querySelector('.content') !== null)"

# Wait for function to return true
pw-cli run-code "await page.waitForFunction(() => window.appReady === true)"

# Wait with timeout
pw-cli run-code "await page.locator('.result').waitFor({ timeout: 10000 })"
```

## Frames and Iframes

```bash
# Work with iframe
pw-cli run-code "async (page) => {
  const frame = page.locator('iframe#my-iframe').contentFrame();
  await frame.locator('button').click();
}"

# Get all frames
pw-cli run-code "async (page) => {
  const frames = page.frames();
  return frames.map(f => f.url());
}"
```

## File Downloads

```bash
# Handle file download
pw-cli run-code "async (page) => {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('a.download-link')
  ]);
  await download.saveAs('./downloaded.pdf');
  return download.suggestedFilename();
}"
```

## Clipboard

```bash
# Read clipboard (requires permission)
pw-cli run-code "async (page) => {
  await page.context().grantPermissions(['clipboard-read']);
  return await page.evaluate(() => navigator.clipboard.readText());
}"

# Write to clipboard
pw-cli run-code "async (page) => {
  await page.evaluate(t => navigator.clipboard.writeText(t), 'Hello!');
}"
```

## Page Information

```bash
pw-cli run-code "return await page.title()"
pw-cli run-code "return page.url()"
pw-cli run-code "return await page.content()"
pw-cli run-code "return page.viewportSize()"
```

## JavaScript Execution

```bash
# Execute in page context
pw-cli run-code "return await page.evaluate(() => ({
  userAgent: navigator.userAgent,
  language: navigator.language
}))"

# Pass arguments to evaluate
pw-cli run-code "return await page.evaluate(n => document.querySelectorAll('li').length > n, 5)"
```

## Request Mocking

```bash
# Block images
pw-cli run-code "async (page) => {
  await page.route('**/*.{png,jpg,jpeg}', route => route.abort());
}"

# Mock API response
pw-cli run-code "async (page) => {
  await page.route('**/api/user', route => {
    route.fulfill({ body: JSON.stringify({ name: 'Mock User', role: 'admin' }) });
  });
}"

# Modify real response
pw-cli run-code "async (page) => {
  await page.route('**/api/config', async route => {
    const res = await route.fetch();
    const json = await res.json();
    json.featureFlag = true;
    await route.fulfill({ response: res, json });
  });
}"
```

## Error Handling

```bash
pw-cli run-code "async (page) => {
  try {
    await page.click('.maybe-missing', { timeout: 1000 });
    return 'clicked';
  } catch {
    return 'not found';
  }
}"
```

## Complex Workflows

```bash
# Login and save state
cat <<'EOF' | pw-cli run-code
await page.goto('https://example.com/login');
await page.fill('input[name=email]', 'user@example.com');
await page.fill('input[name=password]', 'secret');
await page.click('button[type=submit]');
await page.waitForURL('**/dashboard');
await page.context().storageState({ path: 'auth.json' });
return 'Login saved';
EOF

# Scrape paginated data
cat <<'EOF' | pw-cli run-code
const results = [];
for (let i = 1; i <= 3; i++) {
  await page.goto(`https://example.com/page/${i}`);
  const items = await page.locator('.item').allTextContents();
  results.push(...items);
}
return results;
EOF
```

## When to use run-code vs run-script

| | run-code | run-script |
|---|---|---|
| Length | Short snippets | Long, complex logic |
| Reuse | One-off | Saved file |
| Arguments | Not supported | `args` array |
| File I/O | Awkward | Natural (`__dirname`) |
| Multiline | Via stdin | Native JS file |

For scripts that need arguments, file I/O, or complex logic, prefer [run-script](run-script.md). Use the `main` function style for best IDE support:

```javascript
async function main({ page, args }) { /* ... */ }
```
