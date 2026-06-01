// Simulates the EXACT call patterns the React frontend uses against the live backend.
const API = "http://localhost:4000";
const ts = Date.now();

async function call(method, path, body, token) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:5173",  // simulate browser
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${JSON.stringify(data)}`);
  return data;
}

// 1. Register an admin (like base44.auth.register)
const me = await call("POST", "/api/auth/register", {
  email: `browser+${ts}@example.com`,
  password: "Password123!",
  full_name: "Browser Test",
});
console.log(`✓ /api/auth/register → ${me.user.email} (role=${me.user.app_role})`);
const T = me.token;

// 2. base44.auth.me()
const meCheck = await call("GET", "/api/auth/me", null, T);
console.log(`✓ /api/auth/me → ${meCheck.email}`);

// 3. The Layout component fires these 4 in parallel
const [ft, sr, tk, ra] = await Promise.all([
  call("GET", "/api/entities/FundingTransaction?limit=100", null, T),
  call("GET", "/api/entities/StudentRequest?limit=100", null, T),
  call("GET", "/api/entities/Ticket?limit=100", null, T),
  call("GET", "/api/entities/RetentionAssignment?limit=100", null, T),
]);
console.log(`✓ Layout-style parallel fetch: FT=${ft.length} SR=${sr.length} TK=${tk.length} RA=${ra.length}`);

// 4. Dashboard fetches
const [students, txs, users] = await Promise.all([
  call("GET", "/api/entities/Student?order=-created_date&limit=100", null, T),
  call("GET", "/api/entities/FundingTransaction?order=-requested_at&limit=9999", null, T),
  call("GET", "/api/entities/User?limit=100", null, T),
]);
console.log(`✓ Dashboard-style parallel fetch: students=${students.length} txs=${txs.length} users=${users.length}`);

// 5. Students.jsx-style create
const s = await call("POST", "/api/entities/Student", {
  student_code: `BR-${ts}`, full_name: "Browser Student", status: "active",
  primary_mentor_id: me.user.id, primary_mentor_name: me.user.full_name,
}, T);
console.log(`✓ Student create: ${s.id} (${s.full_name})`);

// 6. Tickets.jsx-style: create ticket then add a message, then filter messages by ticket_id
const ticket = await call("POST", "/api/entities/Ticket", {
  ticket_number: `TKT-${ts}`, title: "Test", description: "Test desc",
  category: "academic", priority: "medium", status: "open",
  created_by_id: me.user.id, created_by_name: me.user.full_name,
  assigned_to_role: "academic_head",
}, T);
console.log(`✓ Ticket created: ${ticket.ticket_number}`);
await call("POST", "/api/entities/TicketMessage", {
  ticket_id: ticket.id, sender_id: me.user.id, sender_name: me.user.full_name,
  sender_role: "super_admin", message: "First message", message_type: "user_message",
}, T);
const messages = await call("POST", "/api/entities/TicketMessage/filter",
  { query: { ticket_id: ticket.id }, order: "created_date" }, T);
console.log(`✓ TicketMessage.filter({ticket_id}) → ${messages.length} message(s)`);

// 7. NotificationBell.jsx-style: filter unread for current user
const unread = await call("POST", "/api/entities/Notification/filter",
  { query: { user_id: me.user.id, read: false }, order: "-created_date", limit: 20 }, T);
console.log(`✓ NotificationBell-style unread filter → ${unread.length} notification(s)`);

// 8. Role enforcement check: this account is a junior_mentor (because the first
//    registered user across the whole DB lifetime is the super_admin). Admin-only
//    functions should reject it with 403.
const rep = await fetch(`${API}/api/functions/getReportsData`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${T}` },
  body: JSON.stringify({ startDate: "2020-01-01", endDate: "2030-12-31" }),
});
console.log(`✓ Role enforcement: getReportsData as junior_mentor → ${rep.status} (expected 403)`);
if (rep.status !== 403) throw new Error(`expected 403, got ${rep.status}`);

// 9. Same call but as the original super_admin (registered first in this DB session)
//    — we don't know its password, but we can confirm RBAC via the 403 above.
//    Instead, register a fresh broker_admin via the standard register endpoint
//    (any role accepted after the first user), then call.
const admin = await call("POST", "/api/auth/register", {
  email: `admin+${ts}@example.com`, password: "Password123!",
  full_name: "Admin Test", app_role: "broker_admin",
});
const rep2 = await call("POST", "/api/functions/getReportsData",
  { startDate: "2020-01-01", endDate: "2030-12-31" }, admin.token);
console.log(`✓ getReportsData as broker_admin → rows=${rep2.rows.length} totals.net=$${rep2.totals.net}`);

console.log("\n✅ All frontend-equivalent call patterns pass.");
