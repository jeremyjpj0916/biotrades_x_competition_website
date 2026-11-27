# HTTP API

JSON mutations require the application origin and an authenticated session. Personal responses use `Cache-Control: private, no-store`.

| Route | Access | Behavior |
| --- | --- | --- |
| `/api/auth/*` | Better Auth | Email and OAuth authentication. Verification challenges are required on account creation, sign-in and recovery. |
| `GET /api/securities?q=…` | Verified account | Looks up cached reference records and eligibility. |
| `POST /api/profile` | Verified account | Saves the public username, display name, avatar URL, bio and social handles. |
| `POST /api/entries` | Active verified profile | Accepts `{year, securityId}`. A null securityId withdraws the pick during registration. |
| `GET /api/leaderboard/export?year=…` | Public after lock | Downloads visible standings. Optional `q` and `date` filter the data. |
| `POST /api/admin` | Verified administrator | Executes an audited operation from the admin dashboard. |
| `GET /api/health` | Public | Basic application health. |
| `GET /api/ready` | Public | Database and season readiness. |

Competition pages live under `/competitions/<year>`. Stable security detail URLs append `/stocks/<security UUID>`. Public player URLs are `/users/<username>`.
