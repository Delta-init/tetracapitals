/**
 * lib/mailer.ts through one kept-open SMTP connection (2026-11-18: Gmail's "454 4.7.0 Too many login attempts" after
 * a sign-in for every email) — against a stand-in SMTP server in this process: many emails, one sign-in; a refused
 * address is reported and the next email goes; a refused sign-in is reported as it is, and the next email signs in once, afresh.
 * Run: ./test-mailer-pool.sh (nothing reads a .env; no database).
 */
const stub = { logins: 0, messages: 0, lockout: false, refuse: new Set<string>(), sockets: new Set<any>() };
const server = Bun.listen<{ buf: string; data: boolean }>({
  hostname: "127.0.0.1", port: 0,
  socket: {
    open(s) { s.data = { buf: "", data: false }; stub.sockets.add(s); s.write("220 stub ESMTP\r\n"); },
    close(s) { stub.sockets.delete(s); },
    data(s, chunk) {
      s.data.buf += chunk.toString();
      let i: number;
      while ((i = s.data.buf.indexOf("\r\n")) >= 0) {
        const line = s.data.buf.slice(0, i);
        s.data.buf = s.data.buf.slice(i + 2);
        if (s.data.data) { if (line === ".") { s.data.data = false; stub.messages++; s.write(`250 2.0.0 OK id-${stub.messages}\r\n`); } continue; }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === "EHLO" || cmd === "HELO") s.write("250-stub\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n");
        else if (cmd === "AUTH") { stub.logins++; s.write(stub.lockout ? "454-4.7.0 Too many login attempts, please try again later.\r\n454 4.7.0 gsmtp\r\n" : "235 2.7.0 Accepted\r\n"); }
        else if (cmd === "MAIL") s.write("250 2.1.0 OK\r\n");
        else if (cmd === "RCPT") s.write(stub.refuse.has((line.match(/<([^>]+)>/)?.[1] ?? "").toLowerCase()) ? "550 5.1.1 No such user\r\n" : "250 2.1.5 OK\r\n");
        else if (cmd === "DATA") { s.data.data = true; s.write("354 Go ahead\r\n"); }
        else if (cmd === "RSET" || cmd === "NOOP") s.write("250 2.0.0 OK\r\n");
        else if (cmd === "QUIT") { s.write("221 2.0.0 Bye\r\n"); s.end(); }
        else s.write("502 5.5.1 Unrecognized command\r\n");
      }
    },
  },
});
Object.assign(process.env, { SMTP_HOST: "127.0.0.1", SMTP_PORT: String(server.port), SMTP_USER: "mailer@e2e.local", SMTP_PASS: "x", SMTP_SECURE: "false", SMTP_FROM: "CS Portal <mailer@e2e.local>", MONGO_URI: "mongodb://127.0.0.1:1", MONGO_DB: "none_e2e" });
const { sendMail } = await import("../lib/mailer");
let failures = 0, checks = 0;
const check = (label: string, ok: boolean, detail = "") => { checks++; if (ok) console.log(`  \x1b[32m✓\x1b[0m ${label}`); else { failures++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); } };
const send = (to: string) => sendMail({ to, subject: "Hello", html: "<p>Hi</p>", text: "Hi" });

for (let k = 1; k <= 5; k++) await send(`s${k}@e2e.local`);
check("five emails, one sign-in", stub.messages === 5 && stub.logins === 1, JSON.stringify(stub, (k, v) => (k === "sockets" || k === "refuse" ? undefined : v)));
stub.refuse.add("nobody@e2e.local");
const refused = await send("nobody@e2e.local");
await send("s6@e2e.local");
// nodemailer closes a connection after a refused address: the next email signs in once more — not once each.
check("a refused address: reported; the next email goes, with one sign-in at most", !refused.ok && /550/.test((refused as any).error) && stub.logins <= 2 && stub.messages === 6, JSON.stringify({ refused, logins: stub.logins, messages: stub.messages }));
stub.lockout = true;
for (const s of [...stub.sockets]) s.end();
await Bun.sleep(300);
const locked = await send("s7@e2e.local");
check("a refused sign-in (454): reported as the server said it", !locked.ok && /454.*Too many login attempts/.test((locked as any).error), JSON.stringify(locked));
stub.lockout = false;
const signs = stub.logins;
const after = await send("s8@e2e.local");
check("the next email: one fresh sign-in, sent", after.ok && stub.logins === signs + 1 && stub.messages === 7, JSON.stringify({ after, logins: stub.logins, signs }));
server.stop(true);
console.log(`\n${failures ? "\x1b[31m" : "\x1b[32m"}${checks - failures}/${checks} checks passed\x1b[0m`);
process.exit(failures ? 1 : 0);
