# Storage Management

Manage cookies, localStorage, sessionStorage, and browser storage state.

## Storage State

Save and restore complete browser state including cookies and storage.

### Save Storage State

```bash
# Save to auto-generated filename (storage-state-{timestamp}.json)
pw-cli state-save

# Save to specific filename
pw-cli state-save my-auth-state.json
```

### Restore Storage State

```bash
# Load storage state from file
pw-cli state-load my-auth-state.json

# Navigate to apply cookies
pw-cli goto https://example.com
```

### Storage State File Format

The saved file contains:

```json
{
  "cookies": [
    {
      "name": "session_id",
      "value": "abc123",
      "domain": "example.com",
      "path": "/",
      "expires": 1735689600,
      "httpOnly": true,
      "secure": true,
      "sameSite": "Lax"
    }
  ],
  "origins": [
    {
      "origin": "https://example.com",
      "localStorage": [
        { "name": "theme", "value": "dark" },
        { "name": "user_id", "value": "12345" }
      ]
    }
  ]
}
```

## Cookies

### List All Cookies

```bash
pw-cli cookie-list
```

### Filter Cookies by Domain

```bash
pw-cli cookie-list --domain=example.com
```

### Filter Cookies by Path

```bash
pw-cli cookie-list --path=/api
```

### Get Specific Cookie

```bash
pw-cli cookie-get session_id
```

### Set a Cookie

```bash
# Basic cookie
pw-cli cookie-set session abc123

# Cookie with options
pw-cli cookie-set session abc123 --domain=example.com --path=/ --httpOnly --secure --sameSite=Lax

# Cookie with expiration (Unix timestamp)
pw-cli cookie-set remember_me token123 --expires=1735689600
```

### Delete a Cookie

```bash
pw-cli cookie-delete session_id
```

### Clear All Cookies

```bash
pw-cli cookie-clear
```

### Advanced: Multiple Cookies

```bash
pw-cli run-code "async page => {
  await page.context().addCookies([
    { name: 'session_id', value: 'sess_abc123', domain: 'example.com', path: '/', httpOnly: true },
    { name: 'preferences', value: JSON.stringify({ theme: 'dark' }), domain: 'example.com', path: '/' }
  ]);
}"
```

## Local Storage

```bash
pw-cli localstorage-list
pw-cli localstorage-get token
pw-cli localstorage-set theme dark
pw-cli localstorage-set user_settings '{"theme":"dark","language":"en"}'
pw-cli localstorage-delete token
pw-cli localstorage-clear
```

### Advanced: Multiple Operations

```bash
pw-cli run-code "async page => {
  await page.evaluate(() => {
    localStorage.setItem('token', 'jwt_abc123');
    localStorage.setItem('user_id', '12345');
    localStorage.setItem('expires_at', Date.now() + 3600000);
  });
}"
```

## Session Storage

```bash
pw-cli sessionstorage-list
pw-cli sessionstorage-get form_data
pw-cli sessionstorage-set step 3
pw-cli sessionstorage-delete step
pw-cli sessionstorage-clear
```

## IndexedDB

```bash
# List databases
pw-cli run-code "async page => {
  return await page.evaluate(async () => {
    const databases = await indexedDB.databases();
    return databases;
  });
}"

# Delete database
pw-cli run-code "async page => {
  await page.evaluate(() => {
    indexedDB.deleteDatabase('myDatabase');
  });
}"
```

## Common Patterns

### Authentication State Reuse

```bash
# Step 1: Login and save state
pw-cli goto https://app.example.com/login
pw-cli snapshot
pw-cli fill e1 "user@example.com"
pw-cli fill e2 "password123"
pw-cli click e3

# Save the authenticated state
pw-cli state-save auth.json

# Step 2: Later, restore state and skip login
pw-cli state-load auth.json
pw-cli goto https://app.example.com/dashboard
# Already logged in!
```

### Save and Restore Roundtrip

```bash
pw-cli goto https://example.com
pw-cli eval "() => { document.cookie = 'session=abc123'; localStorage.setItem('user', 'john'); }"

pw-cli state-save my-session.json

# ... later ...

pw-cli state-load my-session.json
pw-cli goto https://example.com
# Cookies and localStorage are restored!
```

## Security Notes

- Never commit storage state files containing auth tokens
- Add `*.auth-state.json` to `.gitignore`
- Delete state files after automation completes
- Use environment variables for sensitive data
