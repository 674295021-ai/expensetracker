-- ===================================================================
-- Cloudflare D1 Migration: 0004_transfer_ownership_and_roles.sql
-- Application: ExpenseTracker Pro
-- Operation: Data Transfer & Role Update
-- Source User: 674295021@parichat.skru.ac.th (ID: 115273274891030218157)
-- Target User: akbarkhansarikhan@gmail.com (ID: 117928652729046573003)
-- Maintained Admin: seree999@gmail.com
-- ===================================================================

-- 1. Update Roles
UPDATE users SET role = 'admin' WHERE email = 'akbarkhansarikhan@gmail.com';
UPDATE users SET role = 'user' WHERE email = '674295021@parichat.skru.ac.th';

-- 2. Transfer Data Ownership
UPDATE transactions SET user_id = '117928652729046573003' WHERE user_id = '115273274891030218157';
UPDATE trips SET user_id = '117928652729046573003' WHERE user_id = '115273274891030218157';
UPDATE trip_expenses SET user_id = '117928652729046573003' WHERE user_id = '115273274891030218157';
UPDATE investments SET user_id = '117928652729046573003' WHERE user_id = '115273274891030218157';
UPDATE line_users SET user_id = '117928652729046573003' WHERE user_id = '115273274891030218157';
UPDATE line_link_tokens SET user_id = '117928652729046573003' WHERE user_id = '115273274891030218157';
UPDATE user_active_trips SET user_id = '117928652729046573003' WHERE user_id = '115273274891030218157';
