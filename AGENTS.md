<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## BioTrades X

- See docs/ARCHITECTURE.md and docs/MARKET_DATA.md before changing the competition rules or provider behavior.
- Keep public reads behind the season's database deadline and omit raw prices from free-data results.
- Use disposable databases for lifecycle tests. Run npm run typecheck, npm test, and the relevant browser tests before opening a pull request.
