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
  /**
   * The HRMS's signed directory, for the mentors' working hours and leave on the Mentor Calendar — the same client
   * the Root portal uses (its HRMS_* values):
   *
   *   apiUrl             HRMS_API_URL (a trailing /api/v1 is fine)
   *   clientId           HRMS_CLIENT_ID — the HRMS's INTEGRATION_CLIENT_ID
   *   integrationSecret  HRMS_INTEGRATION_SECRET — its INTEGRATION_SECRET
   *   orgId              HRMS_ORG_ID — optional: mentors are found by email in any organization without it
   *
   * Any of the first three unset: the calendar shows no working hours.
   */
  hrms: {
    apiUrl: (process.env.HRMS_API_URL ?? "").replace(/\/+$/, "").replace(/\/api\/v1$/, ""),
    clientId: process.env.HRMS_CLIENT_ID ?? "",
    integrationSecret: process.env.HRMS_INTEGRATION_SECRET ?? "",
    orgId: process.env.HRMS_ORG_ID ?? "",
  },
  /**
   * WhatsApp, as in the Carlton CRM: each CS links their own WhatsApp by
   * scanning a QR (Baileys — the WhatsApp Web protocol; no Meta account).
   *
   *   enabled     WHATSAPP=off keeps a server out of it: no saved session is
   *               restored and nobody can link (a test or local copy)
   *   sessionDir  WHATSAPP_SESSION_DIR — the linked devices' keys, one folder
   *               per CS. Must survive deploys, or everyone scans again.
   *   mediaDir    WHATSAPP_MEDIA_DIR — photos and files sent and received
   *
   * One API process only: a WhatsApp link lives in the process that made it.
   */
  whatsapp: {
    enabled: !/^(off|false|0|no)$/i.test(process.env.WHATSAPP ?? ""),
    sessionDir: process.env.WHATSAPP_SESSION_DIR ?? "./whatsapp-sessions",
    mediaDir: process.env.WHATSAPP_MEDIA_DIR ?? "./whatsapp-media",
  },
  /**
   * Phone and desktop notifications (Web Push), as in the Sales CRM. One key
   * pair for the server, made once with `npx web-push generate-vapid-keys`:
   *
   *   publicKey   VAPID_PUBLIC_KEY   (browsers get it from getPushConfig)
   *   privateKey  VAPID_PRIVATE_KEY  (stays on the server)
   *   subject     VAPID_SUBJECT      e.g. mailto:admin@deltainstitutions.com
   *
   * Changing the keys stops every saved device until it turns notifications
   * on again. Either key unset: no push; the bell still works.
   */
  push: {
    publicKey: process.env.VAPID_PUBLIC_KEY ?? "",
    privateKey: process.env.VAPID_PRIVATE_KEY ?? "",
    subject: process.env.VAPID_SUBJECT ?? "mailto:no-reply@example.com",
  },
  /**
   * Tabby payment links — Tabby's Custom Payment Links: a session for an
   * amount, and Tabby texts the student the link
   * (https://docs.tabby.ai/offline-payment-methods/custom-payment-links).
   * The same Tabby account as the LMS: copy these from the LMS server.
   *
   *   secretKey     TABBY_SECRET_KEY
   *   merchantCode  TABBY_MERCHANT_CODE
   *   currency      TABBY_CURRENCY   AED (UAE) or SAR (KSA)
   *   apiUrl        TABBY_API_URL    https://api.tabby.ai (UAE) or https://api.tabby.sa (KSA)
   *
   * Either key unset: no Tabby links (the button says so).
   */
  tabby: {
    secretKey: process.env.TABBY_SECRET_KEY ?? "",
    merchantCode: process.env.TABBY_MERCHANT_CODE ?? "",
    currency: process.env.TABBY_CURRENCY || "AED",
    apiUrl: (process.env.TABBY_API_URL || "https://api.tabby.ai").replace(/\/+$/, ""),
  },
  /**
   * Abzer (BillXpro) payment links: a CS's BillXpro request gets its link from
   * Abzer at once (functions/paymentLinks.ts, lib/abzer.ts) — the API the LMS's
   * checkout uses (API v5.1). SmartInvoice requests wait for a Super Admin.
   *
   *   accessKey / secretKey  ABZER_ACCESS_KEY / ABZER_SECRET_KEY
   *   baseUrl                ABZER_BASE_URL       https://billxpro.com/as/api/v100
   *   templateCode           ABZER_TEMPLATE_CODE  the payment-link template (paymentlink-mail-template)
   *   currency               ABZER_CURRENCY       AED — what the account takes
   *   returnUrl              ABZER_RETURN_URL     where the student lands after paying
   *
   * Either key unset: BillXpro requests wait for a Super Admin to paste a link too.
   */
  abzer: {
    accessKey: process.env.ABZER_ACCESS_KEY ?? "",
    secretKey: process.env.ABZER_SECRET_KEY ?? "",
    baseUrl: (process.env.ABZER_BASE_URL || "https://billxpro.com/as/api/v100").replace(/\/+$/, ""),
    templateCode: process.env.ABZER_TEMPLATE_CODE || "paymentlink-mail-template",
    currency: process.env.ABZER_CURRENCY || "AED",
    returnUrl: process.env.ABZER_RETURN_URL || "https://www.deltainstitutions.com",
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
