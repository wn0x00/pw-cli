# Video Recording

Capture browser automation sessions as video for debugging, documentation, or verification. Produces WebM (VP8/VP9 codec).

## Basic Recording

```bash
# Start recording
pw-cli video-start demo.webm

# Add a chapter marker for section transitions
pw-cli video-chapter "Getting Started" --description="Opening the homepage" --duration=2000

# Navigate and perform actions
pw-cli goto https://example.com
pw-cli snapshot
pw-cli click e1

# Add another chapter
pw-cli video-chapter "Filling Form" --description="Entering test data" --duration=2000
pw-cli fill e2 "test input"

# Stop and save
pw-cli video-stop
```

## Best Practices

### 1. Use Descriptive Filenames

```bash
pw-cli video-start recordings/login-flow-2024-01-15.webm
pw-cli video-start recordings/checkout-test-run-42.webm
```

### 2. Record entire hero scripts with run-script

When recording a video as proof of work or a demo, create a script and run it with `pw-cli run-script`.
This allows controlled pacing, chapter markers, and overlay annotations.

1. Perform the scenario manually using `pw-cli` and note all locators and actions
2. Write a script file with the intended flow (see template below)
3. Run it: `pw-cli run-script your-script.js`

**Important**: Overlays are `pointer-events: none` — they do not interfere with clicks, fills, or any page interactions. You can keep sticky overlays visible while performing actions.

```javascript
// demo.js
await page.screencast.start({ path: 'video.webm', size: { width: 1280, height: 800 } });
await page.goto('https://demo.playwright.dev/todomvc');

// Show a chapter card — blurs the page and shows a dialog.
// Blocks until duration expires, then auto-removes.
await page.screencast.showChapter('Adding Todo Items', {
  description: 'We will add several items to the todo list.',
  duration: 2000,
});

// Perform action with natural typing speed
await page.getByRole('textbox', { name: 'What needs to be done?' }).pressSequentially('Walk the dog', { delay: 60 });
await page.getByRole('textbox', { name: 'What needs to be done?' }).press('Enter');
await page.waitForTimeout(1000);

// Next chapter
await page.screencast.showChapter('Verifying Results', {
  description: 'Checking the item appeared in the list.',
  duration: 2000,
});

// Add a sticky annotation that stays while you perform actions
const annotation = await page.screencast.showOverlay(`
  <div style="position: absolute; top: 8px; right: 8px;
    padding: 6px 12px; background: rgba(0,0,0,0.7);
    border-radius: 8px; font-size: 13px; color: white;">
    ✓ Item added successfully
  </div>
`);

await page.getByRole('textbox', { name: 'What needs to be done?' }).pressSequentially('Buy groceries', { delay: 60 });
await page.getByRole('textbox', { name: 'What needs to be done?' }).press('Enter');
await page.waitForTimeout(1500);

await annotation.dispose();

// Highlight a specific element with a bounding box overlay
const bounds = await page.getByText('Walk the dog').boundingBox();
await page.screencast.showOverlay(`
  <div style="position: absolute;
    top: ${bounds.y}px; left: ${bounds.x}px;
    width: ${bounds.width}px; height: ${bounds.height}px;
    border: 2px solid red;"></div>
  <div style="position: absolute;
    top: ${bounds.y + bounds.height + 5}px;
    left: ${bounds.x + bounds.width / 2}px;
    transform: translateX(-50%);
    padding: 6px; background: #808080;
    border-radius: 10px; font-size: 14px; color: white;">
    Check it out
  </div>
`, { duration: 2000 });

await page.screencast.stop();
```

```bash
pw-cli run-script ./demo.js
```

## Overlay API Summary

| Method | Use Case |
|--------|----------|
| `page.screencast.showChapter(title, { description?, duration?, styleSheet? })` | Full-screen chapter card with blurred backdrop — ideal for section transitions |
| `page.screencast.showOverlay(html, { duration? })` | Custom HTML overlay — callouts, labels, bounding box highlights |
| `disposable.dispose()` | Remove a sticky overlay that was added without a duration |
| `page.screencast.hideOverlays()` / `showOverlays()` | Temporarily hide/show all overlays |

## Tracing vs Video

| Feature | Video | Tracing |
|---------|-------|---------|
| Output | WebM file | Trace file (Trace Viewer) |
| Shows | Visual recording | DOM snapshots, network, console, actions |
| Use case | Demos, documentation | Debugging, analysis |
| Size | Larger | Smaller |

## Limitations

- Recording adds slight overhead to automation
- Large recordings can consume significant disk space
