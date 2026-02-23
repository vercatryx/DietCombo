# Debug Order Save - Diagnostic Guide

## Added Debug Logging

I've added comprehensive logging throughout the save flow to help identify where orders are failing to save. The logs will show:

1. **Before Save**: Order config structure and validation
2. **During Save**: Each step of the sync process
3. **After Save**: Success/failure status

## How to Debug

### Step 1: Open Browser Console
1. Open your browser's Developer Tools (F12)
2. Go to the Console tab
3. Clear the console

### Step 2: Attempt to Save an Order
1. Configure an order in the client portal
2. Click "Save Changes"
3. Watch the console for log messages

### Step 3: Look for These Log Messages

#### Expected Success Flow:
```
[ClientPortalInterface] About to save order: {...}
[syncCurrentOrderToUpcoming] START {...}
[syncCurrentOrderToUpcoming] orderConfig received: {...}
[syncSingleOrderForDeliveryDay] Start {...}
[syncSingleOrderForDeliveryDay] Successfully inserted...
[syncCurrentOrderToUpcoming] COMPLETE - Order saved successfully
[ClientPortalInterface] syncCurrentOrderToUpcoming completed successfully
```

#### Common Failure Points:

1. **Validation Error**:
   - Look for: `Error: Please select at least one item before saving`
   - **Fix**: Ensure you've selected items for at least one vendor

2. **Date Calculation Error**:
   - Look for: `Cannot save Food order: Missing delivery dates`
   - **Fix**: Ensure vendor has delivery days configured

3. **RLS Error**:
   - Look for: `Database permission error: Row-level security (RLS)`
   - **Fix**: Verify SUPABASE_SERVICE_ROLE_KEY is set correctly

4. **Database Insert Error**:
   - Look for: `[syncSingleOrderForDeliveryDay] Error creating upcoming order`
   - **Check**: Error details will show specific database constraint violations

5. **Empty Order After Filtering**:
   - Look for: `After filtering, no valid orders remain`
   - **Fix**: Ensure vendors have items selected

## Common Issues and Solutions

### Issue 1: Validation Too Strict
**Symptom**: Order appears valid but validation fails
**Check**: Look for validation error messages in console
**Solution**: The validation checks for:
- At least one item selected
- Vendors have delivery days configured
- Case ID for Food orders

### Issue 2: Silent Failure
**Symptom**: Save button does nothing, no error shown
**Check**: Look for any console errors or warnings
**Solution**: All failures now throw explicit errors - check console

### Issue 3: Order Saved but Not Visible
**Symptom**: Save succeeds but order doesn't appear
**Check**: 
- Look for `[syncCurrentOrderToUpcoming] COMPLETE` message
- Check if `router.refresh()` is called
- Verify data in database directly

### Issue 4: Database Constraint Violation
**Symptom**: Error message about database constraints
**Check**: Look for specific error in console:
- Foreign key violations
- NOT NULL constraint violations
- Unique constraint violations

## Next Steps

1. **Run the save operation** and copy all console logs
2. **Share the logs** so we can identify the exact failure point
3. **Check the database** directly to see if data is being saved

## Quick Test

Try saving a simple order:
1. Select a vendor
2. Select at least one item
3. Ensure Case ID is set (for Food orders)
4. Click Save
5. Check console for any errors

If you see specific error messages, share them and we can fix the exact issue.
