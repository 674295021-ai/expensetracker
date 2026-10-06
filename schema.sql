-- ===================================================================
-- Cloudflare D1 Schema: schema.sql
-- Application: ExpenseTracker Pro (ระบบบันทึกรายรับ-รายจ่าย)
-- Standards: Skill 04 - Database Design (3NF, Foreign Keys, Indexes)
-- ===================================================================

-- Table: users
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    picture TEXT,
    role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table: transactions
CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
    category TEXT NOT NULL,
    amount REAL NOT NULL CHECK(amount > 0),
    note TEXT,
    transaction_date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Performance Indexes for fast filtering and summary queries
CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON transactions(user_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_user_type ON transactions(user_id, type);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

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

