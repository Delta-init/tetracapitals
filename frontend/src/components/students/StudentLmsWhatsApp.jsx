import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Smartphone } from 'lucide-react';
import { WhatsAppEntry } from '@/components/messages/MessageLogUi';

/* ────────────────────────────────────────────────────────────────────────────
   The LMS's WhatsApp messages to this student (the user, 2026-10-29): class
   reminders, join and sign-in links — to their numbers here and on their LMS
   account, the last 30 days. A one-tap link in full for whoever may act as
   them (backend functions/messageLogs.ts getStudentLmsWhatsApp).
──────────────────────────────────────────────────────────────────────────── */

export default function StudentLmsWhatsApp({ studentId }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['student-lms-whatsapp', studentId], enabled: !!studentId, retry: false, staleTime: 30_000,
    queryFn: async () => (await base44.functions.invoke('getStudentLmsWhatsApp', { studentId })).data,
  });
  const rows = data?.rows ?? [];
  return (
    <Card className="mt-4 border-gray-200">
      <CardHeader className="border-b border-gray-100 py-3">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-lg font-semibold">
          <span className="flex items-center gap-2"><Smartphone className="h-5 w-5 text-emerald-600" />From the LMS</span>
          <span className="text-xs font-normal text-slate-500">Class reminders and links the LMS sent · last 30 days</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? <div className="flex items-center gap-2 p-6 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
          : error ? <p className="m-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{/unknown function|not found|404/i.test(String(error?.message)) ? 'Shows after the server update (the API deploy).' : error.message}</p>
          : data?.lms?.available === false ? <p className="m-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{data.lms.message}</p>
          : !rows.length ? <p className="p-6 text-sm text-gray-500">The LMS sent them no WhatsApp messages in the last 30 days.</p>
          : <div className="divide-y divide-slate-100">{rows.map(r => <WhatsAppEntry key={r.id} row={r} />)}</div>}
      </CardContent>
    </Card>
  );
}
