# Record demo — web shell (real UI, fake data)

This app reuses the **parent** `dietcombo` React tree (same `ClientList`, `ClientProfile`, `DriversMapLeaflet`, MUI theme, and `app/globals.css`) while **aliasing** the parent’s `lib/actions.ts` to a local **synthetic** `lib/demo-actions.ts` so the UI is fast and never hits your database. **Admin Control** and **Meal Plan Edits** use the real pages and components; sensitive mutations go to demo shims instead of production services.

- **No company logo** in the forked sidebar (see `components/DemoSidebar.tsx`).
- **Default `next build` must use webpack** so `lib/actions` and other shims resolve predictably: `next build --webpack` (see `package.json`).

## Run

```bash
cd record-demo-web
npm install
npm run dev
```

Server listens on **port 3010**. The app uses `tsconfig` path `@/*` → parent (`../*`), so imports like `@/components/clients/ClientList` load the real admin components.

## Shims (see `next.config.mjs`)

| Parent module            | Replaced with                    |
| ------------------------ | -------------------------------- |
| `lib/actions.ts`         | `lib/demo-actions.ts` (stubs + hand-written seeds) |
| `lib/session.ts`         | `lib/demo-session.ts` (always a signed-in demo user) |
| `lib/auth-actions.ts`    | `lib/demo-auth-actions.ts` (no-op logout) |
| `lib/form-actions.ts`    | `lib/demo-form-actions.ts` (minimal form APIs) |
| `lib/geocodeOneClient.ts`| `lib/demo-geocodeOneClient.ts` (no network) |
| `lib/api.js`             | `lib/demo-api.js` (no mobile API) |

`webpack` `resolve.alias` also sets `@` to the **parent** project root so all `@/…` imports match the main app.

## Regenerating action stubs

When `../lib/actions.ts` gains new `export async function` names, regenerate the auto-stub file (non-destructive to `demo-actions-handmade.ts`):

```bash
node record-demo-web/scripts/gen-demo-action-stubs.mjs
```

## What is still limited

- **Billing** and other flows that depend on proprietary APIs are not wired here; capture those on production if needed.
- **Some** features that call custom **API routes** (e.g. signature status) will no-op or 404 in the network tab; the main table, profile, and map are what this project optimizes for.

## Dataset

Synthetic clients and reference data live in `lib/demo-store.ts` and the hand-implemented server actions in `lib/demo-actions-handmade.ts` (addresses and lat/lng are in the **Columbus, OH** area for believable map recording).
