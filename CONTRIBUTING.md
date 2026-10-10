# Contributing

Use Node.js 24 or newer. Install dependencies with `npm ci`, then start the workspace with `npm run dev`. The frontend runs on port 5173 and the API on port 8787, both on localhost.

## Making a change

Work directly on `main`; this repository uses a single branch. Keep changes focused, explain the resulting behavior in the commit, and complete the relevant checks before pushing. Add tests when they verify a meaningful behavior or regression; keep UI changes consistent with the existing responsive layouts.

Run the build and unit/integration checks:

```sh
npm run check
```

For camera browsing or image refresh changes, install the browser and run the isolated camera checks:

```sh
npx playwright install chromium
npm run test:cameras:ui
```

For map changes, keep the development app running and use:

```sh
npm run test:streets:ui
```

Check relevant desktop and mobile layouts. Automated map gestures use synthetic street tiles. Live provider probes are separate tools; record provider failures separately from application failures. Do not add automated map prefetch or bulk tile downloads.

## Data and sources

Keep source attribution, licence, retrieval time, and position uncertainty with provider records. Use clearly identified synthetic fixtures in tests, and do not write them to a real workspace database. Catalogue builders should retain existing records when a provider is unavailable.

Keep credentials, environment files, personal evidence, generated artifacts, and local planning documents out of commits. `.env.example` documents optional settings without credentials.

## Reporting a bug

Include the affected module, steps to reproduce, expected and observed behavior, Node/browser versions, and relevant error output. Screenshots help with layout issues; remove personal workspace data and credentials before sharing them.
