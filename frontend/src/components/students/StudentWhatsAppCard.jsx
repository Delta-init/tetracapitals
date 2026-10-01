import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MessageCircle } from 'lucide-react';
import { createPageUrl } from '@/utils';
import { Composer, Thread, WA_GREEN } from '@/components/whatsapp/waUi';

/**
 * The student page's WhatsApp: their chats you may read — yours, and for a Chief Mentor, CS Manager or Super Admin
 * their CSs' — and, for a CS whose WhatsApp is linked, a box to message them on one of the numbers on their record.
 */
export default function StudentWhatsAppCard({ student }) {
  const queryClient = useQueryClient();
  const key = ['student-whatsapp', student?.id];
  const { data } = useQuery({
    queryKey: key,
    queryFn: async () => (await base44.functions.invoke('getStudentWhatsApp', { studentId: student.id })).data,
    enabled: !!student?.id,
    refetchInterval: 10_000,
  });
  const [number, setNumber] = useState('');
  useEffect(() => { if (!number && data?.numbers?.length) setNumber(data.numbers[0]); }, [data?.numbers, number]);
  if (!data) return null;
  const threads = data.threads || [];
  const mine = threads.filter(t => t.owner_id === data.me);
  const others = threads.filter(t => t.owner_id !== data.me);
  if (!threads.length && !data.can_link) return null;   // nothing to read, and not a CS who could write

  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const sendText = async (text) => {
    try { await base44.functions.invoke('sendWhatsApp', { chat: number, text }); refresh(); } catch (e) { toast.error(e?.message || 'Not sent'); throw e; }
  };
  const sendFile = async (file, caption) => {
    const form = new FormData();
    form.append('chat', number); form.append('caption', caption); form.append('file', file);
    try { await base44.functions.invokeForm('sendWhatsAppFile', form); refresh(); } catch (e) { toast.error(e?.message || 'Not sent'); throw e; }
  };
  const myMessages = mine.flatMap(t => t.messages).sort((a, b) => String(a.at).localeCompare(String(b.at)));

  return (
    <Card className="overflow-hidden border-gray-200">
      <CardHeader className="border-b border-gray-100 py-3">
        <CardTitle className="flex items-center justify-between gap-2 text-lg font-semibold">
          <span className="flex items-center gap-2"><MessageCircle className="h-5 w-5" style={{ color: WA_GREEN }} />WhatsApp</span>
          <Link to={createPageUrl('WhatsApp')} className="text-xs font-normal text-blue-600 hover:underline">All chats</Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {data.can_link && (
          <>
            <Thread messages={myMessages} className="max-h-96 min-h-32" empty={data.linked ? 'No messages with them yet' : 'Your WhatsApp is not linked'} />
            {data.can_send && data.numbers.length > 0 && (
              <>
                {data.numbers.length > 1 && (
                  <div className="flex items-center gap-2 border-t px-3 py-2 text-sm">
                    <span className="text-slate-500">To</span>
                    <Select value={number} onValueChange={setNumber}>
                      <SelectTrigger className="h-8 w-56"><SelectValue /></SelectTrigger>
                      <SelectContent>{data.numbers.map(n => <SelectItem key={n} value={n}>+{n}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                )}
                <Composer onSendText={sendText} onSendFile={sendFile} placeholder={`Message +${number}`} />
              </>
            )}
            {data.can_send && data.numbers.length === 0 && <p className="border-t p-3 text-center text-xs text-slate-500">No phone number on their record</p>}
            {!data.linked && (
              <p className="border-t p-3 text-center text-xs text-slate-500">
                <Link to={createPageUrl('WhatsApp')} className="text-blue-600 hover:underline">Link your WhatsApp</Link> to message them from here
              </p>
            )}
          </>
        )}
        {others.map(t => (
          <div key={`${t.owner_id}|${t.chat}`} className="border-t">
            <p className="bg-slate-50 px-3 py-1.5 text-xs text-slate-500">{t.owner_name}'s WhatsApp{t.phone ? ` · +${t.phone}` : ''} — read only</p>
            <Thread messages={t.messages} className="max-h-80" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
