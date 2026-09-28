import React, { useMemo, useState } from 'react';
import { PageTitle } from '@/components/common/PageHeader';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Network, User as UserIcon, ChevronDown, ChevronRight } from 'lucide-react';

function TreeNode({ node, childrenMap, depth, seen }) {
  const [open, setOpen] = useState(true);
  const kids = (childrenMap[node.id] || []).slice().sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
  const hasKids = kids.length > 0;
  if (seen.has(node.id)) return null; // cycle guard
  const nextSeen = new Set(seen); nextSeen.add(node.id);

  return (
    <div>
      <div className="flex items-center gap-2 py-1">
        {hasKids ? (
          <button onClick={() => setOpen(o => !o)} className="text-gray-400 hover:text-gray-700">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        ) : <span className="w-4 inline-block" />}
        <div className="flex items-center gap-2 rounded-md border bg-white px-3 py-1.5 shadow-sm">
          <UserIcon className="h-4 w-4 text-indigo-500 flex-shrink-0" />
          <span className="font-medium">{node.full_name}</span>
          <Badge variant="outline" className="text-xs">{node.app_role?.replace(/_/g, ' ')}</Badge>
          <span className="text-xs text-gray-400 hidden sm:inline">{node.email}</span>
          {hasKids && <span className="text-xs text-indigo-400">· {kids.length} under</span>}
        </div>
      </div>
      {hasKids && open && (
        <div className="ml-5 border-l-2 border-gray-200 pl-4">
          {kids.map(k => <TreeNode key={k.id} node={k} childrenMap={childrenMap} depth={depth + 1} seen={nextSeen} />)}
        </div>
      )}
    </div>
  );
}

export default function Hierarchy() {
  const [q, setQ] = useState('');
  const { data: users = [], isLoading } = useQuery({
    queryKey: ['all-users-hierarchy'],
    queryFn: () => base44.entities.User.list(),
  });

  const { treeRoots, childrenMap, standalone } = useMemo(() => {
    const byId = {};
    users.forEach(u => { byId[u.id] = u; });
    const childrenMap = {};
    users.forEach(u => {
      if (u.up_head_id && byId[u.up_head_id]) {
        (childrenMap[u.up_head_id] = childrenMap[u.up_head_id] || []).push(u);
      }
    });
    const roots = users.filter(u => !u.up_head_id || !byId[u.up_head_id]);
    const treeRoots = roots
      .filter(r => (childrenMap[r.id] || []).length > 0)
      .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
    const standalone = roots
      .filter(r => (childrenMap[r.id] || []).length === 0)
      .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
    return { treeRoots, childrenMap, standalone };
  }, [users]);

  const filteredStandalone = q
    ? standalone.filter(u => `${u.full_name} ${u.email}`.toLowerCase().includes(q.toLowerCase()))
    : standalone;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-100/20 p-6">
      <div className="w-full max-w-5xl mx-auto space-y-6">
        <div>
          <PageTitle eyebrow="People & Access" icon={Network}>Hierarchy</PageTitle>
          <p className="mt-2 max-w-3xl text-sm text-slate-500 sm:text-base">
            The org tree built from each staff's <strong>Up Head</strong>. Commission walks up these branches.
          </p>
        </div>

        <Card>
          <CardContent className="p-5">
            {isLoading ? (
              <div className="py-10 text-center text-gray-400">Loading…</div>
            ) : treeRoots.length === 0 ? (
              <div className="py-10 text-center text-gray-400">
                No hierarchy set yet. Open a staff in <strong>Personnel</strong> and set their <strong>Up Head</strong> to build the tree.
              </div>
            ) : (
              <div className="space-y-4">
                {treeRoots.map(root => (
                  <div key={root.id} className="pb-2">
                    <TreeNode node={root} childrenMap={childrenMap} depth={0} seen={new Set()} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Staff not part of any hierarchy */}
        <details className="group">
          <summary className="cursor-pointer text-sm text-gray-500 hover:text-gray-700 select-none">
            Not in any hierarchy ({standalone.length}) — no Up Head and no one under them
          </summary>
          <Card className="mt-2"><CardContent className="p-4 space-y-2">
            <Input placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} className="h-8 max-w-xs" />
            <div className="flex flex-wrap gap-2">
              {filteredStandalone.map(u => (
                <div key={u.id} className="flex items-center gap-2 rounded-md border bg-white px-2.5 py-1 text-sm">
                  <UserIcon className="h-3.5 w-3.5 text-gray-400" />
                  <span>{u.full_name}</span>
                  <Badge variant="outline" className="text-xs">{u.app_role?.replace(/_/g, ' ')}</Badge>
                </div>
              ))}
              {filteredStandalone.length === 0 && <span className="text-sm text-gray-400">None.</span>}
            </div>
          </CardContent></Card>
        </details>
      </div>
    </div>
  );
}
