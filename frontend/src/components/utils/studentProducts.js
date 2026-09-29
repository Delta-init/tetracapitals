// A student's course and products, for the student tables.
//
// Course  — `lms_course`, set on students who arrived from Delta finance / the
//           LMS. Stored as sent, so the same course can arrive as
//           "delta-wave-theory-trading-programme" or "DELTA WAVE THEORY …";
//           courseLabel() shows them the same way.
// Products — the product tags (MMC, DSLP, …) on the student's APPROVED
//           DEPOSITS. Products aren't stored on the student itself.

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

/** Filter options for "Course / Product": every course and product present, plus "none". */
export function courseProductOptions(students = [], products = {}) {
  const courses = new Set(), prods = new Set();
  for (const s of students) {
    const c = courseLabel(s.lms_course);
    if (c) courses.add(c);
    for (const p of products[s.id] || []) prods.add(p);
  }
  return { courses: [...courses].sort(), products: [...prods].sort() };
}

/** Does a student match the "Course / Product" filter value? */
export function matchesCourseProduct(student, products, value) {
  if (!value || value === 'all') return true;
  const course = courseLabel(student.lms_course);
  const prods = products[student.id] || [];
  if (value === 'none') return !course && prods.length === 0;
  if (value.startsWith('course:')) return course === value.slice(7);
  if (value.startsWith('product:')) return prods.includes(value.slice(8));
  return true;
}
