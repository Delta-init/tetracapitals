import React, { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { PageTitle } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Tags as TagsIcon, Trash2 } from 'lucide-react';
import { TagChip, useStudentTagCatalog } from '@/components/students/tags';

const PRESET_COLORS = ['#0ea5e9', '#059669', '#d97706', '#ea580c', '#ef4444', '#a855f7', '#ec4899', '#14b8a6', '#64748b'];
const ADMIN_ROLES = ['super_admin', 'admin', 'broker_admin', 'academic_head', 'finance_admin'];
const RESERVED = new Set(['old', 'closed', 'common']);
const KIND = {
  auto: { label: 'Automatic', hint: 'Follows the student — Old and Closed from their Enrolment, Common from being on two CS sheets' },
  closed: { label: 'Course closed', hint: 'Putting it on a student marks them enrolled' },
  custom: { label: 'Custom', hint: 'Put on and taken off by hand' },
};

/**
 * The student tag list. Old, Closed and Common, and a "Closed - <course>" for every product and LMS course, are kept
 * on it by the server (backend/src/students/tags.ts); admins add their own and choose colours.
 */
export default function StudentTags() {
  const queryClient = useQueryClient();
  const [currentUser, setCurrentUser] = useState(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const { data: tags = [], isLoading } = useStudentTagCatalog();

  useEffect(() => { base44.auth.me().then(setCurrentUser).catch(() => setCurrentUser(null)); }, []);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['student-tags'] });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.StudentTag.create(data),
    onSuccess: () => { refresh(); toast.success('Tag added'); setName(''); setColor(PRESET_COLORS[0]); },
    onError: (e) => toast.error(e?.message || 'Could not add the tag'),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.StudentTag.update(id, data),
    onSuccess: refresh,
    onError: (e) => toast.error(e?.message || 'Could not save'),
  });
  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.StudentTag.delete(id),
    onSuccess: () => { refresh(); toast.success('Tag deleted'); },
    onError: (e) => toast.error(e?.message || 'Could not delete'),
  });

  const handleAdd = (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { toast.error('Enter a tag name'); return; }
    if (RESERVED.has(trimmed.toLowerCase())) { toast.error(`"${trimmed}" is one of the automatic tags`); return; }
    if (/^closed\s*-/i.test(trimmed)) { toast.error('Course tags are made for every product and course — add the course on the Products page'); return; }
    if (tags.some(t => t.name.toLowerCase() === trimmed.toLowerCase())) { toast.error('That tag already exists'); return; }
    createMutation.mutate({ name: trimmed, color, kind: 'custom', active: true });
  };

  if (!currentUser) return <div className="p-8 text-center text-gray-500">Loading…</div>;
  if (!ADMIN_ROLES.includes(currentUser.app_role)) {
    return <div className="p-8 text-center text-gray-500">Only admins can manage student tags.</div>;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <PageTitle eyebrow="Students" icon={TagsIcon}>Student Tags</PageTitle>
        <p className="mt-2 max-w-3xl text-sm text-slate-500 sm:text-base">
          The tags a student can carry. <strong>Old</strong>, <strong>Closed</strong> and <strong>Common</strong> follow the student by
          themselves. There is a <strong>Closed - course</strong> tag for every product and LMS course — putting one on a student marks
          them enrolled. The student's CS, the people above them and admins tag students on the student's page.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-lg">Add a tag</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleAdd} className="flex flex-col gap-3 md:flex-row md:items-center">
            <Input placeholder="e.g. VIP, Call back, Needs MT5…" value={name} onChange={(e) => setName(e.target.value)} className="md:flex-1" />
            <div className="flex items-center gap-2">
              {PRESET_COLORS.map(c => (
                <button key={c} type="button" onClick={() => setColor(c)} aria-label={`Colour ${c}`}
                  className={`h-6 w-6 rounded-full border-2 ${color === c ? 'border-slate-900' : 'border-transparent'}`} style={{ backgroundColor: c }} />
              ))}
            </div>
            <Button type="submit" disabled={createMutation.isPending}><Plus className="mr-1 h-4 w-4" />Add tag</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">Tags ({tags.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-center text-gray-500">Loading…</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tag</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Colour</TableHead>
                  <TableHead>In use</TableHead>
                  <TableHead className="w-16"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tags.map(t => {
                  const kind = KIND[t.kind] || KIND.custom;
                  return (
                    <TableRow key={t.id}>
                      <TableCell><TagChip name={t.name} color={t.color || '#64748b'} /></TableCell>
                      <TableCell className="text-sm" title={kind.hint}>{kind.label}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {PRESET_COLORS.map(c => (
                            <button key={c} type="button" aria-label={`Colour ${c}`} style={{ backgroundColor: c }}
                              onClick={() => c !== t.color && updateMutation.mutate({ id: t.id, data: { color: c } })}
                              className={`h-4 w-4 rounded-full border-2 ${t.color === c ? 'border-slate-900' : 'border-transparent'}`} />
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        {t.kind === 'auto'
                          ? <span className="text-xs text-slate-400">Always</span>
                          : <Switch checked={t.active !== false} onCheckedChange={(v) => updateMutation.mutate({ id: t.id, data: { active: v } })} />}
                      </TableCell>
                      <TableCell>
                        {t.kind !== 'auto' && t.kind !== 'closed' && (
                          <Button size="icon" variant="ghost" aria-label={`Delete ${t.name}`}
                            onClick={() => confirm(`Delete tag "${t.name}"? Students who have it keep the label until it is taken off.`) && deleteMutation.mutate(t.id)}>
                            <Trash2 className="h-4 w-4 text-red-600" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
