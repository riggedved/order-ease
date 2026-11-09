# Order Ease: Deployment & Operation Guide

Ordering application for Company A, a Jabalpur FMCG distributor serving ~1,800 kirana retailers.
Core slice: catalogue, cart, scheme engine, text AI capture, order desk management, and Tally export.

---

## 1. Run Locally (Step-by-Step)

### Prerequisites

| Tool | Required Version | Tested Version | Notes |
| :--- | :--- | :--- | :--- |
| **Python** | 3.10+ | 3.14.3 | Required for FastAPI backend |
| **Node.js** | 18.0+ | 24.18.1 | Required for Vite + React frontend |
| **npm** | 9.0+ | 11.16.0 | Node package manager |
| **Git** | Any modern version | 2.x | Version control |

---

### Step-by-Step Setup: Windows PowerShell

1. **Clone the repository**:
   ```powershell
   git clone https://github.com/riggedved/order-ease.git
   cd order-ease
   ```

2. **Create and activate the Python virtual environment**:
   ```powershell
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   ```
   *(If script execution is restricted, run: `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`)*

3. **Install backend dependencies**:
   ```powershell
   pip install -r backend/requirements.txt
   ```

4. **Start the backend API** (execute from repo root):
   ```powershell
   uvicorn backend.app.main:app --reload
   ```
   - API Server runs at: `http://127.0.0.1:8000`
   - Interactive OpenAPI documentation: `http://127.0.0.1:8000/docs`
   - ReDoc documentation: `http://127.0.0.1:8000/redoc`

5. **Install frontend dependencies & start web app** (in a separate terminal):
   ```powershell
   cd web
   npm install
   npm run dev
   ```
   - Web application runs at: `http://localhost:3000`
   - Vite automatically proxies `/auth`, `/me`, `/catalogue`, `/cart`, `/orders`, `/capture`, `/desk`, and `/retailers` to `http://127.0.0.1:8000`.

---

### Step-by-Step Setup: macOS / Linux

1. **Clone the repository**:
   ```bash
   git clone https://github.com/riggedved/order-ease.git
   cd order-ease
   ```

2. **Create and activate the Python virtual environment**:
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   ```

3. **Install backend dependencies**:
   ```bash
   pip install -r backend/requirements.txt
   ```

4. **Start the backend API** (execute from repo root):
   ```bash
   uvicorn backend.app.main:app --reload
   ```
   - API Server runs at: `http://127.0.0.1:8000`
   - Interactive OpenAPI documentation: `http://127.0.0.1:8000/docs`

5. **Install frontend dependencies & start web app** (in a separate terminal):
   ```bash
   cd web
   npm install
   npm run dev
   ```
   - Web application runs at: `http://localhost:3000`

---

### Running Tests

Execute from the repository root with the virtual environment activated:
```bash
pytest -v
```
All 102 tests run against an isolated SQLite test database and verify:
- Catalogue rules and stock visibility
- Cart pricing and scheme calculations (free goods, slab discount, stacking, stock caps, paisa rounding)
- Orders lifecycle (credit holds, limit deduction, cancellation)
- Role-based authorization (retailer, salesman, order_desk, owner)
- Vernacular order capture (rule-based, LLM fallback, Devanagari numerals, category guards, alias learning)
- Tally XML and CSV export formatting

---

### How to Reset the Database

The application uses an SQLite database (`orderease.db`) located at the repository root.

**Windows PowerShell**:
```powershell
Remove-Item .\orderease.db -ErrorAction SilentlyContinue
```

**macOS / Linux**:
```bash
rm -f orderease.db
```

Upon the next API startup (or first request), `init_db()` automatically:
- Creates all database tables (`skus`, `users`, `retailers`, `orders`, `order_lines`, `aliases`, `capture_logs`).
- Seeds the initial catalogue (6 SKUs including decoys and schemes).
- Seeds staff users, retailers, initial orders, and vernacular aliases.

---

## 2. Deployment Architecture (Render & Vercel)

The application is architected to deploy seamlessly across **Render** (FastAPI backend) and **Vercel** (React/Vite frontend).

### Live URLs (Placeholders)
- **Frontend (Vercel)**: `https://YOUR-APP.vercel.app`
- **Backend API (Render)**: `https://YOUR-SERVICE.onrender.com`
- **Backend Health Check**: `https://YOUR-SERVICE.onrender.com/health`

---

### Backend Deployment (Render)

Deploy as a **Web Service** on Render:

1. **Connect Repository**: Point Render to the GitHub repository `https://github.com/riggedved/order-ease.git`.
2. **Service Configuration**:
   - **Environment**: `Python`
   - **Python Version**: `3.12` (pinned via `.python-version` and `backend/runtime-notes`)
   - **Root Directory**: `.` (leave default)
   - **Build Command**:
     ```bash
     pip install -r backend/requirements.txt
     ```
   - **Start Command**:
     ```bash
     uvicorn backend.app.main:app --host 0.0.0.0 --port $PORT
     ```
   - **Health Check Path**: `/health` (returns `{"status": "ok"}`)
3. **Environment Variables on Render**:
   - `ENV`: `production`
   - `JWT_SECRET`: Strong 32+ character random secret string (mandatory when `ENV=production`; the app will refuse to start if missing).
   - `ALLOWED_ORIGINS`: `https://YOUR-APP.vercel.app` (optional fallback for direct browser CORS).
   - `CAPTURE_PARSER`: `rule` (default, requires no key) or `auto` / `llm`.
   - `LLM_API_KEY`: Groq / OpenAI API key (optional; only needed for `auto` or `llm` mode).
   - `PYTHON_VERSION`: `3.12.8`

> [!WARNING]
> **Free Tier Sleep & Ephemeral Storage Warning**:
> - **Spin-down / Cold Start**: On Render's free tier, the backend web service spins down after 15 minutes of inactivity. Waking it up on the first request can take up to 50–60 seconds.
> - **Database Resets on Restart**: Because SQLite (`orderease.db`) resides on ephemeral disk storage on the free tier, the database file resets and is automatically re-seeded on instance restart. For persistent storage in production, connect a managed PostgreSQL instance by configuring `DATABASE_URL`.

---

### Frontend Deployment (Vercel)

Deploy as a static SPA on Vercel:

1. **Connect Repository**: Import the `order-ease` repo into Vercel.
2. **Project Settings**:
   - **Framework Preset**: `Vite`
   - **Root Directory**: `web`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
   - **Install Command**: `npm install`
3. **API Routing & Proxying (`web/vercel.json`)**:
   `web/vercel.json` contains reverse-proxy rewrites so the frontend calls `/api/*` on the same origin, avoiding CORS issues entirely:
   ```json
   {
     "rewrites": [
       {
         "source": "/api/:path*",
         "destination": "https://YOUR-SERVICE.onrender.com/:path*"
       },
       {
         "source": "/(.*)",
         "destination": "/index.html"
       }
     ]
   }
   ```
   *(Replace `https://YOUR-SERVICE.onrender.com` with your actual Render service URL).*

---

## 3. Environment Variables

Configure environment variables in `.env` (local) or through your hosting provider's dashboard:

| NAME | Purpose | Required / Optional | Example Placeholder |
| :--- | :--- | :--- | :--- |
| `ENV` | Environment identifier (`production` or `development`). When set to `production`, `JWT_SECRET` is strictly enforced. | Optional (Default: `development`) | `production` |
| `JWT_SECRET` | Secret key used for signing and verifying HS256 JWT access tokens. Must be provided in production; defaults to development key when `ENV != production`. | **Required in production** | `sec_prod_9f82ab73c4d5e6f1a2b3c4d5e6f7a8b9` |
| `ALLOWED_ORIGINS` | Comma-separated list of allowed CORS origins for direct browser API calls. | Optional (Default: empty / same-origin) | `https://YOUR-APP.vercel.app` |
| `CAPTURE_PARSER` | Parser selection for vernacular order capture: `rule` (rule-based, zero API keys), `llm` (LLM-only), or `auto` (LLM with automatic fallback to rule). | Optional (Default: `rule`) | `rule` |
| `LLM_API_KEY` | API key for OpenAI-compatible LLM endpoint (e.g. Groq, OpenAI). Only needed when `CAPTURE_PARSER=llm` or `auto`. | Optional | `gsk_placeholder_api_key_here` |
| `DATABASE_URL` | SQLAlchemy connection string. Defaults to SQLite at repo root. | Optional (Default: `sqlite:///./orderease.db`) | `sqlite:///./orderease.db` |

---

## 4. Demo Logins for Reviewers

All demo accounts use the standard mock OTP: **`123456`**.

| Phone | Role | Name & Business | What to Review / Test |
| :--- | :--- | :--- | :--- |
| **`9826011111`** | `retailer` | Ramesh Gupta<br>*(Gupta Kirana Store)* | **Primary Retailer Flow**: Credit limit ₹1,00,000 with ₹25,000 outstanding (₹75,000 available). Review mobile catalogue, scheme badges ("1 free / 10 cases", "3% off on 5+ cases"), live cart quote, Hinglish text capture, and standard order placement. |
| **`9826022222`** | `retailer` | Suresh Sharma<br>*(Sharma Provision Store)* | **Credit Hold Demo (Near-Limit)**: Credit limit ₹80,000 with ₹76,500 outstanding (only ₹3,500 available credit). Profile indicates "Credit low". Placing an order exceeding ₹3,500 triggers `credit_hold` status instead of `pending`. |
| **`9826000001`** | `order_desk` | Desk Officer<br>*(Company A Order Desk)* | **Order Desk Console**: High-density single-screen management UI. Review Queue tabs (All, Pending, Credit Hold, Approved), live search & date filtering, Order Detail pane, line editing with real-time re-quoting, credit position 2x2 grid, standard approval, override approval for credit holds, desk vernacular capture for any retailer, and Tally export. |
| **`9826000002`** | `salesman` | Rahul Verma<br>*(Sales Representative)* | **Data-model only (No screens built)**: Assigned to specific retailers. Authorization enforced via API (`retailer.salesman_id == user.id`). Verified in test suite (`backend/tests/test_auth_and_roles.py`). |
| **`9826000003`** | `owner` | Rajesh Agarwal<br>*(Distributor Owner)* | **Data-model only (No screens built)**: Full supervisor privileges over order desk, approval actions, and credit limit overrides. Verified in test suite (`backend/tests/test_auth_and_roles.py`). |

---

## 5. Six-Step End-to-End Demo Script

### Step 1: Retailer logs in and views catalogue & schemes
1. Open `http://localhost:3000`.
2. Log in with phone `9826011111` and OTP `123456`.
3. View the catalogue:
   - Notice scheme tags: *"Buy 10 get 1 free"* on **Glucose biscuit 75 g**, *"3% off on 5+ cases"* on **Detergent powder 1 kg**.
   - Notice stock tags: **Tea leaf 250 g** shows *"Out of stock"*.

### Step 2: Retailer captures order via Hinglish message
1. Tap the **"Order by message"** tab or capture button.
2. In the text box, paste the sample vernacular order:
   ```text
   bhaiya 5 peti biscuit chhota, 2 peti washing powder 1 kilo, chai patti 250 wala 1 peti
   ```
3. Tap **"Read message"** (or press `Ctrl+Enter`).

### Step 3: Review parsed lines and add to cart
1. Inspect the parsed lines:
   - Line 1: `SKU-BS-075` (Glucose biscuit 75 g), 5 cases, High confidence.
   - Line 2: `SKU-DT-1KG` (Detergent powder 1 kg), 2 cases, High confidence.
   - Line 3: `SKU-TE-250` (Tea leaf 250 g), 1 case, Out of stock (strikethrough line, excluded from totals).
2. Note the preview payable: **₹7,948.00** before GST.
3. Tap **"Add to cart"**.

### Step 4: Review cart nudges and place order
1. Navigate to Cart.
2. Note the automated scheme nudges:
   - *"Add 5 more cases for 1 free case"* (on biscuit).
   - *"Add 3 more cases for 3% off"* (on detergent).
3. Tap **"Place Order"**.
4. Order is confirmed with status `pending`. Retailer outstanding balance updates immediately on profile.

### Step 5: Desk reviews, corrects a line (alias learned), and approves
1. Switch to Order Desk: Log out or open an incognito window at `http://localhost:3000`.
2. Log in with phone `9826000001` and OTP `123456`.
3. Select the new pending order in the **Orders** queue.
4. Review the Order Detail pane:
   - Check the **Credit Position** (2x2 grid showing Credit limit, Outstanding, This order, Projected).
   - Edit a line quantity (e.g., change biscuit from 5 to 10 cases). Notice how the scheme engine automatically awards 1 free case and updates the total in real time.
   - If correcting a SKU, the system automatically learns the vernacular mapping into `aliases` for Gupta Kirana Store.
5. Click **"Approve"**.
   - Order status changes to `approved`.
   - Warehouse stock is decremented.

### Step 6: Export approved orders to Tally
1. Click the **"Export"** tab in the desk header.
2. Filter by date range (today's date).
3. The approved order is listed.
4. Select format: **Tally XML** (or CSV).
5. Click **"Download"**.
6. Inspect the downloaded file:
   - XML structure contains standard Tally `<VOUCHER>` elements with proper entity escaping (`&amp;`).
   - Free goods entries are exported with `<AMOUNT>0.00</AMOUNT>`.
   - Exported orders are marked with `exported_at` timestamp.

---

## 6. Known Limits

1. **Mock Tally Export**: The Tally XML and CSV export outputs conform to standard distributor schemas, but have not been validated against a live physical Tally ERP instance.
2. **Photo & Voice Capture**: Photo/camera capture (OCR) and voice note capture (audio speech-to-text) are not implemented; order capture operates on pasted or typed text messages.
3. **Salesman Offline Mode**: Dedicated salesman field screens and offline SQLite sync are not built (salesman role is implemented at the data-model and API authorization level).
4. **Owner Dashboard**: Dedicated executive analytics screens are not built (owner role is implemented at the data-model and API authorization level).
5. **Mocked OTP**: Phone authentication uses a fixed development OTP (`123456`) without live SMS gateway delivery.

