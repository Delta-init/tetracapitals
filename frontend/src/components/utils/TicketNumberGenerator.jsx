export default function generateTicketNumber(tickets) {
  if (!tickets || tickets.length === 0) return 'TKT-00001';
  let max = 0;
  tickets.forEach(t => {
    if (t.ticket_number) {
      const num = parseInt(t.ticket_number.replace('TKT-', ''), 10);
      if (!isNaN(num) && num > max) max = num;
    }
  });
  const next = max + 1;
  return 'TKT-' + String(next).padStart(5, '0');
}