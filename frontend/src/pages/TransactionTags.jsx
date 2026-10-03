import React, { useState, useEffect } from 'react';
import { PageTitle } from '@/components/common/PageHeader';
import { TablePagination, usePagination } from '@/components/common/TablePagination';
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
  const [amount, setAmount] = useState('');
  // A course's terms for a Bonus (a course payment): its full price, its whole bonus, its AED 2,000 instalments.
  const [fullPrice, setFullPrice] = useState('');
  const [fullCurrency, setFullCurrency] = useState('USD');
  const [bonusUsd, setBonusUsd] = useState('');
  const [instalments, setInstalments] = useState('');
  const [bonusType, setBonusType] = useState('with'); // 'with' = added to MT5, 'without' = not added
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(setCurrentUser).catch(() => setCurrentUser(null));
  }, []);

  const { data: tags = [], isLoading } = useQuery({
    queryKey: ['transaction-tags-all'],
    queryFn: () => base44.entities.TransactionTag.list('name'),
  });
  // The products table shows 25 to a page.
  const { pageItems: pageTags, bar } = usePagination(tags);

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.TransactionTag.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transaction-tags-all'] });
      queryClient.invalidateQueries({ queryKey: ['transaction-tags'] });
      toast.success('Product added');
      setName('');
      setAmount('');
      setFullPrice('');
      setFullCurrency('USD');
      setBonusUsd('');
      setInstalments('');
      setBonusType('with');
      setColor(PRESET_COLORS[0]);
    },
    onError: (e) => toast.error(e?.message || 'Failed to add product'),
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
      toast.success('Product deleted');
    },
    onError: (e) => toast.error(e?.message || 'Delete failed'),
  });

  const canEdit = currentUser && ADMIN_ROLES.includes(currentUser.app_role);

  const handleAdd = (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { toast.error('Enter a product name'); return; }
    if (tags.some(t => t.name.toLowerCase() === trimmed.toLowerCase())) {
      toast.error('That product already exists'); return;
    }
    createMutation.mutate({
      name: trimmed, color, amount_usd: parseFloat(amount) || 0, bonus_type: bonusType, active: true,
      full_price: parseFloat(fullPrice) || 0, full_price_currency: fullCurrency, bonus_usd: parseFloat(bonusUsd) || 0,
      instalments: Math.max(0, parseInt(instalments, 10) || 0),
    });
  };

  if (!currentUser) {
    return <div className="p-8 text-center text-gray-500">Loading…</div>;
  }

  if (!canEdit) {
    return (
      <div className="p-8 text-center text-gray-500">
        Only admins can manage products.
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <PageTitle eyebrow="Funding" icon={TagIcon}>Products</PageTitle>
        <p className="mt-2 max-w-3xl text-sm text-slate-500 sm:text-base">
          Manage the products staff select when logging a <strong>BONUS</strong>. A course with a bonus set is offered there: paid in full — its full price, and its whole bonus in MT5 at once; or in instalments of AED 2,000 (as many as set) — $500 bonus each, the rest on hold until the next.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Add a new product</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAdd} className="flex flex-col md:flex-row gap-3">
            <Input
              placeholder="e.g. Starter Pack, Pro Course, VIP Signal…"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="md:flex-1"
            />
            <Input
              type="number"
              step="0.01"
              min="0"
              placeholder="Amount (USD)"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="md:w-40"
            />
            <div className="flex gap-1 md:w-48">
              <Input type="number" step="0.01" min="0" placeholder="Full price" value={fullPrice} onChange={(e) => setFullPrice(e.target.value)} />
              <select value={fullCurrency} onChange={(e) => setFullCurrency(e.target.value)} className="h-10 rounded-md border border-input bg-background px-1 text-sm" aria-label="Full price currency">
                <option value="USD">USD</option>
                <option value="AED">AED</option>
              </select>
            </div>
            <Input type="number" step="0.01" min="0" placeholder="Bonus (USD)" value={bonusUsd} onChange={(e) => setBonusUsd(e.target.value)} className="md:w-32" />
            <Input type="number" step="1" min="0" placeholder="Instalments" value={instalments} onChange={(e) => setInstalments(e.target.value)} className="md:w-28" title="How many AED 2,000 instalments — 0 for full payment only" />
            <select
              value={bonusType}
              onChange={(e) => setBonusType(e.target.value)}
              className="h-10 rounded-md border border-input bg-background px-2 text-sm md:w-44"
            >
              <option value="with">With Bonus (added to MT5)</option>
              <option value="without">Without Bonus (not added)</option>
            </select>
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
              Add product
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Existing products ({tags.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-center text-gray-500">Loading…</div>
          ) : tags.length === 0 ? (
            <div className="p-6 text-center text-gray-500">No products yet. Add one above to get started.</div>
          ) : (<>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Amount (USD)</TableHead>
                  <TableHead>Full price</TableHead>
                  <TableHead>Bonus (USD)</TableHead>
                  <TableHead title="How many AED 2,000 instalments — 0 for full payment only">Instalments</TableHead>
                  <TableHead>Bonus type</TableHead>
                  <TableHead>Includes (bundled)</TableHead>
                  <TableHead>Color</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageTags.map(t => (
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
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        key={`${t.id}-${t.amount_usd ?? 0}`}
                        defaultValue={t.amount_usd ?? 0}
                        onBlur={(e) => {
                          const v = parseFloat(e.target.value) || 0;
                          if (v !== (t.amount_usd ?? 0)) updateMutation.mutate({ id: t.id, data: { amount_usd: v } });
                        }}
                        className="w-28 h-8"
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          key={`${t.id}-price-${t.full_price ?? 0}`}
                          defaultValue={t.full_price ?? 0}
                          onBlur={(e) => {
                            const v = parseFloat(e.target.value) || 0;
                            if (v !== (t.full_price ?? 0)) updateMutation.mutate({ id: t.id, data: { full_price: v } });
                          }}
                          className="w-24 h-8"
                          aria-label={`${t.name} full price`}
                        />
                        <select
                          value={t.full_price_currency === 'AED' ? 'AED' : 'USD'}
                          onChange={(e) => updateMutation.mutate({ id: t.id, data: { full_price_currency: e.target.value } })}
                          className="h-8 rounded-md border border-input bg-background px-1 text-sm"
                          aria-label={`${t.name} full price currency`}
                        >
                          <option value="USD">USD</option>
                          <option value="AED">AED</option>
                        </select>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        key={`${t.id}-bonus-${t.bonus_usd ?? 0}`}
                        defaultValue={t.bonus_usd ?? 0}
                        onBlur={(e) => {
                          const v = parseFloat(e.target.value) || 0;
                          if (v !== (t.bonus_usd ?? 0)) updateMutation.mutate({ id: t.id, data: { bonus_usd: v } });
                        }}
                        className="w-24 h-8"
                        aria-label={`${t.name} bonus in USD`}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="1"
                        min="0"
                        key={`${t.id}-inst-${t.instalments ?? 0}`}
                        defaultValue={t.instalments ?? 0}
                        onBlur={(e) => {
                          const v = Math.max(0, parseInt(e.target.value, 10) || 0);
                          if (v !== (t.instalments ?? 0)) updateMutation.mutate({ id: t.id, data: { instalments: v } });
                        }}
                        className="w-16 h-8"
                        aria-label={`${t.name} instalments of AED 2,000`}
                      />
                    </TableCell>
                    <TableCell>
                      <select
                        value={t.bonus_type || 'with'}
                        onChange={(e) => updateMutation.mutate({ id: t.id, data: { bonus_type: e.target.value } })}
                        className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                      >
                        <option value="with">With Bonus</option>
                        <option value="without">Without Bonus</option>
                      </select>
                    </TableCell>
                    <TableCell>
                      {/* Bundled products: picking THIS product in a bonus request
                          auto-includes these, without adding to the amount. */}
                      <details className="relative">
                        <summary className="cursor-pointer text-sm text-blue-600 hover:underline list-none select-none">
                          {Array.isArray(t.includes) && t.includes.length > 0
                            ? t.includes.join(', ')
                            : <span className="text-gray-400">None</span>}
                          <span className="ml-1 text-gray-400">▾</span>
                        </summary>
                        <div className="absolute z-20 mt-1 bg-white border rounded-md shadow-lg p-2 space-y-1 max-h-56 overflow-auto min-w-48">
                          {tags.filter(o => o.id !== t.id).length === 0 ? (
                            <p className="text-xs text-gray-400 px-1">No other products</p>
                          ) : tags.filter(o => o.id !== t.id).map(o => {
                            const included = Array.isArray(t.includes) && t.includes.includes(o.name);
                            return (
                              <label key={o.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5">
                                <input
                                  type="checkbox"
                                  checked={included}
                                  onChange={(e) => {
                                    const cur = Array.isArray(t.includes) ? t.includes : [];
                                    const next = e.target.checked
                                      ? [...new Set([...cur, o.name])]
                                      : cur.filter(n => n !== o.name);
                                    updateMutation.mutate({ id: t.id, data: { includes: next } });
                                  }}
                                />
                                <span>{o.name}</span>
                                <span className="text-gray-400 text-xs ml-auto">${o.amount_usd ?? 0}</span>
                              </label>
                            );
                          })}
                        </div>
                      </details>
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
            <TablePagination {...bar} />
          </>)}
        </CardContent>
      </Card>
    </div>
  );
}
