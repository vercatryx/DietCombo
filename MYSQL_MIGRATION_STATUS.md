# MySQL Migration Status

## Completed

1. ✅ Installed `mysql2` package
2. ✅ Created MySQL connection module (`lib/mysql.ts`)
3. ✅ Created MySQL database schema (`sql/mysql-schema.sql`)
4. ✅ Converted basic CRUD operations in `lib/actions.ts`:
   - Status actions (getStatuses, addStatus, updateStatus, deleteStatus)
   - Vendor actions (getVendors, getVendor, addVendor, updateVendor, deleteVendor)
   - Menu item actions (getMenuItems, addMenuItem, updateMenuItem, deleteMenuItem)
   - Category actions (getCategories, addCategory, updateCategory, deleteCategory)
   - Equipment actions (getEquipment, addEquipment, updateEquipment, deleteEquipment)
5. ✅ Started conversion of `lib/form-actions.ts`:
   - saveForm
   - getForms
   - getForm

## Remaining Work

### lib/actions.ts
Still contains ~40 Supabase calls that need conversion:
- Box quota functions
- Box type functions
- App settings functions
- Navigator functions
- Nutritionist functions
- Client functions (complex, includes mapClientFromDB)
- Order functions (very complex, includes multiple joins)
- Upcoming order functions (complex)
- Delivery history functions
- Order history functions
- Billing functions
- Navigator log functions

### lib/form-actions.ts
Still contains Supabase calls for:
- submitForm
- saveSingleForm
- getSingleForm
- createSubmission
- getSubmissionByToken
- updateSubmissionStatus
- finalizeSubmission
- getClientSubmissions

### lib/auth-actions.ts
Needs full conversion:
- sendOtp
- verifyOtp
- login
- checkEmailIdentity
- getAdmins
- addAdmin
- deleteAdmin
- updateAdmin

### lib/local-db.ts
Needs conversion to use MySQL instead of Supabase for syncing

## Next Steps

1. Continue converting remaining functions in `lib/actions.ts` using the patterns established
2. Complete conversion of `lib/form-actions.ts`
3. Convert `lib/auth-actions.ts`
4. Update `lib/local-db.ts` to use MySQL
5. Test all functionality
6. Remove Supabase dependencies from package.json (optional)

## Testing Checklist

- [ ] Database connection works
- [ ] All CRUD operations work
- [ ] Order creation and management
- [ ] Client management
- [ ] Form submissions
- [ ] Authentication
- [ ] Billing operations
- [ ] Delivery tracking

## Notes

- MySQL uses VARCHAR(36) for UUIDs instead of native UUID type
- JSON fields need JSON.stringify() for inserts and JSON.parse() for selects
- MySQL error codes differ from PostgreSQL (e.g., ER_ROW_IS_REFERENCED_2 instead of 23503)
- Use parameterized queries to prevent SQL injection
- The `order` column in questions table is a reserved word, use backticks: `` `order` ``

