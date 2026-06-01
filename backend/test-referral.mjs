// Referral end-to-end test
const API = process.env.API || "http://localhost:4000";

async function call(method, path, body, token) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const ct = r.headers.get("content-type") || "";
  const data = ct.includes("json") ? await r.json() : await r.text();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${JSON.stringify(data)}`);
  return data;
}

const ts = Date.now();
const A = await call("POST", "/api/auth/register", {
  email: `ja+${ts}@x.com`, password: "Password123!", full_name: "Junior A", app_role: "junior_mentor",
});
const B = await call("POST", "/api/auth/register", {
  email: `jb+${ts}@x.com`, password: "Password123!", full_name: "Junior B", app_role: "junior_mentor",
});
console.log(`✓ created mentors A=${A.user.id} B=${B.user.id}`);

const student = await call("POST", "/api/entities/Student", {
  student_code: `REF-${ts}`, full_name: "Referral Test",
  primary_mentor_id: B.user.id, primary_mentor_name: "Junior B", status: "active",
}, B.token);
console.log(`✓ Junior B created student ${student.id}`);

const refRes = await call("POST", "/api/functions/createReferralRequest", {
  student_id: student.id, student_name: "Referral Test", student_code: `REF-${ts}`,
  receiving_mentor_id: B.user.id, receiving_mentor_name: "Junior B",
  requested_deposit_amount: 1000, payment_method: "crypto",
}, A.token);
console.log(`✓ Junior A created referral ${refRes.referral.id}`);

const approval = await call("POST", "/api/functions/processReferralResponse", {
  referral_id: refRes.referral.id, action: "approve",
}, B.token);
console.log(`✓ Junior B approved referral: ${approval.message}`);

const finalStudent = await call("GET", `/api/entities/Student/${student.id}`, null, B.token);
const co = finalStudent.co_mentors_details;
console.log(`✓ student.co_mentors_details: ${co ? co.slice(0, 80) + "…" : "(none)"}`);
if (!co || !co.includes(A.user.id)) throw new Error("co_mentors_details didn't capture Junior A");

const pendingTx = await call("POST", "/api/entities/FundingTransaction/filter", {
  query: { student_id: student.id, status: "PENDING" },
}, B.token);
console.log(`✓ Pending FundingTransactions created: ${pendingTx.length}`);
if (pendingTx.length < 1) throw new Error("approval should have created a pending FundingTransaction");

// Create an APPROVED tx directly so updateCoMentorContribution has data
const approvedTx = await call("POST", "/api/entities/FundingTransaction", {
  type: "DEPOSIT", status: "APPROVED",
  student_id: student.id, student_name: "Referral Test",
  primary_mentor_id: B.user.id, primary_mentor_name: "Junior B",
  initiating_mentor_id: A.user.id, initiating_mentor_name: "Junior A",
  amount_usd: 1000, payment_method: "crypto",
  requested_by_id: A.user.id, requested_at: new Date().toISOString(),
}, A.token);
console.log(`✓ APPROVED FundingTransaction seeded: $${approvedTx.amount_usd}`);

const ucc = await call("POST", "/api/functions/updateCoMentorContribution", {
  student_id: student.id, mentor_id: A.user.id,
}, A.token);
console.log(`✓ updateCoMentorContribution → net=$${ucc.netContribution}`);
if (ucc.netContribution !== 1000) throw new Error(`expected $1000 net, got $${ucc.netContribution}`);

// Reject path
const refRes2 = await call("POST", "/api/functions/createReferralRequest", {
  student_id: student.id + "x", student_name: "Other", student_code: "X",
  receiving_mentor_id: B.user.id, receiving_mentor_name: "Junior B",
  requested_deposit_amount: 500, payment_method: "crypto",
}, A.token);
const rej = await call("POST", "/api/functions/processReferralResponse", {
  referral_id: refRes2.referral.id, action: "reject", rejection_reason: "Not interested",
}, B.token);
console.log(`✓ Reject path: ${rej.message}`);

console.log("\n✅ Referral flow: all checks passed");
