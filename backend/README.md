# Student Tracker — Backend (Bun + TypeScript + MongoDB)

Custom backend for the Student Tracker CRM frontend, replacing the original Base44
SDK service with a self-hosted Bun runtime + MongoDB store.

The frontend already speaks the Base44 SDK shape
(`base44.entities.<Entity>.list/filter/get/create/update/delete/bulkCreate`,
`base44.auth.me()`, `base44.integrations.Core.*`, `base44.functions.*`). The
`frontend/src/api/base44Client.js` drop-in shim translates those calls to the REST
endpoints documented below.

## Stack

- **Runtime**: [Bun](https://bun.sh) (uses native `Bun.serve`)
- **Language**: TypeScript (strict)
- **Database**: MongoDB (official `mongodb` driver, v6)
- **Auth**: JWT (HS256, [`jose`](https://github.com/panva/jose)) + bcrypt password hashes
- **Validation**: [`zod`](https://zod.dev)

## Quick start

```bash
# 1. Install Bun  (https://bun.sh)
# 2. Install MongoDB locally OR use an Atlas connection string

cd backend
cp .env.example .env          # edit MONGO_URI / JWT_SECRET
bun install
bun run seed                  # creates default admin@example.com / ChangeMe123!
bun run dev                   # http://localhost:4000
```

Then in `frontend/`:

```bash
cp .env.example .env.development        # VITE_API_URL=http://localhost:4000
npm install
npm run dev                              # http://localhost:5173
```

Login at `/Login` (or call `base44.auth.login({ email, password })`).

## Project layout

```
backend/
├── src/
│   ├── index.ts               # Bun.serve entry, lifecycle, error wrap
│   ├── router.ts              # All HTTP route dispatch
│   ├── config.ts              # Env-derived config
│   ├── db.ts                  # MongoDB connection + index bootstrap
│   ├── auth/
│   │   ├── jwt.ts             # Sign / verify JWTs
│   │   ├── middleware.ts      # getAuthUser / requireAuth
│   │   └── routes.ts          # /api/auth/register|login|me|change-password
│   ├── entities/
│   │   ├── registry.ts        # All entities + role-based access policy
│   │   └── crud.ts            # Generic list/filter/get/create/update/delete/bulk
│   ├── functions/
│   │   ├── index.ts           # Function dispatch
│   │   ├── getAllUsers.ts
│   │   ├── updateUser.ts
│   │   ├── getReportsData.ts
│   │   ├── getMentorCommissions.ts
│   │   ├── generateQuarterlyLedgers.ts
│   │   ├── tickets.ts         # autoClose, checkEscalation, sendTicketNotification
│   │   └── referrals.ts       # createReferralRequest, processReferralResponse,
│   │                          # processWithdrawal, updateCoMentorContribution
│   ├── integrations/
│   │   └── core.ts            # UploadFile, SendEmail (stub), InvokeLLM (Anthropic), ...
│   ├── lib/
│   │   ├── id.ts              # ObjectId helpers + serialize()
│   │   ├── query.ts           # Order/filter/limit translation
│   │   └── response.ts        # JSON helpers + CORS
│   └── scripts/
│       └── seed.ts            # Idempotent demo data seeder
├── uploads/                   # Local file storage for UploadFile
└── .env.example
```

## API reference

All endpoints are namespaced under `/api`. Bearer JWT in the `Authorization`
header is required for everything except `/api/auth/login`, `/api/auth/register`,
and `/health`.

### Auth

| Method | Path                          | Body / Notes |
|--------|-------------------------------|--------------|
| POST   | `/api/auth/register`          | `{ email, password, full_name, app_role?, commission_rate?, upline_commission_percentage? }`. First registered user is auto-promoted to `super_admin`. |
| POST   | `/api/auth/login`             | `{ email, password }` → `{ token, user }` |
| GET    | `/api/auth/me`                | Returns the authenticated user |
| POST   | `/api/auth/change-password`   | `{ current_password, new_password }` |

### Entity CRUD (generic)

Replaces `base44.entities.<Entity>.<method>`. `:entity` is the Base44-style entity
name from `src/entities/registry.ts` (`User`, `Student`, `FundingTransaction`,
`Ticket`, `TicketMessage`, `Notification`, `MentorReferral`, `CommissionLedger`,
`ManualCommissionAdjustment`, `MT5Account`, `MentorTarget`, `MentorPoints`,
`GamificationSettings`, `StudentRequest`, `StudentLog`, `StudentLogHistory`,
`RetentionAssignment`, `AcademicCounselor`, `Log`, `TrainingProgress`,
`PayoutTransaction`, `MentorDeduction`, `Transaction`, `Commission`, `Target`).

| Method | Path                                 | Notes |
|--------|--------------------------------------|-------|
| GET    | `/api/entities/:entity`              | Query: `?order=-created_date&limit=100&skip=0` |
| POST   | `/api/entities/:entity/filter`       | Body: `{ query, order, limit, skip }` |
| GET    | `/api/entities/:entity/:id`          | |
| POST   | `/api/entities/:entity`              | Create one |
| POST   | `/api/entities/:entity/bulk`         | Body: `[ {...}, {...} ]` |
| PATCH  | `/api/entities/:entity/:id`          | Partial update |
| DELETE | `/api/entities/:entity/:id`          | |

Server stamps `created_date` / `updated_date` automatically and prevents callers
from forging `_id`. Role-based access is enforced by `entities/registry.ts`.

### Custom functions

`POST /api/functions/:name` — body forwarded to the handler.

| Function                       | Roles allowed                                                                | Purpose |
|--------------------------------|------------------------------------------------------------------------------|---------|
| `getAllUsers`                  | super/broker/academic/finance/admin                                         | List all users (no password hashes) |
| `updateUser`                   | super/broker/academic/admin                                                 | `{ userId, userData }` — admin user edits |
| `getReportsData`               | super/broker/academic                                                       | `{ startDate, endDate }` → per-student deposit aggregate |
| `getMentorCommissions`         | admin roles + mentors (mentors see own only)                                | `{ startDate, endDate }` → mentor-level commission rollup with $25k/student cap |
| `generateQuarterlyLedgers`     | admin roles                                                                  | Closes the previous quarter and creates `CommissionLedger` rows |
| `autoCloseResolvedTickets`     | admin roles                                                                  | Closes any `resolved` ticket older than 24h, posts a system message + notification |
| `checkTicketEscalation`        | admin roles                                                                  | Escalates open tickets without a first response after 24h and notifies super admins |
| `sendTicketNotification`       | any authenticated                                                            | `{ title, message, type, assignedToRole, assignedToId?, referenceId? }` |
| `createReferralRequest`        | any authenticated                                                            | Mentor → mentor referral, creates `MentorReferral` + `Log` entry |
| `processReferralResponse`      | receiving mentor only                                                        | `{ referral_id, action: "approve"|"reject", rejection_reason? }`. Approval also creates a `PENDING` FundingTransaction. |
| `processWithdrawal`            | super/broker/academic                                                       | Stub kept for parity with frontend |
| `updateCoMentorContribution`   | any authenticated                                                            | `{ student_id, mentor_id }` — recalculates a co-mentor's `net_deposit_contribution_usd` |

### Integrations

| Method | Path                                              | Notes |
|--------|---------------------------------------------------|-------|
| POST   | `/api/integrations/UploadFile`                    | `multipart/form-data` with field `file`. Returns `{ file_url }` (served from `/uploads/...`). |
| POST   | `/api/integrations/SendEmail`                     | `{ to, subject, body, from? }`. STUB if SMTP env vars are empty. |
| POST   | `/api/integrations/SendSMS`                       | Stubbed; logs the request. |
| POST   | `/api/integrations/InvokeLLM`                     | `{ prompt, model?, max_tokens? }`. Calls Anthropic Messages API when `ANTHROPIC_API_KEY` is set, else returns a stub string. |
| POST   | `/api/integrations/GenerateImage`                 | Stub. |
| POST   | `/api/integrations/ExtractDataFromUploadedFile`   | Stub. |

### Static uploads

`GET /uploads/:filename` — serves files written by `UploadFile`. Path traversal
is blocked.

## Data model overview

All entities are stored as MongoDB documents. The server adds:

- `_id` (ObjectId) — exposed as `id: string` in JSON responses.
- `created_date`, `updated_date` — ISO timestamps.
- `created_by`, `created_by_name` — set on create when not provided.

Indexes are created at boot (`db.ts → ensureIndexes`). Highlights:

- `users.email` unique
- `funding_transactions(student_id, status)` for the per-student rollups
- `tickets(status, escalated, created_date)` for the escalation job
- `commission_ledgers(mentor_id, quarter)` unique
- `mt5_accounts.mt5_login` unique sparse
- `notifications(user_id, read, created_date)`

### Roles

`super_admin`, `admin`, `broker_admin`, `academic_head`, `academic_admin`,
`admin_supervisor`, `finance_admin`, `senior_mentor`, `junior_mentor`. Admin
roles are listed in `src/entities/registry.ts → ADMIN_ROLES`.

## Commission math (high level)

1. **Per-mentor net deposit**: sum of deposits − withdrawals for transactions where
   `initiating_mentor_id || primary_mentor_id === mentor.id`.
2. **$25k cap per student** is applied to the net before commission.
3. **Gross commission** = capped net × `users.commission_rate%` (default 4%).
4. **Manual adjustments** (positive or negative) are added to gross.
5. **Release** = 75% of adjusted gross, **Buffer** = 25% (carried to next quarter).
6. Quarterly ledgers are generated by `POST /api/functions/generateQuarterlyLedgers`.

## Recommended cron / schedules

You can hit these as a logged-in admin from any scheduler (cron, GitHub Actions,
Bun's own `setInterval`, etc.):

```text
0  * * * *   POST /api/functions/checkTicketEscalation
*/30 * * * * POST /api/functions/autoCloseResolvedTickets
0 6 1 1,4,7,10 *  POST /api/functions/generateQuarterlyLedgers  # 1st of each quarter
```

## Production checklist

- Generate a real `JWT_SECRET` (≥ 32 random bytes) and set `CORS_ORIGIN` to your
  frontend origin.
- Use MongoDB Atlas or a managed cluster; the included `MONGO_URI` default points
  at a local server.
- Replace the file-system `UploadFile` with S3 / R2 for multi-instance deploys.
- Wire `SendEmail` to a real provider (Resend, SendGrid, SES) inside
  `src/integrations/core.ts`.
- Add request logging / metrics (e.g. wrap `route` in `index.ts`).
- Run the `*Ticket*` cron functions on a schedule.
