# KhataVoice AI

**Speak. Record. Track. Grow.**

KhataVoice AI is a multilingual, voice-powered digital *udhaar khata*
for neighbourhood retailers and kirana shops. Shopkeepers can speak
naturally to record customer credit and payments, review extracted
details before saving, and maintain customer ledgers and product stock.

**Demo languages:** Hindi, Marathi, English and Hinglish.

## Why KhataVoice AI?

Many small retailers still manage customer credit in paper notebooks.
This can make it difficult to find past transactions, track outstanding
balances and keep stock information up to date. KhataVoice AI makes
everyday bookkeeping more accessible through a familiar interaction:
speaking.

## Features

-   Voice-based transaction entry.
-   Multilingual speech recognition for Hindi, Marathi, English and
    Hinglish.
-   Review and correction of recognised speech and transaction details
    before saving.
-   Customer management and individual customer ledgers.
-   Credit and payment transaction history.
-   Product catalogue with categories, units, prices and stock.
-   Inventory deduction for confirmed credit transactions linked to
    catalogue products and quantities.
-   Outstanding-balance and low-stock notifications.
-   Shop profile and preferences, including language, currency,
    low-stock threshold, payment reminders and notification sounds.
-   Sign-in using Supabase Auth.

## How it works

1.  The shopkeeper records a voice instruction.
2.  The backend sends the audio to the speech-recognition service.
3.  Recognised text is returned and transaction details are prepared.
4.  The shopkeeper reviews and corrects the customer, transaction type,
    product and amount.
5.  The shopkeeper confirms the transaction.
6.  The backend validates and records the transaction in Supabase.
7.  The customer ledger and relevant product stock are updated.

A voice transcript is a draft, not a saved transaction. The user must
review and confirm it.

## Transaction rules

-   **Credit:** Increases the customer's outstanding balance.
-   **Payment:** Decreases the customer's outstanding balance.
-   **Cash sale:** Does not increase the customer's outstanding credit
    balance.

Amounts should be calculated and validated by application logic using
catalogue prices and quantities, not an AI-generated total. A payment
should not exceed the customer's outstanding balance.

## Technology stack

  Layer                Technologies
  -------------------- ---------------------------------------
  Frontend             React, TypeScript, Vite, Tailwind CSS
  Backend              Python, FastAPI
  Speech recognition   Gnani AI Vachana STT
  Database             Supabase / PostgreSQL
  Authentication       Supabase Auth
  Frontend hosting     Vercel
  Backend hosting      Render

## Project structure

``` text
khatavoice-ai/
├── backend/
│   ├── main.py
│   ├── requirements.txt
│   └── ...
├── src/
│   ├── App.tsx
│   └── ...
├── public/
├── index.html
├── package.json
├── vite.config.ts
└── README.md
```

Supporting files may vary as the project evolves.

## Run locally

### Prerequisites

-   Node.js and npm
-   Python 3.12 (or a compatible Python version)
-   A Supabase project
-   A Gnani AI API key for speech recognition

### 1. Clone the repository

``` bash
git clone https://github.com/Aayeshashk/KhataVoice-AI.git
cd KhataVoice-AI
```

### 2. Configure the frontend

Create a `.env` file in the project root:

``` env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_publishable_or_anon_key
VITE_API_URL=http://localhost:8000
```

Install dependencies and start the frontend:

``` bash
npm install
npm run dev
```

Vite prints the local development URL in the terminal.

### 3. Configure the backend

Create a `.env` file inside `backend/`:

``` env
GNANI_API_KEY=your_gnani_api_key
GNANI_STT_URL=https://api.vachana.ai/stt/v3
SUPABASE_URL=your_supabase_project_url
SUPABASE_SECRET_KEY=your_supabase_server_secret
```

Install backend dependencies and start FastAPI:

``` bash
cd backend
python -m venv venv
```

Activate the environment:

**Windows Command Prompt**

``` bat
venv\Scripts\activate
```

**macOS / Linux**

``` bash
source venv/bin/activate
```

Then install and run:

``` bash
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

API documentation: `http://localhost:8000/docs`

Health endpoint: `http://localhost:8000/api/health`

## Deployment

The project uses:

-   **Frontend:** Vercel
-   **Backend:** Render

Set frontend environment variables in Vercel and server-side credentials
in Render. For production, set `VITE_API_URL` to the deployed backend
base URL.

Only the Supabase publishable/anon key belongs in frontend
configuration. Never expose the Supabase service-role or secret key in
frontend code or any `VITE_` environment variable.

## Security and data integrity

-   Keep API keys and server-side secrets out of source control.
-   Do not commit `.env` files.
-   Review recognised speech and transaction fields before saving.
-   Validate transaction amounts and balances on the server.
-   Keep transaction writes atomic and protect against accidental
    duplicate submissions.
-   Restrict customer and transaction data to the correct authenticated
    shop/user before using the application with real businesses.

## Current scope and demo notes

KhataVoice AI is a prototype/demo focused on the voice-to-ledger
workflow for small retailers. The demo includes customer records,
product catalogue data, transaction history, notifications and shop
preferences.

Before using it for real financial record-keeping, verify
authentication-based data isolation, access controls, database policies,
backups, auditability and transaction edge cases in the deployed
environment.

## Future improvements

-   Stronger per-shop data isolation and role-based access.
-   More robust handling of noisy audio, ambiguous names and incomplete
    instructions.
-   Additional Indian languages and dialect support.
-   Customer payment links and reminder delivery integrations.
-   Improved mobile table/card layouts and accessibility.
-   Automated end-to-end tests for voice and ledger workflows.

## Live project

-   **Frontend:**
    https://khata-voice-dk0842lah-aayeshash2412-1885.vercel.app/
-   **Backend API:** https://khatavoice-ai.onrender.com
-   **API documentation:** https://khatavoice-ai.onrender.com/docs
-   **GitHub:** https://github.com/Aayeshashk/KhataVoice-AI

## Acknowledgements

Built for the **Gnani AI Great Indian AI Internship Challenge**.

------------------------------------------------------------------------

**KhataVoice AI --- Speak. Record. Track. Grow.**
