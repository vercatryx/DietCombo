# TriangleOrder Core System Updates Analysis

This document identifies all updates and new features in `/triangleorder` that are not present in the root application.

## Executive Summary

The `/triangleorder` directory contains significant updates to the core meal management system, client portal enhancements, authentication improvements, and new admin features. The root application has additional features for routes/drivers management and geocoding that are not in triangleorder.

---

## 1. NEW ADMIN FEATURES

### 1.1 Meal Selection Management System
**Location:** `triangleorder/components/admin/MealSelectionManagement.tsx`

**New Features:**
- Complete meal selection management interface with drag-and-drop reordering
- Support for multiple meal types (Breakfast, Lunch, Dinner, and custom types)
- Category-based meal organization with set value requirements
- Image upload and cropping for meal items
- Sort order management for both categories and items
- Meal type creation and deletion
- Visual meal type tabs with active state management

**Key Capabilities:**
- Drag-and-drop reordering using `@dnd-kit` library
- Image cropping using `react-image-crop` and `react-easy-crop`
- Category set value validation
- Meal item quota management
- Price per item tracking

**Dependencies Added:**
- `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`
- `react-easy-crop`, `react-image-crop`
- `react-textarea-autosize`

### 1.2 Image Cropper Component
**Location:** `triangleorder/components/admin/ImageCropper.tsx`

**Features:**
- Standalone image cropping component
- Canvas-based image processing
- JPEG compression (0.9 quality)
- Responsive cropping interface

### 1.3 Admin Page Updates
**Location:** `triangleorder/app/admin/page.tsx`

**Changes:**
- Added "Meal Selection" tab (new tab type: `'mealSelect'`)
- Integrated `MealSelectionManagement` component
- Updated tab navigation to include meal selection management

---

## 2. CLIENT PORTAL ENHANCEMENTS

### 2.1 Client Info Shelf Component
**Location:** `triangleorder/components/clients/ClientInfoShelf.tsx`

**New Features:**
- Comprehensive client information sidebar/shelf
- Inline editing capabilities for all client fields
- Dependent management (add, view dependents)
- Screening form integration
- Financial and eligibility information display
- Service type management (Food, Boxes, Equipment)
- Case ID tracking
- Active order summary display
- Screening form submissions viewer
- PDF download for approved submissions

**Key Fields:**
- Authorized amount and expiration date
- Approved meals per week
- Secondary phone number
- Dependent DOB and CIN tracking
- Screening status tracking (not_started, waiting_approval, approved, rejected)

### 2.2 Client Portal Header
**Location:** `triangleorder/components/clients/ClientPortalHeader.tsx`

**Features:**
- Meal count display with limit validation
- Take effect date display
- Validation error warnings
- Add vendor and add meal type buttons
- Visual status indicators (over/under limit)

### 2.3 Client Portal Sidebar
**Location:** `triangleorder/components/clients/ClientPortalSidebar.tsx`

**Features:**
- Client avatar and profile display
- Contact information sidebar
- Service plan information
- Logout functionality
- Responsive sidebar layout

### 2.4 Food Service Widget
**Location:** `triangleorder/components/clients/FoodServiceWidget.tsx`

**Major Updates:**
- Multi-day delivery support per vendor
- Meal selection blocks (Breakfast, Lunch, Dinner)
- Category-based meal organization
- Set value validation per category
- Vendor-specific delivery day selection
- Items by day tracking (`itemsByDay`, `itemNotesByDay`)
- Minimum meal validation per vendor
- Take effect date calculation
- Enhanced note support per item per day

**Key Improvements:**
- Support for vendors with multiple delivery days
- Day-specific item selection
- Category quota validation
- Meal type management
- Enhanced UI with stacked menu blocks for multi-day orders

### 2.5 Menu Item Card Component
**Location:** `triangleorder/components/clients/MenuItemCard.tsx`

**Features:**
- Image display with fallback placeholder
- Modal view for detailed item information
- Quantity controls with increment/decrement
- Note/instruction input per item
- Context label support (vendor name, category)
- Responsive card layout
- Image error handling

---

## 3. AUTHENTICATION & LOGIN UPDATES

### 3.1 Passwordless Login Verification
**Location:** `triangleorder/app/login/verify/page.tsx`

**New Features:**
- OTP verification page
- Email and code parameter handling
- Automatic redirect on successful verification
- Error handling for invalid/expired links
- Integration with `verifyOtp` action

**SQL Migration:** `add_passwordless_login.sql`

---

## 4. LIBRARY & UTILITY UPDATES

### 4.1 Canvas Utilities
**Location:** `triangleorder/lib/canvasUtils.ts`

**Features:**
- Image cropping utilities
- Canvas manipulation functions
- Rotation and flip support
- Blob generation for cropped images
- Pixel crop conversion

---

## 5. DATABASE SCHEMA UPDATES

### 5.1 Meal Management Schema
**SQL Files:**
- `add_breakfast_menus.sql` - Breakfast menu support
- `add_meal_type_to_categories.sql` - Meal type association
- `add_meal_type_to_item_categories.sql` - Item category meal types
- `add_meal_type_to_upcoming_orders.sql` - Order meal type tracking
- `add_meal_item_id_column.sql` - Meal item ID column
- `add_meal_service_type.sql` - Service type for meals
- `add_sort_and_image_to_meals.sql` - Sort order and images for meals
- `add_image_url_to_menu_items.sql` - Image URLs for menu items
- `add_sort_order_to_menu_items.sql` - Sort order for menu items
- `add_notes_to_items.sql` - Notes support for order items
- `change_quota_to_decimal.sql` - Decimal quota values
- `fix_meal_item_deletion_constraints.sql` - Deletion constraint fixes

### 5.2 Client Schema Updates
**SQL Files:**
- `add_dob_and_cin_to_clients.sql` - DOB and CIN fields
- `add_authorized_amount_and_expiration_date_to_clients.sql` - Financial fields
- `alter_cin_to_varchar.sql` - CIN data type change
- `add_custom_service_type.sql` - Custom service types
- `add_custom_fields_to_upcoming.sql` - Custom order fields
- `add_custom_order_support.sql` - Custom order support

### 5.3 Box & Equipment Schema
**SQL Files:**
- `add_sort_and_image_to_boxes.sql` - Sort order and images for boxes
- `add_box_notes.sql` - Box notes support (in migrations folder)

### 5.4 System Settings
**SQL Files:**
- `add_vendor_cutoff.sql` - Vendor cutoff times
- `add_report_email_to_app_settings.sql` - Report email configuration
- `allow_null_take_effect_date.sql` - Nullable take effect date

### 5.5 Constraint & Data Type Fixes
**SQL Files:**
- `drop_status_constraint.sql` - Status constraint removal
- `drop_order_items_menu_item_id_fkey.sql` - Foreign key removal
- `drop_updated_by_fkey_constraints.sql` - Updated by constraints
- `make_updated_by_nullable_in_order_tables.sql` - Nullable updated_by
- `make_vendor_id_nullable.sql` - Nullable vendor ID
- `fix_upcoming_orders_constraint.sql` - Upcoming orders fixes
- `remove_focus_columns.sql` - Focus column removal

### 5.6 Advanced Features
**SQL Files:**
- `inferred_client_box_orders.sql` - Inferred box orders
- `add_passwordless_login.sql` - Passwordless authentication

---

## 6. PACKAGE DEPENDENCY UPDATES

### 6.1 New Dependencies in triangleorder
```json
{
  "@dnd-kit/core": "^6.3.1",
  "@dnd-kit/sortable": "^10.0.0",
  "@dnd-kit/utilities": "^3.2.2",
  "react-easy-crop": "^5.5.6",
  "react-image-crop": "^11.0.10",
  "react-textarea-autosize": "^8.5.9",
  "@types/react-easy-crop": "^1.16.0"
}
```

### 6.2 Dependencies in Root (Not in triangleorder)
```json
{
  "@mui/material": "^7.3.6",
  "@mui/icons-material": "^7.3.6",
  "@emotion/react": "^11.14.0",
  "@emotion/styled": "^11.14.1",
  "@turf/turf": "^7.2.0",
  "leaflet": "^1.9.4",
  "react-leaflet": "^5.0.0",
  "@types/leaflet": "^1.9.21",
  "mysql2": "^3.16.0"
}
```

---

## 7. API ROUTE DIFFERENCES

### 7.1 Routes Only in Root App
- `app/api/geocode/route.ts` - Geocoding service
- `app/api/geocode/search/route.ts` - Geocode search
- `app/api/mobile/routes/route.ts` - Mobile routes API
- `app/api/mobile/stops/route.ts` - Mobile stops API
- `app/api/mobile/stop/complete/route.ts` - Stop completion
- `app/api/route/*` - Complete route management system:
  - `add-driver/route.ts`
  - `apply-run/route.ts`
  - `cleanup/route.ts`
  - `generate/route.ts`
  - `optimize/route.ts`
  - `reassign/route.ts`
  - `remove-driver/route.ts`
  - `rename-driver/route.ts`
  - `reset/route.ts`
  - `reverse/route.ts`
  - `routes/route.ts`
  - `runs/route.ts`
  - `runs/save-current/route.ts`
- `app/api/signatures/*` - Signature management:
  - `[token]/route.ts`
  - `admin/[token]/route.ts`
  - `ensure-token/[clientId]/route.ts`
  - `status/route.ts`
- `app/api/users/route.ts` - User management
- `app/api/users/[id]/route.ts` - User by ID

### 7.2 Routes Only in triangleorder
- `app/api/create-test-client/route.ts` - Test client creation
- `app/api/debug/create-test-client/route.ts` - Debug test client

---

## 8. PAGE DIFFERENCES

### 8.1 Pages Only in Root App
- `app/routes/page.tsx` - Routes management page
- `app/drivers/page.tsx` - Drivers listing page
- `app/drivers/[id]/page.tsx` - Driver detail page
- `app/sign/[token]/page.tsx` - Signature page
- `app/sign/[token]/view/page.tsx` - Signature view page

### 8.2 Pages Only in triangleorder
- `app/login/verify/page.tsx` - Login verification page

---

## 9. COMPONENT DIFFERENCES

### 9.1 Components Only in Root App
- `components/drivers/*` - Complete drivers management:
  - `DriversGrid.tsx`
  - `DriversMapLeaflet.tsx`
  - `MapLoadingOverlay.tsx`
  - `SearchStops.tsx`
- `components/routes/*` - Route management components:
  - `DriversDialog.jsx`
  - `DriversMapLeaflet.jsx`
  - `ManualGeocodeDialog.jsx`
  - `MapConfirmDialog.jsx`
  - `MapLoadingOverlay.jsx`
- `components/clients/MapConfirmDialog.tsx` - Map confirmation dialog

### 9.2 Components Only in triangleorder
- `components/admin/ImageCropper.tsx` - Image cropping component
- `components/admin/MealSelectionManagement.tsx` - Meal selection management
- `components/clients/ClientInfoShelf.tsx` - Client info sidebar
- `components/clients/ClientPortalHeader.tsx` - Portal header
- `components/clients/ClientPortalSidebar.tsx` - Portal sidebar
- `components/clients/ClientPortalOrderSummary.tsx` - Order summary component
- `components/clients/FoodServiceWidget.tsx` - Enhanced food service widget
- `components/clients/MenuItemCard.tsx` - Menu item card component
- `components/clients/ClientPortal.module.css` - Portal styles

---

## 10. LIBRARY FILE DIFFERENCES

### 10.1 Files Only in Root App
- `lib/addressHelpers.ts` - Address helper utilities
- `lib/api.js` - API utilities
- `lib/geocodeOneClient.ts` - Geocoding for clients
- `lib/maps.js` - Maps utilities
- `lib/mysql.ts` - MySQL database connection

### 10.2 Files Only in triangleorder
- `lib/canvasUtils.ts` - Canvas manipulation utilities

---

## 11. KEY FUNCTIONALITY DIFFERENCES

### 11.1 Meal Management System (triangleorder only)
- **Complete meal selection system** with categories, items, and meal types
- **Drag-and-drop reordering** for categories and items
- **Image management** with cropping for meal items
- **Set value validation** for meal categories
- **Multi-meal-type support** (Breakfast, Lunch, Dinner, custom)
- **Sort order management** throughout the meal hierarchy

### 11.2 Client Portal Enhancements (triangleorder only)
- **Enhanced client information display** with inline editing
- **Dependent management** (add, view, track DOB/CIN)
- **Screening form integration** with status tracking
- **Multi-day delivery support** per vendor
- **Category-based meal selection** with quota validation
- **Enhanced note support** per item per delivery day
- **Visual meal count tracking** with limit validation

### 11.3 Routes & Drivers System (root only)
- **Complete route optimization system**
- **Driver assignment and management**
- **Mobile API for stops and routes**
- **Geocoding services**
- **Map-based route visualization**
- **Signature collection system**

---

## 12. MIGRATION PRIORITY RECOMMENDATIONS

### High Priority (Core Functionality)
1. **Meal Selection Management System** - Complete meal management overhaul
2. **Client Portal Enhancements** - Improved client experience
3. **Image Management** - Image cropping and upload for meal items
4. **Multi-day Delivery Support** - Enhanced order management
5. **Dependent Management** - Client relationship tracking

### Medium Priority (User Experience)
1. **Client Info Shelf** - Better client information display
2. **Menu Item Cards** - Enhanced item selection UI
3. **Passwordless Login** - Improved authentication flow
4. **Category Set Value Validation** - Order validation improvements

### Low Priority (Nice to Have)
1. **Test Client Creation API** - Development utilities
2. **Debug Routes** - Development tools

---

## 13. INTEGRATION CONSIDERATIONS

### 13.1 Database Migrations
All SQL files in `triangleorder/sql/` should be reviewed and applied in order:
1. Schema changes (meal types, categories, items)
2. Client field additions (DOB, CIN, authorized amount)
3. Constraint modifications
4. Feature additions (passwordless login, custom orders)

### 13.2 Component Integration
- Meal selection management requires drag-and-drop libraries
- Image cropping requires canvas utilities
- Client portal components are interdependent

### 13.3 API Compatibility
- Root app has extensive route/driver APIs not in triangleorder
- Consider maintaining both sets of APIs if both features are needed

---

## 14. SUMMARY OF MAJOR UPDATES

1. **Meal Management Overhaul** - Complete new system for managing meals, categories, and meal types
2. **Enhanced Client Portal** - Significantly improved client interface with better information display
3. **Image Support** - Image upload and cropping for meal items
4. **Multi-day Delivery** - Support for vendors with multiple delivery days
5. **Dependent Tracking** - Full dependent management system
6. **Screening Forms** - Enhanced screening form integration with status tracking
7. **Passwordless Login** - OTP-based authentication
8. **Category Validation** - Set value requirements for meal categories
9. **Drag-and-Drop** - Reordering capabilities throughout meal management
10. **Enhanced Notes** - Per-item, per-day note support

---

## 15. FILES TO REVIEW FOR INTEGRATION

### Critical Files
- `triangleorder/components/admin/MealSelectionManagement.tsx`
- `triangleorder/components/clients/FoodServiceWidget.tsx`
- `triangleorder/components/clients/ClientInfoShelf.tsx`
- `triangleorder/components/clients/MenuItemCard.tsx`
- `triangleorder/lib/canvasUtils.ts`
- `triangleorder/app/admin/page.tsx`

### Database Migrations
- Review all SQL files in `triangleorder/sql/` directory
- Apply migrations in chronological order
- Test constraint changes carefully

### Package Updates
- Add drag-and-drop libraries
- Add image cropping libraries
- Add textarea autosize library

---

**Document Generated:** Analysis of triangleorder updates vs root application
**Last Updated:** Current analysis date
