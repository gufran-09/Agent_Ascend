# Agent Ascend

Agent Ascend is a BYO-LLM orchestration platform that routes a user prompt to the most suitable AI model, splits complex work into subtasks, executes each step with provider-specific fallbacks, and records cost and latency analytics along the way.

The product is split into two parts:

- A Next.js frontend in the repository root for login, prompt submission, chat-style task review, and execution history.
- An Express backend in `backend/` for API key validation, plan generation, execution, and analytics persistence in Supabase.

This README is written so a new team member, reviewer, or internal user can clone the repo, configure the required services, and run the system locally.

## What This Project Does

Agent Ascend helps users get better results from multiple AI providers instead of sending every prompt to a single model. The backend analyzes the prompt, selects a routing model, creates a plan, and then executes each subtask using the best available provider.

Core capabilities:

- Model routing across OpenAI, Anthropic, and Google Gemini.
- Automatic prompt decomposition into subtasks when the request is complex.
- Encrypted storage of user API keys.
- Execution fallback when a provider or model fails.
- Execution history and analytics for cost, time, and model usage.
- Supabase-backed session and key management.

## Tech Stack

- Frontend: Next.js 16, React 19, TypeScript, Tailwind CSS 4, Framer Motion, Lucide React.
- Backend: Node.js, Express 5, Zod, CORS, Helmet, express-rate-limit.
- AI providers: OpenAI, Anthropic, Google Generative AI.
- Storage and auth: Supabase.

## High-Level Architecture

1. The user signs in through Supabase auth from the frontend.
2. The user submits one or more provider API keys.
3. The backend validates the keys against the provider APIs, encrypts them, and stores them in Supabase.
4. The user submits a prompt.
5. The router model chooses a category, difficulty, and subtask breakdown.
6. The executor runs each subtask against the assigned model and falls back if needed.
7. The backend stores execution analytics and the frontend displays the result and history.

## Repository Layout

```text
agent-ascend/
├── app/                    # Next.js app router frontend
├── backend/                # Express API, Supabase access, execution logic
├── public/                 # Static assets
├── Product_Details/        # Design notes and implementation docs
├── next.config.ts          # Frontend environment passthrough
├── package.json            # Frontend scripts and dependencies
└── README.md               # Project documentation
```

Important backend areas:

- `backend/routes/keys.js` for API key submission and model discovery.
- `backend/routes/plan.js` for plan generation and plan versioning.
- `backend/routes/execute.js` for execution and analytics logging.
- `backend/core/router.js` for prompt routing and decomposition.
- `backend/core/executor.js` for provider calls and fallback logic.
- `backend/security/vault.js` for encryption and decryption.
- `backend/db/setup.sql` for the Supabase schema and model seed data.

## Prerequisites

- Node.js 20 or newer.
- npm 10 or newer.
- A Supabase project with SQL editor access.
- API keys for at least one of the supported providers if you want to test real execution.

## Local Setup

The frontend and backend are separate runtimes, so configure both.

### 1. Clone the repository

```bash
git clone <your-repo-url>
cd agent-ascend
```

### 2. Set up Supabase

Create a new Supabase project, then open the SQL editor and run the contents of `backend/db/setup.sql`.

That script creates and seeds these tables:

- `api_key_vault` for encrypted provider keys.
- `model_registry` for supported model metadata.
- `executions` for execution history and analytics.

The backend also expects a `plans` table for plan version storage. If you want full plan history support, create it with this SQL:

```sql
CREATE TABLE IF NOT EXISTS public.plans (
  id UUID PRIMARY KEY,
  plan_id UUID NOT NULL,
  plan_version INTEGER NOT NULL,
  session_id UUID NOT NULL,
  plan_json JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(plan_id, plan_version)
);
```

### 3. Configure backend environment variables

Create `backend/.env` with values like these:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-supabase-service-role-key
ENCRYPTION_KEY=your-32-byte-secret-key
PORT=8000
DAILY_CAP_USD=5.0
NODE_ENV=development
```

Notes:

- `ENCRYPTION_KEY` is required because the backend encrypts API keys before storage.
- `DAILY_CAP_USD` limits execution spend per session.
- `PORT` defaults to `8000` if omitted.

### 4. Configure frontend environment variables

Create a root-level `.env.local` file with these values:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
NEXT_PUBLIC_API_URL=http://localhost:8000
```

Notes:

- `NEXT_PUBLIC_API_URL` should point to the backend API.
- The frontend uses Supabase auth for sign-in and OAuth callbacks.

### 5. Install dependencies

From the repository root:

```bash
npm install
cd backend
npm install
cd ..
```

### 6. Start the backend

In a terminal inside `backend/`:

```bash
npm start
```

The backend listens on `http://localhost:8000` by default.

### 7. Start the frontend

In a second terminal at the repository root:

```bash
npm run dev
```

The frontend runs on `http://localhost:3000`.

## How To Use The App

1. Open the frontend in your browser.
2. Sign in with email/password or an OAuth provider enabled in Supabase.
3. Go to the chat or task workflow and submit one or more provider API keys.
4. Enter a prompt that you want the orchestration engine to solve.
5. Review the generated plan, subtasks, and estimated cost.
6. Execute the plan and inspect the result, fallback behavior, and analytics.
7. Check history to review previous runs.

## Supported API Endpoints

Backend base URL: `http://localhost:8000`

- `GET /health` - health check.
- `POST /api/keys` - validate and store a provider API key.
- `GET /api/keys/models?session_id=...` - list available models for the current session.
- `POST /api/plan` - generate a plan for a prompt.
- `POST /api/plan/:planId/edit` - edit an existing plan version.
- `POST /api/execute` - execute an approved plan.
- `GET /api/history?session_id=...` - fetch execution history.
- `GET /api/analytics?session_id=...` - fetch session analytics and cheapest model insights.

## Frontend Pages

- `/` - marketing landing page.
- `/login` - login and sign-up page with email/password and OAuth entry points.
- `/chat` - main workspace for prompt submission and orchestration review.
- `/settings` - user settings area.
- `/auth/callback` - Supabase auth callback handler.

## Security Model

Security is intentionally opinionated:

- API keys are encrypted before they are stored.
- Keys are decrypted only when a provider call is about to happen.
- Keys are never returned in API responses.
- Rate limiting protects the main API routes.
- Helmet and CORS are enabled on the backend.

If you rotate or revoke keys, do it in Supabase and re-submit the new value through the UI.

## Troubleshooting

- If the frontend cannot reach the backend, confirm `NEXT_PUBLIC_API_URL` points to the correct host and port.
- If plan generation fails immediately, make sure the `plans` table exists in Supabase.
- If key validation fails, verify that the provider API key is active and that the provider is enabled in your account.
- If auth redirects fail, check the Supabase redirect URLs and the frontend origin.
- If the backend exits on startup, verify `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, and `ENCRYPTION_KEY` are set.

## Useful Commands

Frontend from repository root:

```bash
npm run dev
npm run build
npm run start
npm run lint
```

Backend from `backend/`:

```bash
npm start
npm run dev
```

## Notes For Reviewers And Internal Teams

This project is designed to demonstrate a production-minded orchestration pattern rather than a single-model chat UI. The main value is in the routing, decomposition, execution, and observability flow, which allows the system to use the right model for the right subtask while keeping cost and failures visible.

If your team wants to adapt it, the usual extension points are:

- Add more providers in `backend/core/router.js` and `backend/core/executor.js`.
- Add new analytics fields in `backend/db/analytics.js`.
- Expand the UI in `app/chat/` and `app/components/`.
- Add more schema fields to `backend/db/setup.sql` and Supabase migrations.

## License

No explicit license file is included in this repository. Add one before distributing the project externally.