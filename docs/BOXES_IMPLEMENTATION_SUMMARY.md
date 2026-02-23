# Multiple Boxes Implementation - Executive Summary

## Overview

This document provides a concise summary of the implementation plan for adding multiple boxes support with authorization limits to the Boxes service type ordering system.

---

## Key Features to Implement

### 1. **Multiple Boxes Support**
- Replace single `boxQuantity` with `boxes[]` array
- Each box has its own configuration (items, box type, etc.)
- Sequential box numbering (Box #1, Box #2, etc.)

### 2. **Max Boxes Authorization**
- Use `client.authorizedAmount` to calculate max boxes
- Formula: `maxBoxes = Math.floor(authorizedAmount / boxType.priceEach)`
- Real-time validation and UI feedback

### 3. **Add/Remove Box Functionality**
- "Add Another Box" button (disabled when limit reached)
- Remove box button (minimum 1 box required)
- Automatic box renumbering after removal

### 4. **Enhanced Item Interface**
- **Single Box**: Full category sections with all available items
- **Multiple Boxes**: Compact view showing only selected items per box
- Per-box quota validation
- Category grouping maintained

---

## Recommended Implementation Approach

### Phase 1: Foundation (Week 1)
1. **Update Type Definitions** (`lib/types.ts`)
   - Add `BoxConfiguration` interface
   - Add `boxes?: BoxConfiguration[]` to `OrderConfiguration`
   - Keep legacy fields for backward compatibility

2. **Create Migration Helpers** (`lib/box-order-helpers.ts` - NEW FILE)
   - `migrateLegacyBoxOrder()` - Convert old format to new
   - `getTotalBoxCount()` - Get count from either format
   - `validateBoxCountAgainstAuthorization()` - Authorization validation

### Phase 2: Client Portal UI (Week 1-2)
1. **Update ClientPortalInterface.tsx**
   - Replace single box UI with boxes array
   - Add authorization status header
   - Implement box cards with box numbers
   - Add "Add Box" / "Remove Box" buttons
   - Update item display for multiple boxes

### Phase 3: Admin UI (Week 2)
1. **Update ClientProfile.tsx**
   - Similar changes to ClientPortalInterface
   - Add admin-specific features (override limits, bulk operations)

### Phase 4: Backend Logic (Week 2-3)
1. **Update syncCurrentOrderToUpcoming** (`lib/actions.ts`)
   - Handle boxes array format
   - Migrate legacy format on load

2. **Update validation logic**
   - Check box count against authorization
   - Validate each box's quota requirements

### Phase 5: Testing & Refinement (Week 3)
1. Test with legacy data
2. Test with new format
3. Test edge cases (authorization limits, box removal, etc.)

---

## Data Structure Example

### New Format (Recommended)
```typescript
{
  serviceType: 'Boxes',
  caseId: 'CASE-123',
  boxes: [
    {
      boxNumber: 1,
      boxTypeId: 'box-type-1',
      vendorId: 'vendor-1',
      items: { 'item-1': 2, 'item-2': 1 },
      itemPrices: { 'item-1': 5.00, 'item-2': 3.00 }
    },
    {
      boxNumber: 2,
      boxTypeId: 'box-type-1',
      vendorId: 'vendor-1',
      items: { 'item-1': 1, 'item-3': 3 },
      itemPrices: { 'item-1': 5.00, 'item-3': 2.00 }
    }
  ]
}
```

### Legacy Format (Auto-migrated)
```typescript
{
  serviceType: 'Boxes',
  boxQuantity: 2,
  boxTypeId: 'box-type-1',
  items: { 'item-1': 2, 'item-2': 1 }
}
// Automatically converts to boxes[] array on load
```

---

## UI Changes Summary

### Before (Single Box)
```
┌─────────────────────────────┐
│ Box Contents                │
├─────────────────────────────┤
│ [Category 1]                │
│   Item A [quantity]          │
│   Item B [quantity]          │
│ [Category 2]                │
│   Item C [quantity]          │
└─────────────────────────────┘
```

### After (Multiple Boxes)
```
┌─────────────────────────────┐
│ Boxes: 2 / 5 authorized     │
├─────────────────────────────┤
│ ┌─ Box #1 ────────────────┐ │
│ │ Box Type: [Select]      │ │
│ │ [Category 1]            │ │
│ │   Item A: 2             │ │
│ │ [Category 2]            │ │
│ │   Item C: 1             │ │
│ └─────────────────────────┘ │
│ ┌─ Box #2 ────────────────┐ │
│ │ Box Type: [Select]      │ │
│ │ [Category 1]            │ │
│ │   Item B: 3             │ │
│ └─────────────────────────┘ │
│ [+ Add Another Box]         │
└─────────────────────────────┘
```

---

## Key Implementation Files

### Files to Modify
1. `lib/types.ts` - Add BoxConfiguration interface
2. `components/clients/ClientPortalInterface.tsx` - Client UI
3. `components/clients/ClientProfile.tsx` - Admin UI
4. `lib/actions.ts` - Sync logic
5. `lib/box-order-helpers.ts` - NEW FILE - Helper functions

### Files to Review
- `lib/local-db.ts` - Local DB operations
- `app/api/process-weekly-orders/route.ts` - Order processing
- `components/clients/ClientInfoShelf.tsx` - Client info display

---

## Authorization Logic

### Calculation
```typescript
// Maximum boxes allowed
const maxBoxes = Math.floor(client.authorizedAmount / boxType.priceEach);

// Current boxes
const currentBoxes = orderConfig.boxes?.length || 0;

// Can add more?
const canAdd = currentBoxes < maxBoxes;
```

### Example
- `authorizedAmount`: $500.00
- `boxType.priceEach`: $50.00
- **Max Boxes**: `floor(500 / 50) = 10 boxes`
- If client has 8 boxes, can add 2 more

---

## Backward Compatibility Strategy

### Load Time
- Check if `boxes[]` exists → use it
- If not, check `boxQuantity` → migrate to `boxes[]`
- Display and save in new format

### Save Time
- Always save in new format (`boxes[]`)
- Keep legacy fields for transition period (optional)

### Migration Function
```typescript
function migrateLegacyBoxOrder(config) {
  if (config.boxes) return config; // Already migrated
  
  if (config.boxQuantity && config.boxTypeId) {
    // Create boxes array from legacy format
    const boxes = [];
    for (let i = 1; i <= config.boxQuantity; i++) {
      boxes.push({
        boxNumber: i,
        boxTypeId: config.boxTypeId,
        items: { ...config.items }
      });
    }
    return { ...config, boxes };
  }
  
  return config;
}
```

---

## Testing Priorities

### Critical Tests
1. ✅ Legacy order loads and displays
2. ✅ Legacy order migrates on save
3. ✅ Can add box up to limit
4. ✅ Cannot add box beyond limit
5. ✅ Can remove box (min 1 required)
6. ✅ Box numbers renumber correctly
7. ✅ Items configured per box independently
8. ✅ Order saves correctly
9. ✅ Order syncs to upcoming_orders

### Edge Cases
- Client with no `authorizedAmount` (unlimited)
- Client with `authorizedAmount = 0`
- Box type with no `priceEach`
- Removing all boxes (should keep minimum 1)
- Adding box when at limit (should be disabled)

---

## Next Steps

1. **Review this plan** with the team
2. **Start with Phase 1** (Type definitions and helpers)
3. **Implement Phase 2** (Client Portal UI)
4. **Test thoroughly** before moving to admin UI
5. **Iterate based on feedback**

---

## Questions to Resolve

1. **Business Logic**: Should all boxes share the same box type, or can each box have a different type?
   - **Recommendation**: Allow different types per box for flexibility

2. **Order Processing**: Should each box create a separate upcoming order, or combine into one?
   - **Recommendation**: Combine into one order with box metadata (current structure supports this)

3. **Box Numbering**: Should box numbers persist across saves, or always start at 1?
   - **Recommendation**: Always sequential starting at 1 (simpler)

4. **Item Copying**: Should there be a "Copy items from Box #1" feature?
   - **Recommendation**: Add in Phase 2 (nice-to-have)

---

**Status**: Ready for Implementation  
**Estimated Time**: 2-3 weeks  
**Priority**: High (Core Feature Enhancement)
