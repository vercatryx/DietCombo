# Dislikes Implementation Analysis

## Overview
The dislikes feature (originally from dietfantasy) has been integrated into the DietCombo application. It allows storing and displaying food dislikes and dietary restrictions for clients, which are then propagated to delivery stops for driver reference.

## Database Schema

### Clients Table
- **Field**: `dislikes` (TEXT, nullable)
- **Location**: `clients` table
- **Purpose**: Stores the primary dislikes/dietary restrictions for each client
- **Schema Reference**: `sql/mysql-schema.sql` line 163

### Stops Table
- **Field**: `dislikes` (TEXT, nullable)
- **Location**: `stops` table
- **Purpose**: Stores a denormalized copy of dislikes for each delivery stop
- **Schema Reference**: `sql/mysql-schema.sql` line 480
- **Note**: This allows stops to have their own dislikes even if the client record changes

## Data Flow

### 1. Client Profile Management

#### Editing Dislikes
**Location**: `components/clients/ClientProfile.tsx` (lines 3084-3088)

```tsx
<div className={styles.formGroup}>
    <label className="label">Dislikes / Dietary Restrictions</label>
    <textarea 
        className="input" 
        style={{ height: '80px' }} 
        value={formData.dislikes || ''} 
        onChange={e => setFormData({ ...formData, dislikes: e.target.value })} 
        placeholder="Enter any food dislikes or dietary restrictions" 
    />
</div>
```

#### Saving Dislikes
**Location**: `components/clients/ClientProfile.tsx` (line 6275)

When creating a new client:
```tsx
dislikes: formData.dislikes ?? null,
```

**Location**: `lib/actions.ts`

- **Creating Client** (line 1127):
  ```typescript
  dislikes: data.dislikes || null,
  ```

- **Updating Client** (line 1381):
  ```typescript
  if (data.dislikes !== undefined) payload.dislikes = data.dislikes || null;
  ```

- **Reading Client** (line 982):
  ```typescript
  dislikes: c.dislikes || null,
  ```

### 2. Route/Stop Creation

#### Dislikes Propagation to Stops
**Location**: `app/api/route/routes/route.ts` (lines 264, 330-331)

When creating stops for routes, the system:
1. **Prefers live client data** over stop's denormalized data
2. **Falls back** to stop's stored dislikes if client data unavailable
3. **Trims and normalizes** the dislikes string

```typescript
// Prefer live client value; fall back to stop's denorm
const dislikes = c?.dislikes ?? s.dislikes ?? "";

// Ensure labels receive dislikes at the top level
dislikes: typeof dislikes === "string" ? dislikes.trim() : "",
```

#### Stop Data Structure
**Location**: `app/api/route/routes/route.ts` (line 73, 101, 123)

The API queries include dislikes in stop selection:
```typescript
.select('id, client_id, address, apt, city, state, zip, phone, lat, lng, dislikes, delivery_date, completed, day, assigned_driver_id, order_id')
```

### 3. Display Locations

#### A. Routes Page
**Location**: `app/routes/page.tsx` (line 494)

Dislikes are included in the stop data structure for route visualization:
```typescript
dislikes: u.dislikes || "",
```

#### B. Driver Map (Leaflet)
**Location**: `components/routes/DriversMapLeaflet.jsx` (lines 623-630)

Dislikes are displayed in map popups with special styling:
```javascript
if (stop.dislikes) {
    html += `
        <div style="margin-top:8px;padding:6px;background:#fef3c7;border-radius:6px;font-size:11px;border:1px solid #fcd34d">
            <div style="color:#92400e;font-weight:600;margin-bottom:4px">Notes:</div>
            <div style="color:#78350f;white-space:pre-wrap;line-height:1.4">${stop.dislikes}</div>
        </div>
    `;
}
```

**Visual Design**:
- Yellow/amber background (`#fef3c7`)
- Yellow border (`#fcd34d`)
- Brown text (`#78350f`, `#92400e`)
- Preserves whitespace with `white-space:pre-wrap`

#### C. Stop Preview Dialog
**Location**: `components/routes/StopPreviewDialog.tsx` (lines 654-677)

Dislikes are shown in a dedicated "Special Notes" section:
```tsx
{stop.dislikes && (
    <>
        <Divider />
        <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, color: '#374151' }}>
                Special Notes
            </Typography>
            <Box sx={{ pl: 1, p: 1.5, backgroundColor: '#f9fafb', borderRadius: 1, border: '1px solid #e5e7eb' }}>
                <Typography variant="body2" sx={{ color: '#374151', whiteSpace: 'pre-wrap' }}>
                    {stop.dislikes}
                </Typography>
            </Box>
        </Box>
    </>
)}
```

#### D. Driver Portal
**Location**: `app/drivers/[id]/page.tsx` (lines 583-588)

Dislikes are displayed in the driver's stop list:
```tsx
{s.dislikes && (
    <div className="flex muted wrap">
        <span className="b600">Dislikes:</span>
        <span>{s.dislikes}</span>
    </div>
)}
```

#### E. Client Driver Assignment
**Location**: `components/routes/ClientDriverAssignment.tsx` (line 388)

Dislikes are included when mapping client data to stop information:
```typescript
dislikes: stopInfo?.dislikes || null,
```

#### F. PDF Route Labels
**Location**: `utils/pdfRouteLabels.js` (lines 42-59)

A utility function handles dislikes extraction with multiple fallback paths:
```javascript
function getDislikes(u = {}) {
    const v =
        u.dislikes ??
        u?.user?.dislikes ??
        u?.User?.dislikes ??
        u?.client?.dislikes ??
        u?.flags?.dislikes ??
        "";

    const s = (v == null ? "" : String(v)).trim();
    // Treat common "empty" indicators as none
    if (/^(none|no|n\/a|na|nil|-|—|not applicable)$/i.test(s)) return "";
    // If data was typed as "Dislikes: X", strip prefix
    return s.replace(/^dislikes\s*:\s*/i, "").trim();
}
```

**Features**:
- Multiple fallback paths for different data structures
- Normalizes common "empty" indicators
- Strips "Dislikes:" prefix if present
- Used in PDF label generation (lines 236, 290)

## Type Definitions

**Location**: `lib/types.ts` (line 54)

```typescript
export interface ClientProfile {
  // ... other fields
  dislikes?: string | null;
  // ... other fields
}
```

## API Endpoints

### Users API
**Location**: `app/api/users/route.ts` (line 14, 53)

Includes dislikes in user/client queries:
```typescript
.select('id, first_name, last_name, full_name, address, apt, city, state, zip, phone_number, lat, lng, dislikes, paused, delivery, complex, assigned_driver_id')
```

### User by ID API
**Location**: `app/api/users/[id]/route.ts` (lines 14, 32, 102, 148)

Handles dislikes in GET and PATCH operations:
```typescript
// GET
dislikes: client.dislikes || null,

// PATCH
if (b.dislikes !== undefined) payload.dislikes = b.dislikes ?? null;
```

## Key Implementation Details

### 1. Data Normalization
- Dislikes are stored as plain text (TEXT field)
- No structured format required
- Supports multi-line text (textarea input)
- Whitespace is preserved in display (`white-space:pre-wrap`)

### 2. Denormalization Strategy
- Dislikes are stored in both `clients` and `stops` tables
- Stops table allows historical preservation (if client dislikes change)
- Route generation prefers live client data but falls back to stop data

### 3. Display Priority
The system uses a priority order for displaying dislikes:
1. **Live client data** (`c?.dislikes`) - Most current
2. **Stop's stored data** (`s.dislikes`) - Historical snapshot
3. **Empty string** - Default fallback

### 4. Data Validation
- Empty strings are normalized to `null` in database
- Common "empty" indicators are filtered out in PDF labels
- Prefix stripping handles cases where users type "Dislikes: ..."

## Integration Points

1. **Client Management**: Edit dislikes in client profile
2. **Route Planning**: Dislikes appear in route stops
3. **Driver Interface**: Dislikes visible in driver portal and maps
4. **Label Generation**: Dislikes included in PDF route labels
5. **Stop Details**: Dislikes shown in stop preview dialogs

## Notes

- The dislikes feature was originally from the dietfantasy app (as noted in comments)
- The `/dietfantasy` folder is listed in `.gitignore`, suggesting it may have been a separate codebase that was integrated
- The implementation follows a denormalized pattern to ensure stops retain dislikes even if client data changes
- Dislikes are treated as free-form text, allowing flexibility in how dietary restrictions are recorded
