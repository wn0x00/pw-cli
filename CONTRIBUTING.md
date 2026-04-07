# Contributing

## Development setup

1. Install Node.js 18 or newer.
2. Clone the repository.
3. Run `npm install`.
4. Run `npm run verify`.

If you are working on browser-connected behavior, also make sure `playwright` and `@playwright/cli` are available in your environment.

## Pull requests

Please keep pull requests focused and easy to review.

- Explain the user-facing problem being solved
- Describe behavior changes and tradeoffs
- Add or update tests when behavior changes
- Update documentation when commands or workflows change

## Code style

- Use CommonJS to match the existing codebase
- Prefer small modules and straightforward control flow
- Keep CLI error messages direct and actionable
- Avoid adding dependencies unless they materially simplify maintenance

## Testing

Run:

```bash
npm run verify
```

The current suite covers syntax and non-browser utility behavior. If you change browser lifecycle behavior, add integration coverage where practical.
