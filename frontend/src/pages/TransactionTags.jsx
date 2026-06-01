import React, { useState, useEffect } from 'react';
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Tag as TagIcon } from "lucide-react";
import { toast } from "sonner";

const PRESET_COLORS = ['#0ea5e9', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#ec4899', '#14b8a6', '#64748b'];

const ADMIN_ROLES = ['super_admin', 'admin', 'broker_admin', 'academic_head', 'finance_admin'];

export default function TransactionTags() {
  const [currentUser, setCurrentUser] = useState(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(setCurrentUser).catch(() => setCurrentUser(null));
  }, []);

  const { data: tags = [], isLoading } = useQuery({
    queryKey: ['transaction-tags-all'],
    queryFn: () => base44.entities.TransactionTag.list('name'),
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.TransactionTag.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transaction-tags-all'] });
      queryClient.invalidateQueries({ queryKey: ['transaction-tags'] });
      toast.success('Tag added');
      setName('');
      setColor(PRESET_COLORS[0]);
    },
    onError: (e) => toast.error(e?.message || 'Failed to add tag'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.TransactionTag.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transaction-tags-all'] });
      queryClient.invalidateQueries({ queryKey: ['transaction-tags'] });
    },
    onError: (e) => toast.error(e?.message || 'Update failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.TransactionTag.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transaction-tags-all'] });
      queryClient.invalidateQueries({ queryKey: ['transaction-tags'] });
      toast.success('Tag deleted');
    },
    onError: (e) => toast.error(e?.message || 'Delete failed'),
  });

  const canEdit = currentUser && ADMIN_ROLES.includes(currentUser.app_role);

  const handleAdd = (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { toast.error('Enter a tag name'); return; }
    if (tags.some(t => t.name.toLowerCase() === trimmed.toLowerCase())) {
      toast.error('That tag already exists'); return;
    }
    createMutation.mutate({ name: trimmed, color, active: true });
  };

  if (!currentUser) {
    return <div className="p-8 text-center text-gray-500">Loading…</div>;
  }

  if (!canEdit) {
    return (
      <div className="p-8 text-center text-gray-500">
        Only admins can manage transaction tags.
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <TagIcon className="h-7 w-7 text-blue-600" />
          Transaction Tags
        </h1>
        <p className="text-gray-500 mt-1">
          Manage the list of tags shown when a mentor logs a <strong>BONUS</strong> transaction.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Add a new tag</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAdd} className="flex flex-col md:flex-row gap-3">
            <Input
              placeholder="e.g. Promo, Deposit Match, Referral Bonus…"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="md:flex-1"
            />
            <div className="flex items-center gap-2">
              {PRESET_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-6 h-6 rounded-full border-2 ${color === c ? 'border-slate-900' : 'border-transparent'}`}
                  style={{ backgroundColor: c }}
                  aria-label={`Color ${c}`}
                />
              ))}
            </div>
            <Button type="submit" disabled={createMutation.isPending} className="bg-blue-600 hover:bg-blue-700">
              <Plus className="h-4 w-4 mr-1" />
              Add tag
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Existing tags ({tags.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-center text-gray-500">Loading…</div>
          ) : tags.length === 0 ? (
            <div className="p-6 text-center text-gray-500">No tags yet. Add one above to get started.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Color</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tags.map(t => (
                  <TableRow key={t.id}>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        style={t.color ? { backgroundColor: t.color + '20', color: t.color, borderColor: t.color + '40' } : undefined}
                      >
                        {t.name}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-2 text-sm font-mono text-gray-600">
                        <span className="inline-block w-4 h-4 rounded-full border" style={{ backgroundColor: t.color || '#e5e7eb' }} />
                        {t.color || '(none)'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={t.active !== false}
                        onCheckedChange={(v) => updateMutation.mutate({ id: t.id, data: { active: v } })}
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          if (confirm(`Delete tag "${t.name}"? Transactions already tagged keep the label.`)) {
                            deleteMutation.mutate(t.id);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-red-600" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
