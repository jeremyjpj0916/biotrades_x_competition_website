# Architecture

A single Next.js application serves public standings and signed-in accounts. PostgreSQL holds Better Auth identities, season calendars, stable security identities, dated symbols, one entry per participant and year, market history, daily ranks, corrections and trophies. The database clock and row locks enforce the deadline even when the worker is down.

The worker obtains a PostgreSQL advisory lock, fills durable session jobs, batches bars by security and updates one ranked snapshot per session. Ingestion preserves raw observations and applies documented corporate actions only when calculating an equivalent position value. Standings use decimal arithmetic and competition ranks. Public reads are gated by the same season row, and finalized leaderboards read immutable archived score snapshots. No public result embeds an email or OAuth record. Account deletion anonymizes the public profile while retaining a stable ID for past picks and auditability.

Security reviews block publication until the event or gap is resolved. Published revisions, awards and audit rows are append-only. The currently selected revision can advance after an audited correction. Public ranking views paginate, identity lookups are indexed, and one snapshot feeds the leaderboard, analytics, profile and history pages.

Key tables are declared in the tracked SQL migration. Better Auth manages its own identity, session, verification, OAuth account, and rate-limit tables.

## Homepage artwork

`public/art/biotech-helix.webp` was created with the built-in ImageGen tool. The source prompt is below.

> Create a wide landscape hero artwork for BioTrades X, an elite biotech stock-picking competition web dashboard. Editorial photoreal 3D macro of one physically realistic sculptural DNA double helix built from tiny translucent glass beads and small elegant connections, sweeping diagonally up from lower middle to upper right, isolated on deep nearly black navy (#111020) background. Electric periwinkle and cool ultraviolet highlights with hints of icy white particle glints, restrained cinematic finance aesthetic with exquisite texture and depth, a few subtle out-of-focus particles. The helix is concentrated in the right 55 percent, leftmost third is very dark seamless negative space for overlaid HTML text, edges fade to almost black. No text, no numbers, no grid, no symbols other than DNA, no watermark. Wide panoramic composition suitable for cropping to a short banner and mobile crop.
