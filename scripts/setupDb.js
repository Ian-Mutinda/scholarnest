require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

const schema = `

-- Universities
CREATE TABLE IF NOT EXISTS universities (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  short_name VARCHAR(20) NOT NULL,
  domain VARCHAR(100),
  logo_url VARCHAR(500),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Departments (per university)
CREATE TABLE IF NOT EXISTS departments (
  id SERIAL PRIMARY KEY,
  university_id INT REFERENCES universities(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  slug VARCHAR(100) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(university_id, slug)
);

-- Users
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(200) NOT NULL,
  phone VARCHAR(20),
  university_id INT REFERENCES universities(id),
  role VARCHAR(20) DEFAULT 'buyer' CHECK (role IN ('buyer', 'seller', 'admin')),
  seller_status VARCHAR(20) DEFAULT 'none' CHECK (seller_status IN ('none', 'pending', 'approved', 'suspended')),
  seller_bio TEXT,
  avatar_url VARCHAR(500),
  trust_score DECIMAL(3,2) DEFAULT 5.00,
  total_earnings DECIMAL(12,2) DEFAULT 0,
  pending_earnings DECIMAL(12,2) DEFAULT 0,
  is_verified BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Documents
CREATE TABLE IF NOT EXISTS documents (
  id SERIAL PRIMARY KEY,
  seller_id INT REFERENCES users(id) ON DELETE SET NULL,
  university_id INT REFERENCES universities(id),
  department_id INT REFERENCES departments(id),
  title VARCHAR(300) NOT NULL,
  description TEXT,
  course_code VARCHAR(50),
  year INT,
  file_path VARCHAR(500) NOT NULL,
  total_pages INT DEFAULT 0,
  file_size_bytes BIGINT DEFAULT 0,
  preview_pages INT DEFAULT 1,
  doc_type VARCHAR(30) DEFAULT 'notes' CHECK (doc_type IN ('notes', 'past_paper', 'summary', 'revision_pack', 'bundle')),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'flagged')),
  rejection_reason TEXT,
  price_individual DECIMAL(8,2),
  is_premium BOOLEAN DEFAULT false,
  plagiarism_score DECIMAL(5,2) DEFAULT 0,
  duplicate_of INT REFERENCES documents(id),
  total_views INT DEFAULT 0,
  total_purchases INT DEFAULT 0,
  avg_rating DECIMAL(3,2) DEFAULT 0,
  total_ratings INT DEFAULT 0,
  engagement_points_total BIGINT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Department access passes
CREATE TABLE IF NOT EXISTS department_passes (
  id SERIAL PRIMARY KEY,
  university_id INT REFERENCES universities(id),
  department_id INT REFERENCES departments(id),
  name VARCHAR(200) NOT NULL,
  duration_hours INT NOT NULL,
  price DECIMAL(8,2) NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Access codes (single document)
CREATE TABLE IF NOT EXISTS access_codes (
  id SERIAL PRIMARY KEY,
  code VARCHAR(20) UNIQUE NOT NULL,
  buyer_id INT REFERENCES users(id),
  document_id INT REFERENCES documents(id),
  pass_id INT REFERENCES department_passes(id),
  code_type VARCHAR(20) NOT NULL CHECK (code_type IN ('single', 'pack_5', 'pack_10', 'dept_pass')),
  device_fingerprint VARCHAR(100),
  device_bound_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN DEFAULT true,
  last_accessed TIMESTAMPTZ,
  access_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Purchases / orders
CREATE TABLE IF NOT EXISTS purchases (
  id SERIAL PRIMARY KEY,
  buyer_id INT REFERENCES users(id),
  document_id INT REFERENCES documents(id),
  pass_id INT REFERENCES department_passes(id),
  purchase_type VARCHAR(20) NOT NULL CHECK (purchase_type IN ('individual', 'dept_pass')),
  amount_paid DECIMAL(8,2) NOT NULL,
  platform_cut DECIMAL(8,2) NOT NULL,
  seller_amount DECIMAL(8,2),
  mpesa_transaction_id VARCHAR(100),
  mpesa_phone VARCHAR(20),
  payment_status VARCHAR(20) DEFAULT 'pending' CHECK (payment_status IN ('pending', 'completed', 'failed', 'refunded')),
  payout_status VARCHAR(20) DEFAULT 'pending' CHECK (payout_status IN ('pending', 'scheduled', 'paid')),
  payout_at TIMESTAMPTZ,
  access_code_id INT REFERENCES access_codes(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Engagement tracking (for dept pass revenue distribution)
CREATE TABLE IF NOT EXISTS engagement_events (
  id BIGSERIAL PRIMARY KEY,
  access_code_id INT REFERENCES access_codes(id),
  document_id INT REFERENCES documents(id),
  seller_id INT REFERENCES users(id),
  event_type VARCHAR(30) NOT NULL CHECK (event_type IN ('open', 'read_5min', 'reach_80pct', 'bookmark', 'rating', 'repeat_visit')),
  points INT NOT NULL,
  session_id VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Engagement points config
CREATE TABLE IF NOT EXISTS engagement_weights (
  event_type VARCHAR(30) PRIMARY KEY,
  points INT NOT NULL,
  description VARCHAR(200)
);

-- Ratings
CREATE TABLE IF NOT EXISTS ratings (
  id SERIAL PRIMARY KEY,
  buyer_id INT REFERENCES users(id),
  document_id INT REFERENCES documents(id),
  seller_id INT REFERENCES users(id),
  stars INT CHECK (stars BETWEEN 1 AND 5),
  comment TEXT,
  is_verified_purchase BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(buyer_id, document_id)
);

-- Seller payouts
CREATE TABLE IF NOT EXISTS payouts (
  id SERIAL PRIMARY KEY,
  seller_id INT REFERENCES users(id),
  amount DECIMAL(10,2) NOT NULL,
  payout_type VARCHAR(20) DEFAULT 'mpesa' CHECK (payout_type IN ('mpesa')),
  mpesa_phone VARCHAR(20),
  mpesa_transaction_id VARCHAR(100),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  purchases_included INT[],
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- M-Pesa callbacks (raw log)
CREATE TABLE IF NOT EXISTS mpesa_callbacks (
  id SERIAL PRIMARY KEY,
  checkout_request_id VARCHAR(100),
  merchant_request_id VARCHAR(100),
  result_code INT,
  result_desc TEXT,
  amount DECIMAL(8,2),
  mpesa_receipt VARCHAR(50),
  phone VARCHAR(20),
  raw_payload JSONB,
  processed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pending STK push requests
CREATE TABLE IF NOT EXISTS payment_requests (
  id SERIAL PRIMARY KEY,
  buyer_id INT REFERENCES users(id),
  document_id INT REFERENCES documents(id),
  pass_id INT REFERENCES department_passes(id),
  purchase_type VARCHAR(20),
  amount DECIMAL(8,2),
  phone VARCHAR(20),
  checkout_request_id VARCHAR(100) UNIQUE,
  merchant_request_id VARCHAR(100),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'timeout')),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '10 minutes',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Plagiarism check log
CREATE TABLE IF NOT EXISTS plagiarism_checks (
  id SERIAL PRIMARY KEY,
  document_id INT REFERENCES documents(id),
  similarity_score DECIMAL(5,2),
  matched_document_id INT REFERENCES documents(id),
  checked_at TIMESTAMPTZ DEFAULT NOW()
);

-- Admin actions log
CREATE TABLE IF NOT EXISTS admin_logs (
  id SERIAL PRIMARY KEY,
  admin_id INT REFERENCES users(id),
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(50),
  target_id INT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  type VARCHAR(50) NOT NULL,
  title VARCHAR(200),
  message TEXT,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_documents_university ON documents(university_id);
CREATE INDEX IF NOT EXISTS idx_documents_department ON documents(department_id);
CREATE INDEX IF NOT EXISTS idx_documents_seller ON documents(seller_id);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_access_codes_code ON access_codes(code);
CREATE INDEX IF NOT EXISTS idx_access_codes_buyer ON access_codes(buyer_id);
CREATE INDEX IF NOT EXISTS idx_purchases_buyer ON purchases(buyer_id);
CREATE INDEX IF NOT EXISTS idx_engagement_code ON engagement_events(access_code_id);
CREATE INDEX IF NOT EXISTS idx_engagement_document ON engagement_events(document_id);
CREATE INDEX IF NOT EXISTS idx_payment_requests_checkout ON payment_requests(checkout_request_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);

`;

const seedData = `
-- Engagement weights
INSERT INTO engagement_weights (event_type, points, description) VALUES
  ('open', 1, 'Document opened'),
  ('read_5min', 3, 'Read for more than 5 minutes'),
  ('reach_80pct', 4, 'Reached 80% of document'),
  ('bookmark', 4, 'Bookmarked or saved'),
  ('rating', 2, 'Left a positive rating'),
  ('repeat_visit', 2, 'Returned to document')
ON CONFLICT DO NOTHING;

-- Universities
INSERT INTO universities (name, slug, short_name, domain) VALUES
  ('Kenyatta University', 'ku', 'KU', 'students.ku.ac.ke'),
  ('University of Nairobi', 'uon', 'UoN', 'students.uonbi.ac.ke'),
  ('Mount Kenya University', 'mku', 'MKU', 'students.mku.ac.ke'),
  ('Strathmore University', 'strathmore', 'SU', 'strathmore.edu'),
  ('JKUAT', 'jkuat', 'JKUAT', 'students.jkuat.ac.ke'),
  ('Daystar University', 'daystar', 'DU', 'daystar.ac.ke')
ON CONFLICT DO NOTHING;

-- Departments for KU (university_id = 1)
INSERT INTO departments (university_id, name, slug) VALUES
  (1, 'Computer Science', 'cs'),
  (1, 'Business Administration', 'biz'),
  (1, 'Engineering', 'eng'),
  (1, 'Medicine', 'med'),
  (1, 'Law', 'law'),
  (1, 'Economics', 'econ')
ON CONFLICT DO NOTHING;

-- Departments for UoN (university_id = 2)
INSERT INTO departments (university_id, name, slug) VALUES
  (2, 'Computer Science', 'cs'),
  (2, 'Business Administration', 'biz'),
  (2, 'Engineering', 'eng'),
  (2, 'Medicine', 'med'),
  (2, 'Law', 'law'),
  (2, 'Economics', 'econ')
ON CONFLICT DO NOTHING;

-- Department passes for KU
INSERT INTO department_passes (university_id, department_id, name, duration_hours, price) VALUES
  (1, 1, 'KU Computer Science — 24hr Pass', 24, 50),
  (1, 1, 'KU Computer Science — 7 Day Pass', 168, 199),
  (1, 2, 'KU Business Admin — 24hr Pass', 24, 50),
  (1, 2, 'KU Business Admin — 7 Day Pass', 168, 199),
  (1, 3, 'KU Engineering — 24hr Pass', 24, 50),
  (1, 3, 'KU Engineering — 7 Day Pass', 168, 199)
ON CONFLICT DO NOTHING;
`;

async function setup() {
  const client = await pool.connect();
  try {
    console.log('🔧 Setting up ScholarNest database...');
    await client.query(schema);
    console.log('✅ Schema created successfully');
    await client.query(seedData);
    console.log('✅ Seed data inserted');

    // Create admin user
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'admin123', 12);
    await client.query(`
      INSERT INTO users (email, password_hash, full_name, role, seller_status, is_verified)
      VALUES ($1, $2, 'ScholarNest Admin', 'admin', 'approved', true)
      ON CONFLICT (email) DO NOTHING
    `, [process.env.ADMIN_EMAIL || 'admin@scholarnest.co.ke', hash]);
    console.log('✅ Admin user created');
    console.log('\n🚀 Database setup complete!');
    console.log('Run: npm run dev');
  } catch (err) {
    console.error('❌ Setup failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

setup();
