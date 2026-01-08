# Signatures Form Analysis - DietFantasy App

## Overview
The signatures form system in the DietFantasy app allows drivers to collect digital signatures from customers during deliveries. The system supports up to 5 signature slots per user for different authorization purposes, and integrates seamlessly with the drivers portal.

## Architecture

### Database Schema

#### User Model (Prisma)
- `id`: Int (primary key)
- `sign_token`: String? @unique - Unique token used to access signature collection form
- Other user fields (name, address, etc.)

#### Signature Model (Prisma)
- `id`: BigInt (primary key)
- `userId`: Int (foreign key to User)
- `slot`: Int (1-5) - Signature slot number
- `strokes`: Json - Array of stroke data points for the signature drawing
- `signedAt`: DateTime - Timestamp when signature was collected
- `ip`: String? - IP address of signer (for audit)
- `userAgent`: String? - User agent string (for audit)
- **Unique constraint**: `(userId, slot)` - One signature per slot per user

## Frontend Components

### 1. Signature Collection Form (`/app/sign/[token]/page.tsx`)

**Purpose**: Public-facing form for collecting signatures

**Features**:
- Token-based access (no authentication required)
- 5 signature slots with different legal consent statements
- Canvas-based signature pad with stroke capture
- Real-time signature preview
- Progress indicator (X/5 signatures collected)
- Auto-closes parent iframe when complete

**Key Components**:
- `SignaturePad`: Custom canvas component for drawing signatures
  - Uses pointer events for touch and mouse support
  - Captures strokes as array of points with timestamps
  - Persists strokes visually while drawing
  
**Legal Consent Statements** (one per slot):
1. Authorization to Apply Signature for Meal Delivery Attestations
2. Consent for Electronic Record Storage and Use
3. Acknowledgment of Information Accuracy
4. Privacy and Data Use Authorization
5. Ongoing Authorization for Signature Reuse

**User Flow**:
1. User accesses `/sign/[token]` via shared link
2. Form loads user information and existing signatures
3. User can fill any empty slots (1-5)
4. Each slot has its own signature pad
5. Click "Submit All" to save all new signatures
6. Form posts message to parent if embedded in iframe

**State Management**:
- `user`: User information (name, etc.)
- `collected`: Number of signatures already collected
- `existingSlots`: Array of slot numbers already signed
- `pad1` through `pad5`: Stroke data for each slot
- `busy`: Loading state during submission

### 2. Signature View Page (`/app/sign/[token]/view/page.tsx`)

**Purpose**: Admin view for viewing/completing signatures

**Features**:
- Read-only view of all collected signatures
- PDF export functionality
- Delete all signatures option
- Date range input for attestation PDFs
- Signature slot selector for PDF export

**PDF Export**:
- Generates "Member Attestation of Medically Tailored Meal Delivery" PDF
- Includes user information, address
- Meal delivery checkboxes (Breakfast, Lunch, Dinner, Snacks)
- Selected signature image embedded
- Service period dates (start/end) and delivery date
- Member attestation text with signature
- Uses pdf-lib for PDF generation

**Controls**:
- Export slot selector: Choose which signature to use (or random)
- Start Date / End Date: Service period dates
- Delivery Date: Date to include on attestation
- Download PDF button
- Delete All button (with confirmation)

### 3. Driver Detail Page (`/app/(mobile)/drivers/[id]/page.jsx`)

**Purpose**: Driver's view of their route with stops and signature collection

**Key Features**:
- Lists all stops assigned to the driver
- Shows signature collection progress per stop
- "Collect Signatures" button for each stop
- Opens signature form in bottom sheet (modal)
- Real-time signature count updates

**Signature Integration Points**:

1. **Progress Tracking**:
   ```javascript
   const sigUsersDone = stops.filter((s) => Number(s.sigCollected ?? 0) >= 5).length;
   ```
   - Tracks how many users have all 5 signatures
   - Shows progress bar: "Sigs" (X/Total)

2. **Collect Signatures Button** (lines 560-598):
   - Only shown if user hasn't completed all 5 signatures
   - When clicked:
     - Sets loading state
     - Opens bottom sheet modal immediately
     - Calls `ensureTokenForUser(userId)` API
     - Loads signature form in iframe at `/sign/[token]`
     - Listens for completion message

3. **Signature Count Display**:
   - Chip showing "X/5 sigs" for each stop
   - Green checkmark when complete (≥5 signatures)
   - Updates automatically after form submission

4. **Bottom Sheet Modal**:
   - Opens signature form in iframe
   - Closes when signature collection completes
   - Listens for `signatures:done` postMessage from iframe
   - Refreshes stop data after closing

**State Management**:
- `sheetOpen`: Controls modal visibility
- `sheetToken`: Current signature token
- `sheetUrl`: URL for iframe
- `sigOpeningId`: Tracks which stop is loading signature form
- `stops`: Stop data with `sigCollected` field merged from API

### 4. Search Stops Component (`/components/SearchStops.jsx`)

**Purpose**: Searchable list of all stops across routes

**Signature Features**:
- Shows signature count chip for each stop: "X/5 sigs"
- "Collect" button opens signature form in new tab
- Uses `signToken` from stop data

**Note**: Different from driver detail page - opens in new tab instead of modal

### 5. Users Table Component (`/components/UsersTable.jsx`)

**Purpose**: Admin table view of all users

**Signature Features**:
- "SIGN" column with copy/view button
- Shows green checkmark if user has ≥5 signatures
- Copies signature link to clipboard if incomplete
- Opens signature view page if complete
- Loads signature counts from `/api/signatures/status`

## Backend API Routes

### 1. GET `/api/signatures/[token]` - Get Signature Status

**Purpose**: Retrieve user info and existing signatures for a token

**Response**:
```json
{
  "user": { "id": 1, "first": "John", "last": "Doe" },
  "collected": 2,
  "slots": [1, 2]
}
```

**Implementation**: 
- Finds user by `sign_token`
- Counts existing signatures
- Returns slot numbers that are already signed

### 2. POST `/api/signatures/[token]` - Save Signature

**Purpose**: Save a new signature for a specific slot

**Request Body**:
```json
{
  "slot": 1,
  "strokes": [[{x, y, t}, ...], ...]
}
```

**Features**:
- Validates slot is 1-5
- Validates strokes array is non-empty
- Captures IP address and user agent for audit trail
- Uses upsert (create or update if slot exists)
- Returns updated count and slots array

**Implementation**:
- Finds user by token
- Upserts signature with strokes, IP, user agent
- Returns updated signature count

### 3. POST `/api/signatures/ensure-token/[userId]` - Generate Token

**Purpose**: Ensure user has a signature token, create if missing

**Response**:
```json
{
  "sign_token": "uuid-string"
}
```

**Implementation**:
- Checks if user has `sign_token`
- If missing, generates random UUID
- Updates user record
- Returns token (existing or new)

**Used by**: Driver detail page before opening signature form

### 4. GET `/api/signatures/status` - Get All Signature Counts

**Purpose**: Get signature counts for all users

**Response**:
```json
[
  { "userId": 1, "collected": 5 },
  { "userId": 2, "collected": 2 }
]
```

**Implementation**:
- Groups signatures by `userId`
- Counts signatures per user
- Returns array of userId → count mappings

**Used by**: 
- Users table to show signature status
- Driver pages to merge signature counts with stops

### 5. GET `/api/signatures/admin/[token]` - Admin View Data

**Purpose**: Get full signature data for admin view page

**Response**:
```json
{
  "user": { "id": 1, "first": "...", "last": "...", "address": "...", ... },
  "collected": 3,
  "slots": [1, 2, 3],
  "signatures": [
    {
      "slot": 1,
      "strokes": [...],
      "signedAt": "2025-01-15T10:30:00Z",
      "ip": "192.168.1.1",
      "userAgent": "Mozilla/5.0..."
    }
  ]
}
```

**Features**:
- Returns complete user info including address
- Returns all signature data with metadata
- Used by signature view page

### 6. DELETE `/api/signatures/admin/[token]` - Delete All Signatures

**Purpose**: Delete all signatures for a user (admin action)

**Implementation**:
- Finds user by token
- Deletes all signatures for that user
- Returns success status

## Data Flow

### Signature Collection Flow

1. **Driver Views Stop**:
   - Driver opens route detail page (`/drivers/[id]`)
   - Page loads stops and fetches signature counts via `/api/signatures/status`
   - Signature counts merged into stop objects as `sigCollected` field

2. **Driver Clicks "Collect Signatures"**:
   - `ensureTokenForUser(userId)` called
   - If user has no token, one is generated
   - Token returned and stored in state
   - Bottom sheet opens with iframe pointing to `/sign/[token]`

3. **Customer Signs Form**:
   - Form loads via GET `/api/signatures/[token]`
   - Shows existing signatures (already collected slots)
   - Customer draws signatures in available slots
   - Clicks "Submit All"
   - Form POSTs each new signature to `/api/signatures/[token]`
   - Each POST returns updated count

4. **Form Completion**:
   - Form posts `{type: "signatures:done"}` message to parent window
   - Driver detail page's `InlineMessageListener` receives message
   - Bottom sheet closes
   - Page reloads data to show updated signature counts

### Signature Status Updates

1. **On Page Load**:
   - Driver detail page fetches all stops
   - Separately fetches signature counts from `/api/signatures/status`
   - Merges counts into stops: `mergeSigCounts(stops, sigRows)`

2. **After Signature Collection**:
   - Page reloads all data via `loadData()`
   - Fresh signature counts fetched and merged
   - UI updates to show new signature counts

## Integration with Drivers Portal

### Progress Tracking

**Two Progress Metrics**:
1. **Bags/Stops Completed**: Percentage of stops marked as delivered
   - Progress bar (blue)
   - Shown in header: "X/Total"
   
2. **Signatures Complete**: Percentage of users with all 5 signatures
   - Progress bar (cyan/teal)
   - Shown in header: "X/Total Sigs"

### Stop Card Features

Each stop card in driver view shows:
- Stop name and address
- Signature count chip: "X/5 sigs"
- "Collect Signatures" button (only if < 5 signatures)
- "Mark Complete" button for delivery confirmation

### Conditional UI

- **Signature button visibility**: Only shown if `sigCollected < 5`
- **Signature button state**: Shows "Opening…" while loading token
- **Completed indicator**: Green checkmark when `sigCollected >= 5`

## Security & Audit Trail

### Token-Based Access
- Each user has unique `sign_token`
- No authentication required to access signature form
- Token acts as authorization - anyone with token can sign

### Audit Fields
- `ip`: Captured from `x-forwarded-for` header
- `userAgent`: Browser/device information
- `signedAt`: Timestamp of signature capture

### Data Validation
- Slot must be 1-5
- Strokes must be non-empty array
- User must exist and have valid token

## UI/UX Features

### Signature Pad
- Touch and mouse support via pointer events
- Smooth stroke rendering
- Clear button for each slot
- Visual feedback (border, background)
- Disabled state when slot already signed

### Mobile Optimization
- Responsive bottom sheet modal
- Full-screen signature form on mobile
- Touch-friendly signature pad
- Progress indicators visible in sticky header

### Feedback
- Loading states during API calls
- Silent failures (no error alerts)
- Auto-close on completion
- Real-time progress updates

## Error Handling

1. **Missing Token**: Shows "INVALID_TOKEN" in iframe
2. **User Not Found**: Returns 404 from API
3. **Invalid Slot**: Returns 400 from API
4. **Network Errors**: Silently fails, user can retry

## File Structure

```
dietfantasy/
├── app/
│   ├── sign/
│   │   └── [token]/
│   │       ├── page.tsx          # Signature collection form
│   │       └── view/
│   │           └── page.tsx      # Admin signature view
│   ├── (mobile)/
│   │   └── drivers/
│   │       ├── page.jsx          # Drivers list
│   │       └── [id]/
│   │           └── page.jsx      # Driver detail (signatures integration)
│   └── api/
│       └── signatures/
│           ├── [token]/
│           │   └── route.ts      # GET/POST signatures
│           ├── ensure-token/
│           │   └── [userId]/
│           │       └── route.ts  # Token generation
│           ├── admin/
│           │   └── [token]/
│           │       └── route.ts  # Admin GET/DELETE
│           └── status/
│               └── route.ts      # Signature counts
├── components/
│   ├── SearchStops.jsx           # Search with signature links
│   └── UsersTable.jsx            # Admin table with signature column
└── prisma/
    └── schema.prisma             # Database schema
```

## Key Implementation Details

### Signature Data Format

**Strokes Structure**:
```typescript
type Stroke = Array<{x: number, y: number, t: number}>;
type StrokesPayload = Stroke[]; // Array of strokes = one signature
```

- Each stroke is an array of points
- Points have x, y coordinates and timestamp
- Multiple strokes can make up one signature
- Stored as JSON in database

### PostMessage Communication

**From Signature Form** (when complete):
```javascript
window.parent.postMessage({ type: "signatures:done" }, "*");
```

**In Driver Page** (listener):
```javascript
window.addEventListener("message", (e) => {
  if (e?.data?.type === "signatures:done") {
    closeSignSheet();
    loadData(); // Refresh
  }
});
```

### Signature Count Merging

```javascript
function mergeSigCounts(stops, sigRows) {
  const sigMap = new Map(
    sigRows.map((r) => [Number(r.userId), Number(r.collected || 0)])
  );
  return stops.map((s) => ({
    ...s,
    sigCollected: sigMap.get(Number(s.userId)) ?? 0
  }));
}
```

## Future Enhancements (Potential)

1. **Signature Validation**: Verify signature is not empty/minimum stroke count
2. **Signature Preview**: Show thumbnail in stop cards
3. **Bulk Operations**: Collect signatures for multiple stops
4. **Export All**: Download all attestations for a route
5. **Signature Analytics**: Track collection rates over time
6. **Email Signatures**: Send signature link via email
7. **QR Code**: Generate QR codes for signature links
8. **Offline Support**: Cache signature form for offline use

## Dependencies

- **react-signature-canvas**: NOT used - custom canvas implementation
- **pdf-lib**: PDF generation for attestations
- **Prisma**: Database ORM
- **Next.js**: Framework with API routes
- **React**: UI library

## Summary

The signatures form system is a well-integrated feature that:
- ✅ Collects up to 5 digital signatures per user
- ✅ Integrates seamlessly with driver portal
- ✅ Provides audit trail (IP, user agent, timestamp)
- ✅ Supports PDF export for attestations
- ✅ Updates in real-time across the app
- ✅ Works on mobile and desktop
- ✅ Uses secure token-based access
- ✅ Shows progress tracking in driver interface

The system is production-ready and handles the complete workflow from signature collection to PDF attestation generation.
