# mock-bank

A mock bank back-office web app used as the target for the computer-use
automation system. Server-rendered only (Express + EJS) with deliberately
hostile, legacy-style markup: table-based layouts, deeply nested divs,
non-descriptive class names (`td1`, `row`, `cell`, ...), and no `data-testid`
/ `data-*` / semantic IDs anywhere. The only reliable anchors are `<label>`
elements paired with their `<input>`.

## Running it

```bash
cd mock-bank
npm install
npm run dev      # ts-node, no build step
# or
npm run build && npm start
```

The app listens on `http://localhost:3000` (override with `PORT`).

Login credentials: `admin` / `password123`.

## Fixtures

| Member ID | Name        | Savings Balance |
|-----------|-------------|------------------|
| 12345     | Jane Smith  | $4,200.00        |
| 67890     | Robert Lee  | $12,750.00       |
| 99999     | (does not exist) | —           |

## Screens

- `GET /login`, `POST /login` — sets a session cookie on success, redirects to `/search`.
- `GET /search`, `POST /search` — search by Member ID; redirects to `/member/:id` on a hit.
- `GET /member/:id` — member name + savings balance in a nested table.
- `GET /member/:id/sub-account`, `POST ...` — form to open a sub-account; posts to the confirm screen.
- `GET /member/:id/sub-account/confirm`, `POST ...` — review screen with the irreversible Confirm action.

## Triggering injectable error states

All error states render at HTTP 200 (as a legacy app would) **except**
`error=server`, which returns a real HTTP 500 — useful for testing that the
automation system classifies on rendered UI state, not status code.

| Trigger | Effect |
|---|---|
| `GET /search?error=not_found` | Renders "Record not found" (also happens naturally when POSTing a nonexistent member ID, e.g. `99999`) |
| `GET /search?error=timeout` | Renders "Session expired, please login again" |
| `GET /member/:id?error=permission` | Renders "You are not authorized" |
| `GET /member/:id?error=slow` | Adds a 3 second delay before responding |
| `GET /member/:id?error=server` | Returns a real HTTP 500 |

Example:

```bash
curl "http://localhost:3000/search?error=not_found"
curl "http://localhost:3000/member/12345?error=permission"
curl -i "http://localhost:3000/member/12345?error=server"
```
