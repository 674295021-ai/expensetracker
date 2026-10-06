-- ===================================================================
-- Cloudflare D1 Migration: 0002_features_upgrade.sql
-- Application: ExpenseTracker Pro Upgrade
-- Features: Trips (Travel Mode), Investments (Dime Portfolio), LINE Bot Account Linking
-- ===================================================================

-- Table: trips (Travel Mode)
CREATE TABLE IF NOT EXISTS trips (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    destination TEXT,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    budget REAL DEFAULT 0,
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'completed')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Table: trip_expenses
CREATE TABLE IF NOT EXISTS trip_expenses (
    id TEXT PRIMARY KEY,
    trip_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    category TEXT NOT NULL,
    amount REAL NOT NULL CHECK(amount > 0),
    note TEXT,
    expense_date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Table: investments (Portfolio & Dime Tracking)
CREATE TABLE IF NOT EXISTS investments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    institution TEXT NOT NULL,
    asset_type TEXT NOT NULL,
    principal REAL NOT NULL CHECK(principal >= 0),
    current_value REAL NOT NULL CHECK(current_value >= 0),
    note TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Table: line_users (LINE Messaging API Account Link)
CREATE TABLE IF NOT EXISTS line_users (
    line_user_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    display_name TEXT,
    picture_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Table: line_link_tokens (Temporary code to connect LINE account)
CREATE TABLE IF NOT EXISTS line_link_tokens (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_trips_user ON trips(user_id, status);
CREATE INDEX IF NOT EXISTS idx_trip_expenses_trip ON trip_expenses(trip_id, expense_date);
CREATE INDEX IF NOT EXISTS idx_trip_expenses_user ON trip_expenses(user_id, expense_date);
CREATE INDEX IF NOT EXISTS idx_investments_user ON investments(user_id, institution);
CREATE INDEX IF NOT EXISTS idx_line_users_user ON line_users(user_id);
CREATE INDEX IF NOT EXISTS idx_line_link_tokens_user ON line_link_tokens(user_id);
