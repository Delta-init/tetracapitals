# Student Tracker

A full-stack CRM for tracking trading-mentorship students, mentor commissions,
funding transactions, tickets, and quarterly ledgers.

## Layout

```
student-tracker/
├── frontend/   # The original React + Vite app (was Base44-hosted)
└── backend/    # New self-hosted Bun + TypeScript + MongoDB API
```

The frontend was cloned from https://github.com/shafeel080/student-tracker.git
and was originally built on top of the Base44 platform SDK. We replaced the
backend with a self-hosted service so the project no longer depends on Base44.

## What changed in the frontend

- Removed deps: `@base44/sdk`, `@base44/vite-plugin`.
- `src/api/base44Client.js` is a drop-in shim that mirrors the Base44 SDK shape
  (`base44.entities.<Entity>.list/filter/get/create/update/delete/bulkCreate`,
  `base44.auth.*`, `base44.integrations.Core.*`, `base44.functions.*`) but talks
  to our new REST API.
- `src/lib/AuthContext.jsx` is rewritten to use `base44.auth.me()` against the
  new backend. Exported shape is unchanged for backward compatibility.
- `src/pages/Login.jsx` was added (no Login screen existed before; auth was
  delegated to Base44's hosted login).
- `vite.config.js` no longer registers the Base44 plugin; the `@` import alias is
  defined explicitly.

## Running locally

### 1. Start MongoDB
Run a local server (`mongod`) on the default port or use a Mongo Atlas cluster
and grab its connection string.

### 2. Backend
```bash
cd backend
cp .env.example .env       # set MONGO_URI and JWT_SECRET
bun install
bun run seed               # creates admin@example.com / ChangeMe123!
bun run dev                # http://localhost:4000
```

See `backend/README.md` for full API documentation and architecture notes.

### 3. Frontend
```bash
cd frontend
cp .env.example .env.development
npm install
npm run dev                # http://localhost:5173
```

Then go to http://localhost:5173/Login and sign in with the seeded admin.

## API surface (summary)

| Concern | Endpoints |
|---|---|
| Auth | `POST /api/auth/{register,login}`, `GET /api/auth/me`, `POST /api/auth/change-password` |
| Entities | `GET/POST /api/entities/:entity`, `POST /api/entities/:entity/{filter,bulk}`, `GET/PATCH/DELETE /api/entities/:entity/:id` |
| Business functions | `POST /api/functions/:name` (12 supported functions — see `backend/README.md`) |
| Integrations | `POST /api/integrations/{UploadFile,SendEmail,SendSMS,InvokeLLM,GenerateImage,ExtractDataFromUploadedFile}` |
| Static uploads | `GET /uploads/:filename` |
| Health | `GET /health` |

## License

Inherits whatever license the original repo declares (none was provided).
