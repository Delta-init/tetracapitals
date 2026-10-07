// A student's courses, products and balance, for the student tables.
//
// Courses — `lms_course`, set on students who arrived from Delta finance / the
//           LMS (stored as sent, so the same course can arrive as
//           "delta-wave-theory-trading-programme" or "DELTA WAVE THEORY …";
//           courseLabel() shows them the same way), the "Closed - <course>"
//           tags on them, and the courses in their Course fees.
// Products — the product tags (MMC, DSLP, …) on the student's APPROVED
//           DEPOSITS. Products aren't stored on the student itself.
// Balance — what is still to pay, from their Course fees (Delta finance and
//           the CS enrolment tracker).

/**
 * "delta-wave-theory-trading-programme" and "DELTA WAVE THEORY TRADING PROGRAMME"
 * → "Delta Wave Theory Trading Programme". Codes stay upper-case (DSLP, MMC);
 * real hyphens ("Break-Out", "DSLP - …") are kept.
 */
export function courseLabel(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  if (!/\s/.test(s)) s = s.replace(/[-_]+/g, ' '); // a slug: hyphens are word breaks
  const shouting = !/[a-z]/.test(s);
  const word = (w) => {
    if (!/[A-Za-z]/.test(w)) return w;
    const isCode = (/^[A-Z0-9&]{2,5}$/.test(w) && (!shouting || !/[AEIOU]/.test(w))) || /^[b-df-hj-np-tv-xz]{3,5}$/i.test(w);
    if (isCode) return w.toUpperCase();
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  };
  return s
    .replace(/\s+/g, ' ')
    .split(' ')
    .map(w => w.split('-').map(word).join('-'))
    .join(' ');
}

/** student id → sorted product names, from approved deposits only. */
export function productsByStudent(transactions = []) {
  const map = {};
  for (const t of transactions) {
    if (t.type !== 'DEPOSIT' || t.status !== 'APPROVED' || !t.student_id) continue;
    const tags = Array.isArray(t.tags) ? t.tags : t.tags ? [t.tags] : [];
    for (const tag of tags) {
      const name = String(tag || '').trim();
      if (!name) continue;
      (map[t.student_id] = map[t.student_id] || new Set()).add(name);
    }
  }
  return Object.fromEntries(Object.entries(map).map(([id, set]) => [id, [...set].sort()]));
}

const CLOSED_PREFIX = 'Closed - ';

/** Every course a student has — the LMS course, their "Closed - <course>" tags, their Course fees — each once. */
export function studentCourses(student) {
  const out = [], seen = new Set();
  const add = (raw) => {
    const c = courseLabel(raw);
    if (c && !seen.has(c.toLowerCase())) { seen.add(c.toLowerCase()); out.push(c); }
  };
  add(student?.lms_course);
  for (const t of Array.isArray(student?.tags) ? student.tags : []) {
    if (typeof t === 'string' && t.startsWith(CLOSED_PREFIX)) add(t.slice(CLOSED_PREFIX.length));
  }
  for (const f of Array.isArray(student?.course_fees) ? student.course_fees : []) add(f?.course);
  return out;
}

/**
 * What a student still has to pay, from their Course fees, by currency (minor units). `known` is false when no fee
 * entry gives a balance — nothing to go on, as opposed to paid in full.
 */
export function studentBalance(student) {
  const byCurrency = {};
  let known = false;
  for (const f of Array.isArray(student?.course_fees) ? student.course_fees : []) {
    if (f?.balance_minor === null || f?.balance_minor === undefined || f?.balance_minor === '') continue;
    known = true;
    const cur = f.currency || 'AED';
    byCurrency[cur] = (byCurrency[cur] || 0) + (Number(f.balance_minor) || 0);
  }
  return { known, byCurrency, owing: Object.values(byCurrency).some(v => v > 0) };
}

/** "AED 382.00" (several currencies joined); "" when nothing is known. */
export function balanceText(student) {
  const { known, byCurrency } = studentBalance(student);
  if (!known) return '';
  return Object.entries(byCurrency)
    .map(([cur, minor]) => `${cur} ${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
    .join(' · ');
}

/** Filter options for "Course / Product": every course and product present, plus "none". */
export function courseProductOptions(students = [], products = {}) {
  const courses = new Set(), prods = new Set();
  for (const s of students) {
    for (const c of studentCourses(s)) courses.add(c);
    for (const p of products[s.id] || []) prods.add(p);
  }
  return { courses: [...courses].sort(), products: [...prods].sort() };
}

/** Does a student match the "Course / Product" filter value? */
export function matchesCourseProduct(student, products, value) {
  if (!value || value === 'all') return true;
  const courses = studentCourses(student);
  const prods = products[student.id] || [];
  if (value === 'none') return courses.length === 0 && prods.length === 0;
  if (value.startsWith('course:')) return courses.includes(value.slice(7));
  if (value.startsWith('product:')) return prods.includes(value.slice(8));
  return true;
}

/** What they owe on courses recorded in Tetra (Bonus instalments, an upgrade in progress) — "AED 2,000.00 · DSLP". */
export function courseBalanceText(student) {
  return (Array.isArray(student?.course_balances) ? student.course_balances : [])
    .filter(b => b.balanceAed > 0)
    .map(b => `AED ${Number(b.balanceAed).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · ${b.course}`)
    .join(' — ');
}
