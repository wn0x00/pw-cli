# run-script — Execute Node.js Script Files

Run a full `.js` script file with all Playwright globals available. Best for complex, multi-step, or reusable automation.

## Syntax

```bash
pw-cli run-script <path/to/script.js> [args...]
```

## Script globals

| Global | Description |
|--------|-------------|
| `page` | Current Playwright Page |
| `context` | BrowserContext (persistent profile) |
| `browser` | Browser connected via CDP |
| `playwright` | The playwright module |
| `args` | Array of everything passed after the script path |
| `require` | Node.js require |
| `__filename` | Absolute path of the script file |
| `__dirname` | Directory of the script file |
| `console` | Node.js console |
| `process` | Node.js process |

Top-level `await` is supported. No need for `module.exports` or a main function.

## Script template

```javascript
// automation.js
const urlIdx = args.indexOf('--url');
const url = urlIdx !== -1 ? args[urlIdx + 1] : 'https://example.com';
const outIdx = args.indexOf('--output');
const outputPath = outIdx !== -1 ? args[outIdx + 1] : 'output.json';

await page.goto(url);
await page.waitForLoadState('networkidle');

const data = await page.evaluate(() => ({
  title: document.title,
  headings: Array.from(document.querySelectorAll('h1,h2')).map(h => h.textContent.trim()),
  links: Array.from(document.querySelectorAll('a[href]')).map(a => ({
    text: a.textContent.trim(),
    href: a.href,
  })),
}));

require('fs').writeFileSync(outputPath, JSON.stringify(data, null, 2));
console.log(`Saved ${data.links.length} links to ${outputPath}`);
```

```bash
pw-cli run-script ./automation.js --url https://example.com --output result.json
```

## Accessing args

```javascript
// Positional
const [url, outputPath] = args;

// Named flags
const urlIdx = args.indexOf('--url');
const url = args[urlIdx + 1];

// Boolean flags
const verbose = args.includes('--verbose');
```

## Return values

`console.log()` output is printed to stdout. The final `return` value is also printed:

```javascript
return { title: await page.title(), url: page.url() };
```

## Examples

### Screenshot script

```javascript
// screenshot.js
const [url, outputPath = 'screenshot.png'] = args;
await page.goto(url);
await page.waitForLoadState('networkidle');
await page.screenshot({ path: outputPath, fullPage: true });
console.log(`Saved: ${outputPath}`);
```

```bash
pw-cli run-script ./screenshot.js https://example.com ./out.png
```

### Login and save auth state

```javascript
// login.js
const [email, password] = args;
await page.goto('https://app.example.com/login');
await page.fill('input[name=email]', email);
await page.fill('input[name=password]', password);
await page.click('button[type=submit]');
await page.waitForURL('**/dashboard');
await page.context().storageState({ path: 'auth.json' });
console.log('Logged in, state saved to auth.json');
```

```bash
pw-cli run-script ./login.js "user@example.com" "password123"
```

### Bulk scraper

```javascript
// scrape.js
const fs = require('fs');
const urlsFile = args[args.indexOf('--input') + 1] || 'urls.txt';
const urls = fs.readFileSync(urlsFile, 'utf8').trim().split('\n');

const results = [];
for (const url of urls) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const title = await page.title();
  const h1 = await page.locator('h1').first().textContent().catch(() => '');
  results.push({ url, title, h1: h1.trim() });
  console.log(`[${results.length}/${urls.length}] ${title}`);
}

fs.writeFileSync('results.json', JSON.stringify(results, null, 2));
return `Scraped ${results.length} pages`;
```

```bash
pw-cli run-script ./scrape.js --input urls.txt
```

### Using Node.js built-ins

```javascript
// All Node.js built-ins available via require
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

await page.goto('https://example.com');
const html = await page.content();
const hash = crypto.createHash('sha256').update(html).digest('hex');
fs.writeFileSync(path.join(__dirname, 'snapshot.html'), html);
return `sha256: ${hash}`;
```
