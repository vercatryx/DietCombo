# Login Credentials for DietCombo Sample Data

This document contains the login credentials for testing the DietCombo application with the sample data.

## Admin Accounts

### Admin User 1
- **Username:** `admin`
- **Password:** `admin123`
- **Name:** System Administrator
- **Access Level:** Full admin access

### Admin User 2
- **Username:** `manager`
- **Password:** `admin123`
- **Name:** Manager Admin
- **Access Level:** Full admin access

## Vendor Accounts

### Vendor 1 - Fresh Meals Co
- **Email:** `vendor1@dietcombo.com`
- **Password:** `vendor123`
- **Service Type:** Meals
- **Delivery Days:** Monday, Wednesday, Friday
- **Status:** Active

### Vendor 2 - Healthy Box Delivery
- **Email:** `vendor2@dietcombo.com`
- **Password:** `vendor123`
- **Service Type:** Boxes
- **Delivery Days:** Tuesday, Thursday
- **Status:** Active

### Vendor 3 - Gourmet Nutrition
- **Email:** `vendor3@dietcombo.com`
- **Password:** `vendor123`
- **Service Type:** Meals, Boxes
- **Delivery Days:** Monday through Friday
- **Status:** Active

## Navigator Accounts

### Navigator 1 - Sarah Johnson
- **Email:** `navigator1@dietcombo.com`
- **Password:** `navigator123`
- **Status:** Active
- **Assigned Clients:** John Smith, Jane Doe

### Navigator 2 - Michael Chen
- **Email:** `navigator2@dietcombo.com`
- **Password:** `navigator123`
- **Status:** Active
- **Assigned Clients:** Robert Johnson, Maria Garcia

### Navigator 3 - Emily Rodriguez
- **Email:** `navigator3@dietcombo.com`
- **Password:** `navigator123`
- **Status:** Active
- **Assigned Clients:** David Lee, Sarah Williams

## Client Accounts

Clients can access their portal using their email addresses. Note that clients may use passwordless login if enabled in app settings.

### Sample Clients:
1. **John Smith**
   - Email: `john.smith@example.com`
   - Status: Active
   - Service Type: Meals
   - Approved Meals: 10 per week

2. **Jane Doe**
   - Email: `jane.doe@example.com`
   - Status: Active
   - Service Type: Boxes
   - Approved Meals: 7 per week

3. **Robert Johnson**
   - Email: `robert.johnson@example.com`
   - Status: Pending Approval
   - Service Type: Meals
   - Approved Meals: 14 per week

4. **Maria Garcia**
   - Email: `maria.garcia@example.com`
   - Status: Active
   - Service Type: Meals, Boxes
   - Approved Meals: 12 per week

5. **David Lee**
   - Email: `david.lee@example.com`
   - Status: Active
   - Service Type: Meals
   - Approved Meals: 8 per week

6. **Sarah Williams**
   - Email: `sarah.williams@example.com`
   - Status: On Hold
   - Service Type: Boxes
   - Approved Meals: 5 per week

## Quick Reference

### For Admin Testing:
- Use `admin` / `admin123` for full system access

### For Vendor Testing:
- Use `vendor1@dietcombo.com` / `vendor123` to test meal vendor functionality
- Use `vendor2@dietcombo.com` / `vendor123` to test box vendor functionality

### For Navigator Testing:
- Use `navigator1@dietcombo.com` / `navigator123` to test navigator workflows

## Notes

- All passwords are hashed using bcrypt with 10 rounds
- Email addresses are case-insensitive (normalized during login)
- Vendors and Navigators must be active (`is_active = TRUE`) to log in
- Clients may use passwordless login if enabled in app settings
- The sample data includes orders, upcoming orders, delivery history, and billing records

## Installation

To use this sample data:

1. First, run the schema file:
   ```bash
   mysql -u root -p < sql/mysql-schema.sql
   ```

2. Then, run the sample data file:
   ```bash
   mysql -u root -p < sql/sample-data.sql
   ```

3. Verify the data was inserted:
   ```sql
   SELECT COUNT(*) FROM clients;
   SELECT COUNT(*) FROM vendors;
   SELECT COUNT(*) FROM navigators;
   SELECT COUNT(*) FROM admins;
   ```

