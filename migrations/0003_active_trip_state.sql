-- ===================================================================
-- Cloudflare D1 Migration: 0003_active_trip_state.sql
-- Application: ExpenseTracker Pro Upgrade
-- Features: Active Trip State & Isolation (Travel Mode)
-- ===================================================================

CREATE TABLE IF NOT EXISTS user_active_trips (
    user_id TEXT PRIMARY KEY,
    trip_id TEXT NOT NULL,
    activated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_active_trips_trip ON user_active_trips(trip_id);
