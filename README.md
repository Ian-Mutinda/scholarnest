# ScholarNest

University notes marketplace with device-locked access codes, engagement-based revenue distribution, and M-Pesa payments.

---

## Stack

- **Backend**: Node.js + Express
- **Database**: PostgreSQL
- **Payments**: M-Pesa Daraja API (STK Push)
- **Document viewer**: Server-side PDF → image rendering (pdftoppm)
- **Auth**: JWT + httpOnly cookies

---

## Local Setup

### 1. Prerequisites

```bash
# Install Node.js (v18+)
# Install PostgreSQL
# Install poppler-utils (for PDF rendering)

# Ubuntu / Debian
sudo apt-get install poppler-utils

# macOS
brew install poppler

# Windows
# Download from: https://github.com/oschwartz10612/poppler-windows
# Add to PATH
```

### 2. Clone and install

```bash
cd scholarnest
npm install
```

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env with your values
```

Key values to fill in:
- `DB_PASSWORD` — your PostgreSQL password
- `JWT_SECRET` — any long random string
- `MPESA_CONSUMER_KEY` + `MPESA_CONSUMER_SECRET` — from Daraja sandbox
- `ADMIN_EMAIL` + `ADMIN_PASSWORD` — your admin login

### 4. Create the database

```bash
# In PostgreSQL
createdb scholarnest

# Or via psql
psql -U postgres -c "CREATE DATABASE scholarnest;"
```

### 5. Run database setup

```bash
npm run setup-db
```

This creates all tables, inserts seed data (universities, departments, passes), and creates the admin user.

### 6. Start the server

```bash
npm run dev   # Development (auto-restart on changes)
npm start     # Production
```

Visit: http://localhost:3000

---

## M-Pesa Daraja Setup (Sandbox)

1. Go to https://developer.safaricom.co.ke
2. Create an account and log in
3. Go to **My Apps** → **Create App**
4. Select **Lipa na M-Pesa Sandbox**
5. Copy your **Consumer Key** and **Consumer Secret** into `.env`
6. For the callback URL during local testing, use [ngrok](https://ngrok.com):

```bash
# Install ngrok, then:
ngrok http 3000

# Copy the https URL, e.g. https://abc123.ngrok.io
# Set in .env:
MPESA_CALLBACK_URL=https://abc123.ngrok.io/api/payments/mpesa/callback
```

### Sandbox test credentials
- **STK Push phone**: 254708374149 (Safaricom test number)
- **PIN**: any 4 digits
- **Shortcode**: 174379 (already in .env.example)

---

## API Reference

### Auth
| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/auth/register` | Register buyer or seller |
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/logout` | Logout |
| GET | `/api/auth/me` | Current user |

### Documents
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/api/documents` | Optional | Browse marketplace |
| GET | `/api/documents/:id` | Optional | Document detail |
| GET | `/api/documents/:id/preview` | None | First page preview (no watermark) |
| GET | `/api/documents/:id/page/:n?code=XXX` | Code | View page (watermarked) |
| POST | `/api/documents` | Seller | Upload document |
| POST | `/api/documents/:id/engage` | Buyer | Record engagement event |

### Payments
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/payments/initiate` | Buyer | Initiate STK Push |
| POST | `/api/payments/mpesa/callback` | None | Safaricom callback |
| GET | `/api/payments/status/:requestId` | Buyer | Poll payment status |
| GET | `/api/payments/my-codes` | Buyer | View purchased codes |
| POST | `/api/payments/validate-code` | None | Validate + bind code |

### Seller
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/api/seller/dashboard` | Seller | Earnings + stats |
| GET | `/api/seller/documents` | Seller | Own documents |
| GET | `/api/seller/payouts` | Seller | Payout history |
| PUT | `/api/seller/profile` | Seller | Update bio/phone |

### Admin
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/api/admin/stats` | Admin | Platform stats |
| GET | `/api/admin/sellers/pending` | Admin | Pending seller applications |
| POST | `/api/admin/sellers/:id/approve` | Admin | Approve seller |
| POST | `/api/admin/sellers/:id/reject` | Admin | Reject seller |
| GET | `/api/admin/documents/pending` | Admin | Documents awaiting review |
| POST | `/api/admin/documents/:id/approve` | Admin | Approve document |
| POST | `/api/admin/documents/:id/reject` | Admin | Reject document |
| GET | `/api/admin/payouts/pending` | Admin | Pending payouts |
| POST | `/api/admin/payouts/process/:id` | Admin | Process payout |

---

## Revenue Distribution

### Individual document purchase
- Student pays → M-Pesa confirms → code generated
- After **2 hours**: seller receives **70%**, platform keeps **30%**

### Department pass purchase
- Student buys pass for e.g. KU Computer Science (24hr or 7-day)
- System tracks engagement (opens, read time, scroll depth, bookmarks, ratings)
- Each event earns points (open=1, 5min read=3, 80% read=4, bookmark=4, rating=2)
- At midnight: uploader pool (70%) distributed proportionally by engagement share

### Access codes
- `single` — one document, 7-day expiry
- `pack_5` / `pack_10` — multi-document packs (coming soon)
- `dept_pass` — department access, duration set by pass tier

---

## Security

- Documents served as **images only** — original PDF never reaches browser
- Every page has **personalized watermark** (buyer email embedded)
- Access codes **device-fingerprinted on first use** — bound permanently
- Right-click, copy, print, download all **disabled client-side**
- Rate limiting on all endpoints
- JWT in httpOnly cookies (XSS-safe)
- Helmet.js security headers

---

## Deploying to DigitalOcean

```bash
# 1. Create a $6/month Droplet (Ubuntu 22.04)
# 2. SSH in and install:
sudo apt update
sudo apt install nodejs npm postgresql poppler-utils nginx certbot

# 3. Clone your repo, npm install, set up .env

# 4. Set up PostgreSQL:
sudo -u postgres createdb scholarnest
sudo -u postgres psql -c "CREATE USER scholarnest WITH PASSWORD 'yourpassword';"
sudo -u postgres psql -c "GRANT ALL ON DATABASE scholarnest TO scholarnest;"

# 5. Run setup: npm run setup-db

# 6. Use PM2 to keep app running:
npm install -g pm2
pm2 start src/app.js --name scholarnest
pm2 startup
pm2 save

# 7. Nginx reverse proxy:
# Point port 80/443 -> localhost:3000

# 8. SSL via certbot:
certbot --nginx -d yourdomain.co.ke
```

---

## Project Structure

```
scholarnest/
├── src/
│   ├── app.js                  # Express entry point
│   ├── routes/
│   │   ├── auth.js             # Register, login, logout
│   │   ├── documents.js        # Upload, browse, view pages
│   │   ├── payments.js         # M-Pesa STK Push + callbacks
│   │   ├── seller.js           # Seller dashboard
│   │   └── admin.js            # Admin panel
│   ├── middleware/
│   │   └── auth.js             # JWT middleware
│   ├── services/
│   │   ├── mpesa.js            # Daraja API integration
│   │   ├── documentProcessor.js # PDF → image conversion + watermarks
│   │   ├── plagiarism.js       # Duplicate/similarity detection
│   │   └── cron.js             # Scheduled jobs
│   └── utils/
│       └── accessCodes.js      # Code generation + device binding
├── config/
│   └── db.js                   # PostgreSQL pool
├── public/
│   ├── uploads/documents/      # Uploaded PDFs (not publicly served)
│   └── thumbnails/             # Generated page images
├── scripts/
│   └── setupDb.js              # DB schema + seed
├── .env.example
├── package.json
└── README.md
```
