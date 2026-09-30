export const config = {
  port: Number(process.env.PORT ?? 4000),
  mongoUri: process.env.MONGO_URI ?? "mongodb://localhost:27017",
  mongoDb: process.env.MONGO_DB ?? "student_tracker",
  jwtSecret: process.env.JWT_SECRET ?? "dev-only-change-me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
  uploadDir: process.env.UPLOAD_DIR ?? "./uploads",
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? "http://localhost:4000",
  /**
   * Where people open the portal (the frontend), e.g.
   * https://commission-v2.tetracapitals.com — used for links in emails
   * (follow-up reminders). Unset: CORS_ORIGIN when that is one address;
   * neither: emails go out without a button.
   */
  appBaseUrl: (process.env.APP_BASE_URL || (/^https?:\/\//.test(process.env.CORS_ORIGIN ?? "") ? process.env.CORS_ORIGIN! : "")).replace(/\/+$/, ""),
  smtp: {
    host: process.env.SMTP_HOST ?? "",
    port: Number(process.env.SMTP_PORT ?? 587),
    /** SSL from the start (port 465) vs STARTTLS (587). Unset: by the port. */
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : undefined,
    user: process.env.SMTP_USER ?? "",
    pass: process.env.SMTP_PASS ?? "",
    from: process.env.SMTP_FROM ?? "no-reply@example.com",
  },
  /**
   * The 3CX phone system — call history and recordings through its API
   * (XAPI), matched to students by phone number.
   *
   *   url       e.g. https://deltainstitutions.3cx.ae:5002
   *   clientId  / apiKey — 3CX Admin Console > Integrations > API: a client
   *             with "3CX Configuration API Access", role System Owner
   *
   * Any unset: no call sync (the Call button still dials).
   */
  threecx: {
    url: (process.env.THREECX_URL ?? "").replace(/\/+$/, ""),
    clientId: process.env.THREECX_CLIENT_ID ?? "",
    apiKey: process.env.THREECX_API_KEY ?? "",
  },
  /**
   * The Delta LMS's service API, for the Mentor Calendar — who is free, what is
   * booked, booking time with a mentor. The same door and the same values the
   * Sales CRM uses:
   *
   *   apiUrl        LMS_API_URL (a trailing /api/v1 is fine)
   *   serviceSecret LMS_SERVICE_SECRET — the Sales CRM's secret for the LMS
   *   remoteOrgId   LMS_REMOTE_ORG_ID — which academy's mentors
   *
   * Either of the first two unset: the calendar says it is not configured.
   */
  lms: {
    apiUrl: (process.env.LMS_API_URL ?? "").replace(/\/+$/, "").replace(/\/api\/v1$/, ""),
    serviceSecret: process.env.LMS_SERVICE_SECRET ?? "",
    remoteOrgId: process.env.LMS_REMOTE_ORG_ID ?? "",
  },
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  /**
   * The Root portal, which opens this app for people signed in there and
   * manages who has an account here.
   *
   *   rootErpApiUrl  where to check a sign-in token the portal hands over
   *                  (its API origin — the same value Media ERP is given)
   *   rootErpSecret  what the portal presents when it asks about roles and
   *                  people; must match the portal's COMMISSION_SSO_SECRET
   *
   * Either unset turns that half off. Never open, never a default host.
   */
  rootErpApiUrl: process.env.ROOT_ERP_API_URL ?? "",
  rootErpSecret: process.env.ROOT_ERP_SECRET ?? "",
  /**
   * Delta finance, which sends each new Delta LMS student here once the LMS
   * has them. What finance presents in `x-finance-secret`; must match its
   * COMMISSION_S2S_SECRET. Unset turns the route off — never open.
   */
  financeS2sSecret: process.env.FINANCE_S2S_SECRET ?? "",
  /**
   * Delta finance's approvals, where each new deposit request is sent for the
   * accountants to approve or reject — the same signed door the sales CRM and
   * Media ERP use, with the same client id and secret they are given. The
   * decision comes back on the route FINANCE_S2S_SECRET guards.
   *
   *   financeApiUrl             finance's API origin
   *   financeClientId           its INBOUND_CLIENT_ID
   *   financeIntegrationSecret  its INBOUND_INTEGRATION_SECRET
   *   financeOrgId              the organization the deposits land in (Delta HQ)
   *
   * All four set turns it on. Any of them unset and deposits are approved here,
   * as before.
   */
  financeApiUrl: process.env.FINANCE_API_URL ?? "",
  financeClientId: process.env.FINANCE_CLIENT_ID ?? "",
  financeIntegrationSecret: process.env.FINANCE_INTEGRATION_SECRET ?? "",
  financeOrgId: process.env.FINANCE_ORG_ID ?? "",
  /**
   * The Delta LMS, which sends every other new student here (the ones finance
   * did not enrol). What the LMS presents in `x-lms-secret`; must match its
   * COMMISSION_S2S_SECRET. Unset turns the route off — never open.
   */
  lmsS2sSecret: process.env.LMS_S2S_SECRET ?? "",
};
