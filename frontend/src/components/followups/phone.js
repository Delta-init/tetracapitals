// Turning a stored phone number into something 3CX can dial.
//
// Stored numbers come in many shapes: "'+971526638282" (a leftover spreadsheet
// apostrophe), "971554482549" (country code, no +), "0505955098" (UAE, no
// country code), "91 85939 07058", even an email address. 3CX dials exactly
// what it is given, so:
//   - several numbers in one field ("050… / 055…") → the first;
//   - apostrophes / quotes / spaces / dashes are dropped;
//   - "+…" is kept; "00…" becomes "+…";
//   - a UAE-shaped number with no country code gets +971:
//       mobile 05X XXX XXXX or 5X XXX XXXX, landline 0X XXX XXXX or X XXX XXXX;
//   - 11+ digits without "+" already carry a country code → "+" is added;
//   - anything else (e.g. a 10-digit Indian mobile with no country code) is
//     dialled as stored and flagged, rather than guessed.
// The stored data is never changed.

const invalid = (reason) => ({ ok: false, reason });

export function dialInfo(raw) {
  const first = String(raw ?? '').split(/[\n\r/,;|]+| - /).map(s => s.trim()).find(Boolean) ?? '';
  const p = first.replace(/^[\s'`"]+/, '').replace(/[\s'`"]+$/, '');
  if (!p) return invalid('No phone number');
  if (p.includes('*')) return invalid('Phone number hidden');
  if (/[a-z@]/i.test(p)) return invalid('Not a phone number');
  const digits = p.replace(/\D/g, '');

  if (p.startsWith('+')) return digits.length >= 8 ? { ok: true, dial: `+${digits}` } : invalid('Phone number too short');
  if (digits.startsWith('00')) return digits.length >= 10 ? { ok: true, dial: `+${digits.slice(2)}` } : invalid('Phone number too short');

  const local = digits.startsWith('0') ? digits.slice(1) : digits;
  if (/^5\d{8}$/.test(local) || /^[234679]\d{7}$/.test(local)) {
    return { ok: true, dial: `+971${local}`, note: 'No country code — dialled as UAE (+971)' };
  }
  if (!digits.startsWith('0') && digits.length >= 11) return { ok: true, dial: `+${digits}` };
  if (digits.length >= 7) return { ok: true, dial: digits, check: true, note: 'No country code — dialled as stored, please check the number' };
  return invalid('Phone number too short');
}
