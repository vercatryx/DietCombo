# Multiple Boxes Implementation Plan

## Executive Summary

This document outlines the implementation plan for enhancing the Boxes service type ordering system to support:
- **Multiple boxes per order** with individual configurations
- **Max boxes authorization** based on `authorizedAmount` field
- **Box numbering** for tracking individual boxes
- **Add/Remove box functionality** in the UI
- **Enhanced item display interface** for multiple boxes

---

## Current State Analysis

### Current Implementation
- **Single Box Support**: Currently uses `boxQuantity: number` (typically 1)
- **Single Item Configuration**: All boxes share the same `items` configuration
- **Authorization**: `authorizedAmount` exists but is not used for box limit validation
- **UI**: Simple single-box interface in both `ClientProfile.tsx` and `ClientPortalInterface.tsx`

### Key Files
- `lib/types.ts` - `OrderConfiguration` interface (lines 68-105)
- `components/clients/ClientProfile.tsx` - Admin box ordering (lines 3162-3400)
- `components/clients/ClientPortalInterface.tsx` - Client portal box ordering (lines 1265-1495)
- `lib/actions.ts` - Order sync logic

---

## Proposed Data Structure

### Updated OrderConfiguration Interface

```typescript
export interface OrderConfiguration {
  serviceType: ServiceType;
  caseId?: string;
  
  // ... existing Food service fields ...
  
  // For Boxes - NEW STRUCTURE
  // Option 1: Array of boxes (RECOMMENDED)
  boxes?: BoxConfiguration[]; // Array of individual box configurations
  
  // Option 2: Legacy support (backward compatibility)
  vendorId?: string;
  boxTypeId?: string;
  boxQuantity?: number; // DEPRECATED - use boxes.length instead
  items?: { [itemId: string]: number }; // DEPRECATED - use boxes[].items
  itemPrices?: { [itemId: string]: number }; // DEPRECATED
  
  // ... rest of fields ...
}

export interface BoxConfiguration {
  boxNumber: number; // 1, 2, 3, etc. - sequential numbering
  boxTypeId: string;
  vendorId?: string; // Optional, can inherit from boxType
  items: { [itemId: string]: number }; // itemId -> quantity for THIS box
  itemPrices?: { [itemId: string]: number }; // Optional pricing per item
  notes?: string; // Optional notes specific to this box
}
```

### Migration Strategy

1. **Backward Compatibility**: Support both old format (`boxQuantity`, `items`) and new format (`boxes[]`)
2. **Auto-migration**: Convert old format to new format on load
3. **Save Format**: Always save in new format

---

## Implementation Steps

### Phase 1: Data Structure Updates

#### 1.1 Update Type Definitions
**File**: `lib/types.ts`

```typescript
export interface OrderConfiguration {
  // ... existing fields ...
  
  // NEW: Multiple boxes support
  boxes?: BoxConfiguration[];
  
  // LEGACY: Keep for backward compatibility, mark as deprecated
  /** @deprecated Use boxes[] array instead */
  boxQuantity?: number;
  /** @deprecated Use boxes[].items instead */
  items?: { [itemId: string]: number };
  /** @deprecated Use boxes[].itemPrices instead */
  itemPrices?: { [itemId: string]: number };
}

export interface BoxConfiguration {
  boxNumber: number; // Sequential: 1, 2, 3, ...
  boxTypeId: string;
  vendorId?: string;
  items: { [itemId: string]: number };
  itemPrices?: { [itemId: string]: number };
  notes?: string;
}
```

#### 1.2 Create Migration Helper Functions
**File**: `lib/box-order-helpers.ts` (NEW)

```typescript
import { OrderConfiguration, BoxConfiguration } from './types';

/**
 * Convert legacy box order format to new boxes[] format
 */
export function migrateLegacyBoxOrder(config: OrderConfiguration): OrderConfiguration {
  if (config.serviceType !== 'Boxes') return config;
  
  // If already in new format, return as-is
  if (config.boxes && config.boxes.length > 0) {
    return config;
  }
  
  // Convert legacy format
  if (config.boxQuantity && config.boxQuantity > 0 && config.boxTypeId) {
    const boxes: BoxConfiguration[] = [];
    const items = config.items || {};
    const itemPrices = config.itemPrices || {};
    
    // Create boxes based on quantity
    for (let i = 1; i <= config.boxQuantity; i++) {
      boxes.push({
        boxNumber: i,
        boxTypeId: config.boxTypeId,
        vendorId: config.vendorId,
        items: { ...items }, // Each box gets same items initially
        itemPrices: { ...itemPrices },
        notes: undefined
      });
    }
    
    return {
      ...config,
      boxes,
      // Keep legacy fields for backward compatibility during transition
      boxQuantity: config.boxQuantity,
      items: config.items,
      itemPrices: config.itemPrices
    };
  }
  
  // No boxes configured yet
  return {
    ...config,
    boxes: []
  };
}

/**
 * Get total number of boxes from order config (supports both formats)
 */
export function getTotalBoxCount(config: OrderConfiguration): number {
  if (config.serviceType !== 'Boxes') return 0;
  if (config.boxes && config.boxes.length > 0) {
    return config.boxes.length;
  }
  return config.boxQuantity || 0;
}

/**
 * Validate box count against authorized amount
 */
export function validateBoxCountAgainstAuthorization(
  boxCount: number,
  authorizedAmount: number | null | undefined,
  boxTypePrice?: number
): { valid: boolean; message?: string } {
  if (!authorizedAmount || authorizedAmount <= 0) {
    return { valid: true }; // No limit if not set
  }
  
  if (!boxTypePrice || boxTypePrice <= 0) {
    return { valid: true }; // Can't validate without price
  }
  
  const totalCost = boxCount * boxTypePrice;
  const maxBoxes = Math.floor(authorizedAmount / boxTypePrice);
  
  if (totalCost > authorizedAmount) {
    return {
      valid: false,
      message: `Total cost ($${totalCost.toFixed(2)}) exceeds authorized amount ($${authorizedAmount.toFixed(2)}). Maximum ${maxBoxes} boxes allowed.`
    };
  }
  
  return { valid: true };
}
```

---

### Phase 2: UI Updates - Client Portal Interface

#### 2.1 Update ClientPortalInterface.tsx

**Key Changes**:
1. Replace single box UI with multiple boxes array
2. Add "Add Box" button with max validation
3. Display box number for each box
4. Show items per box (different interface)
5. Display authorization status

**Location**: `components/clients/ClientPortalInterface.tsx` (lines 1265-1495)

**New Structure**:
```tsx
{client.serviceType === 'Boxes' && (
  <div>
    {/* Authorization Status Header */}
    <div className={styles.boxAuthorizationHeader}>
      <div>
        <strong>Boxes Authorized:</strong> {client.authorizedAmount ? 
          `${Math.floor(client.authorizedAmount / (boxType?.priceEach || 1))} boxes` : 
          'Unlimited'}
      </div>
      <div>
        <strong>Current Boxes:</strong> {getTotalBoxCount(orderConfig)} / {
          client.authorizedAmount ? 
            Math.floor(client.authorizedAmount / (boxType?.priceEach || 1)) : 
            '∞'
        }
      </div>
    </div>

    {/* Boxes List */}
    {orderConfig.boxes?.map((box, index) => (
      <div key={box.boxNumber} className={styles.boxCard}>
        <div className={styles.boxHeader}>
          <h4>Box #{box.boxNumber}</h4>
          <button 
            onClick={() => removeBox(box.boxNumber)}
            disabled={orderConfig.boxes.length <= 1}
          >
            <Trash2 size={16} />
          </button>
        </div>
        
        {/* Box Type Selector */}
        <select
          value={box.boxTypeId}
          onChange={(e) => updateBoxType(box.boxNumber, e.target.value)}
        >
          {boxTypes.map(bt => (
            <option key={bt.id} value={bt.id}>{bt.name}</option>
          ))}
        </select>

        {/* Items for THIS box - Different interface */}
        <div className={styles.boxItemsGrid}>
          {categories.map(category => {
            const categoryItems = getCategoryItems(category.id);
            const boxCategoryItems = categoryItems.filter(item => 
              box.items[item.id] > 0
            );
            
            if (boxCategoryItems.length === 0) return null;
            
            return (
              <div key={category.id} className={styles.boxCategorySection}>
                <h5>{category.name}</h5>
                <div className={styles.boxItemsList}>
                  {boxCategoryItems.map(item => (
                    <div key={item.id} className={styles.boxItemRow}>
                      <span>{item.name}</span>
                      <div className={styles.quantityControl}>
                        <button onClick={() => updateBoxItem(box.boxNumber, item.id, -1)}>-</button>
                        <span>{box.items[item.id] || 0}</span>
                        <button onClick={() => updateBoxItem(box.boxNumber, item.id, 1)}>+</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    ))}

    {/* Add Box Button */}
    <button
      onClick={handleAddBox}
      disabled={!canAddMoreBoxes()}
      className="btn btn-primary"
    >
      <Plus size={16} /> Add Another Box
    </button>
    
    {!canAddMoreBoxes() && (
      <div className={styles.alert}>
        <AlertTriangle size={16} />
        Maximum boxes reached based on authorized amount.
      </div>
    )}
  </div>
)}
```

**New Helper Functions**:
```typescript
function canAddMoreBoxes(): boolean {
  if (!client.authorizedAmount) return true; // No limit
  
  const currentBoxCount = getTotalBoxCount(orderConfig);
  const boxType = boxTypes.find(bt => bt.id === orderConfig.boxes?.[0]?.boxTypeId);
  if (!boxType?.priceEach) return true;
  
  const maxBoxes = Math.floor(client.authorizedAmount / boxType.priceEach);
  return currentBoxCount < maxBoxes;
}

function handleAddBox() {
  if (!canAddMoreBoxes()) return;
  
  const currentBoxes = orderConfig.boxes || [];
  const nextBoxNumber = currentBoxes.length + 1;
  const defaultBoxTypeId = boxTypes.find(bt => bt.isActive)?.id || '';
  
  const newBox: BoxConfiguration = {
    boxNumber: nextBoxNumber,
    boxTypeId: defaultBoxTypeId,
    items: {},
    itemPrices: {}
  };
  
  setOrderConfig({
    ...orderConfig,
    boxes: [...currentBoxes, newBox]
  });
}

function removeBox(boxNumber: number) {
  const currentBoxes = orderConfig.boxes || [];
  const updatedBoxes = currentBoxes
    .filter(b => b.boxNumber !== boxNumber)
    .map((b, index) => ({ ...b, boxNumber: index + 1 })); // Renumber
  
  setOrderConfig({
    ...orderConfig,
    boxes: updatedBoxes
  });
}

function updateBoxItem(boxNumber: number, itemId: string, delta: number) {
  const currentBoxes = orderConfig.boxes || [];
  const updatedBoxes = currentBoxes.map(box => {
    if (box.boxNumber !== boxNumber) return box;
    
    const currentQty = box.items[itemId] || 0;
    const newQty = Math.max(0, currentQty + delta);
    
    const newItems = { ...box.items };
    if (newQty > 0) {
      newItems[itemId] = newQty;
    } else {
      delete newItems[itemId];
    }
    
    return { ...box, items: newItems };
  });
  
  setOrderConfig({
    ...orderConfig,
    boxes: updatedBoxes
  });
}
```

---

### Phase 3: UI Updates - Admin Client Profile

#### 3.1 Update ClientProfile.tsx

**Location**: `components/clients/ClientProfile.tsx` (lines 3162-3400)

Similar changes to ClientPortalInterface, but with admin-specific features:
- Ability to override authorization limits
- Bulk operations (copy items from one box to another)
- Box reordering

---

### Phase 4: Backend/Sync Logic Updates

#### 4.1 Update syncCurrentOrderToUpcoming
**File**: `lib/actions.ts`

**Changes**:
1. Handle `boxes[]` array format
2. Create separate upcoming orders for each box (or combine based on business logic)
3. Maintain box numbers in order metadata

```typescript
// In syncCurrentOrderToUpcoming function
if (orderConfig.serviceType === 'Boxes') {
  // Migrate legacy format if needed
  const migratedConfig = migrateLegacyBoxOrder(orderConfig);
  
  if (migratedConfig.boxes && migratedConfig.boxes.length > 0) {
    // Process each box
    for (const box of migratedConfig.boxes) {
      // Create upcoming order for this box
      // Or combine all boxes into one order with box metadata
      await syncSingleBoxOrder(clientId, box, orderConfig);
    }
  }
}
```

#### 4.2 Update syncSingleOrderForDeliveryDay
**File**: `lib/actions.ts`

Handle boxes array when syncing to `upcoming_orders` table.

---

### Phase 5: Validation Updates

#### 5.1 Update Validation Logic
**File**: `components/clients/ClientProfile.tsx` (validation function)

```typescript
if (formData.serviceType === 'Boxes') {
  const messages: string[] = [];
  
  // Validate boxes array exists
  if (!orderConfig.boxes || orderConfig.boxes.length === 0) {
    messages.push('Please add at least one box to the order.');
  }
  
  // Validate against authorization
  if (orderConfig.boxes && orderConfig.boxes.length > 0) {
    const boxType = boxTypes.find(bt => bt.id === orderConfig.boxes[0].boxTypeId);
    const validation = validateBoxCountAgainstAuthorization(
      orderConfig.boxes.length,
      client.authorizedAmount,
      boxType?.priceEach
    );
    
    if (!validation.valid) {
      messages.push(validation.message || 'Box count exceeds authorization.');
    }
  }
  
  // Validate each box's quota requirements
  for (const box of orderConfig.boxes || []) {
    // Existing quota validation logic per box
    // ...
  }
  
  if (messages.length > 0) {
    return { isValid: false, messages };
  }
}
```

---

## UI/UX Enhancements

### Visual Design for Multiple Boxes

1. **Box Cards**: Each box in its own card with:
   - Box number badge (prominent)
   - Box type selector
   - Items grid (compact, different from single-box view)
   - Remove button (disabled if only one box)

2. **Authorization Display**:
   - Progress bar showing boxes used vs. authorized
   - Color coding (green/yellow/red)
   - Warning when approaching limit

3. **Item Display Differences**:
   - **Single Box**: Full category sections with all items
   - **Multiple Boxes**: Show only selected items per box, grouped by category
   - More compact layout
   - Per-box quota validation display

4. **Add Box Button**:
   - Prominent placement
   - Disabled state with tooltip when limit reached
   - Animation on add

---

## Database Considerations

### No Schema Changes Required
- Current structure supports JSON storage of `boxes[]` array
- `active_order` and `upcoming_orders` JSONB columns can store new format
- Backward compatible with existing data

### Optional Enhancements
- Add `box_number` column to `order_items` for direct tracking (future optimization)
- Add `box_configurations` table for complex queries (future optimization)

---

## Migration Path

### Step 1: Add New Types (Non-breaking)
- Add `BoxConfiguration` interface
- Add `boxes?` field to `OrderConfiguration`
- Keep legacy fields for backward compatibility

### Step 2: Add Migration Helpers
- Create `lib/box-order-helpers.ts`
- Implement migration functions

### Step 3: Update UI Components
- Update `ClientPortalInterface.tsx`
- Update `ClientProfile.tsx`
- Test with both old and new data formats

### Step 4: Update Backend Logic
- Update `syncCurrentOrderToUpcoming`
- Update `syncSingleOrderForDeliveryDay`
- Test order creation and syncing

### Step 5: Validation & Testing
- Test with legacy data (auto-migration)
- Test with new data format
- Test authorization limits
- Test box add/remove operations

### Step 6: Cleanup (Future)
- Remove legacy field support after transition period
- Update all references to use new format

---

## Testing Checklist

- [ ] Legacy order config loads and displays correctly
- [ ] Legacy order config auto-migrates to new format on save
- [ ] New box can be added up to authorization limit
- [ ] Cannot add box beyond authorization limit
- [ ] Box can be removed (minimum 1 box required)
- [ ] Box numbers renumber correctly after removal
- [ ] Items can be configured per box independently
- [ ] Quota validation works per box
- [ ] Authorization display updates correctly
- [ ] Order saves with boxes array format
- [ ] Order syncs to upcoming_orders correctly
- [ ] Multiple boxes display correctly in order history

---

## Implementation Priority

### High Priority (Core Functionality)
1. ✅ Data structure updates
2. ✅ Migration helpers
3. ✅ ClientPortalInterface UI
4. ✅ Validation logic

### Medium Priority (Admin Features)
5. ✅ ClientProfile UI updates
6. ✅ Backend sync logic

### Low Priority (Enhancements)
7. Bulk operations (copy items between boxes)
8. Box reordering
9. Box templates/presets

---

## Notes

- **Backward Compatibility**: Critical - must support existing orders
- **Authorization Logic**: `authorizedAmount` divided by `boxType.priceEach` = max boxes
- **Box Numbering**: Sequential, starting at 1, renumbers on removal
- **Item Interface**: Different layout for multiple boxes (more compact, shows only selected items)
- **Performance**: Consider pagination if many boxes (unlikely but possible)

---

**Document Version**: 1.0  
**Last Updated**: Current Date  
**Status**: Ready for Implementation
