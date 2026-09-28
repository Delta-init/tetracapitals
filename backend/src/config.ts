export const config = {
  port: Number(process.env.PORT ?? 4000),
  mongoUri: process.env.MONGO_URI ?? "mongodb://localhost:27017",
  mongoDb: process.env.MONGO_DB ?? "student_tracker",
  jwtSecret: process.env.JWT_SECRET ?? "dev-only-change-me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
  uploadDir: process.env.UPLOAD_DIR ?? "./uploads",
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? "http://localhost:4000",
  smtp: {
    host: process.env.SMTP_HOST ?? "",
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER ?? "",
    pass: process.env.SMTP_PASS ?? "",
    from: process.env.SMTP_FROM ?? "no-reply@example.com",
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
};
