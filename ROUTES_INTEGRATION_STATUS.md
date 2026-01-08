# Routes Feature Integration Status

## ✅ Completed

1. **Sidebar Integration**
   - Added "Routes" menu item to sidebar with Route icon
   - Links to `/routes` page

2. **API Endpoints Created** (adapted from Prisma to MySQL):
   - `/api/route/routes` - Main endpoint for fetching routes
   - `/api/route/runs` - Fetch route run history
   - `/api/route/reassign` - Reassign stops to drivers

3. **Database Schema**
   - Verified tables exist: `drivers`, `stops`, `route_runs`
   - Schema is compatible with routes feature

## 🚧 Still Needed

### 1. Install Dependencies
The routes feature uses Material-UI which needs to be installed:

```bash
npm install @mui/material @mui/icons-material @emotion/react @emotion/styled
```

### 2. Additional API Endpoints Needed
Copy and adapt these from `dietfantasy/app/api/route/`:
- `generate/route.ts` - Generate new routes
- `optimize/route.ts` - Optimize routes
- `cleanup/route.ts` - Clean up invalid stops
- `add-driver/route.ts` - Add new driver
- `remove-driver/route.ts` - Remove driver
- `rename-driver/route.ts` - Rename driver
- `reset/route.ts` - Reset routes
- `add-stop/route.ts` - Add stop
- `runs/save-current/route.ts` - Save route snapshot
- `apply-run/route.ts` - Apply saved route
- `auto-assign/route.ts` - Auto assign stops
- `geocode-missing/route.ts` - Geocode missing addresses

### 3. Components to Copy
From `dietfantasy/components/`:
- `DriversDialog.jsx` - Main routes dialog
- `DriversMapLeaflet.jsx` - Map visualization
- `ManualGeocodeDialog.jsx` - Manual geocoding
- `MapConfirmDialog.jsx` - Map location picker
- `MapLoadingOverlay.jsx` - Loading overlay
- `SearchStops.jsx` - Stop search component

### 4. Utilities to Copy
From `dietfantasy/utils/`:
- `pdfRouteLabels.js` - PDF label generation
- `routeOptimize.ts` - Route optimization algorithms
- `routing/areaBalance.ts` - Area balancing
- `addressHelpers.js` - Address utilities
- `geocodeOneClient.js` - Geocoding helpers

### 5. Update Routes Page
The `/app/routes/page.tsx` needs to be updated to:
- Import and use DriversDialog
- Fetch clients/users data
- Handle routes display and management

### 6. API Endpoints Needed
- `/api/labels/enrich` - Enrich labels with route data
- `/api/geocode/search` - Geocoding search
- `/api/users` - Users API (or adapt to clients)

## Notes

- The database uses `clients` table instead of `users`, so all references need to be adapted
- The schema uses `client_id` instead of `userId` in stops table
- All Prisma queries need to be converted to raw MySQL queries using the `query` helper from `lib/mysql.ts`
- Material-UI components are required - install before using components

## Next Steps

1. Install Material-UI dependencies
2. Copy remaining API endpoints and adapt to MySQL
3. Copy and adapt components
4. Copy utilities
5. Update routes page to integrate everything
6. Test end-to-end functionality

