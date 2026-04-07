# XPath Element Targeting

pw-cli supports XPath expressions directly in interaction commands. pw-cli detects XPath and auto-converts the command to `run-code` using `page.locator('xpath=...')`.

## Supported commands

```bash
pw-cli click    <xpath>
pw-cli dblclick <xpath>
pw-cli hover    <xpath>
pw-cli fill     <xpath> <text>
pw-cli check    <xpath>
pw-cli uncheck  <xpath>
pw-cli select   <xpath> <value>
pw-cli drag     <src-xpath> <dst-xpath>
```

## XPath formats accepted

```bash
# Standard
pw-cli click //button[@type='submit']

# Parenthesized (for indexing)
pw-cli click (//li[@class='item'])[1]

# Explicit prefix
pw-cli click xpath=//div[@id='main']
```

XPath is detected when the ref starts with `//`, `(//`, or `xpath=`.

## Common patterns

```bash
# By attribute
pw-cli click //button[@type='submit']
pw-cli fill //input[@name='email'] "user@example.com"
pw-cli fill //input[@id='search'] "query"

# By text content
pw-cli click //button[text()='Sign In']
pw-cli click //a[contains(text(),'Login')]
pw-cli click //*[normalize-space(text())='Submit']

# By class
pw-cli click //div[@class='btn-primary']
pw-cli click //button[contains(@class,'submit')]

# By position
pw-cli click (//tr[@class='row'])[1]   # first matching row
pw-cli click (//li)[last()]             # last list item

# By hierarchy
pw-cli click //form[@id='login']//button
pw-cli fill //section[@class='contact']//input[@type='text'] "John"

# Checkbox / radio
pw-cli check //input[@type='checkbox'][@name='agree']
pw-cli check //input[@type='radio'][@value='option-a']

# Select dropdown
pw-cli select //select[@name='country'] "US"

# Drag between XPath elements
pw-cli drag //div[@id='source-panel'] //div[@id='target-panel']
```

## Mixing XPath and aria-refs

For `drag`, one side can be an aria-ref and the other XPath:

```bash
pw-cli drag //div[@id='handle'] e8
pw-cli drag e2 //div[@class='dropzone']
```

## Git bash on Windows

In git bash (MSYS/MINGW), paths starting with `//` are converted by the shell before reaching Node.js:

```bash
# BROKEN in git bash — //a becomes /a
pw-cli click //a

# SAFE — attribute prevents conversion
pw-cli click //a[@href]
pw-cli click //button[@type='submit']
pw-cli click (//li)[1]
```

Disable conversion entirely with:

```bash
export MSYS_NO_PATHCONV=1
pw-cli click //a
```

## Complex XPath via run-code

When a one-liner isn't enough:

```bash
# Wait for element, then click
pw-cli run-code "async page => {
  const el = page.locator('xpath=//button[@data-ready]');
  await el.waitFor({ state: 'visible' });
  await el.click();
}"

# Click all matching elements
pw-cli run-code "async page => {
  const checkboxes = page.locator('xpath=//input[@type=\"checkbox\"]');
  const count = await checkboxes.count();
  for (let i = 0; i < count; i++) await checkboxes.nth(i).check();
  return \`checked \${count} checkboxes\`;
}"
```
