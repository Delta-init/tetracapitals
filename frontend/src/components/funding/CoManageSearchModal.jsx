import React, { useState, useEffect } from 'react';
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Search, User, Loader2 } from "lucide-react";

export default function CoManageSearchModal({ currentUser, onSelectStudent, onClose }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  // Co-management means finding a client managed by ANOTHER mentor — which is
  // outside this user's own/downline data scope, so we can't rely on the
  // (now scoped) Student.list(). Instead hit the dedicated unscoped lookup
  // function, debounced as the user types.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        // functions.invoke returns { data, status } — the students are in .data.
        const res = await base44.functions.invoke('searchStudents', { q });
        const rows = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
        if (!cancelled) {
          // Hide clients this user already owns — they don't co-manage their own.
          setResults(rows.filter(s => s.primary_mentor_id !== currentUser?.id));
        }
      } catch (_) {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [query, currentUser?.id]);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Find a Client for Co-Management</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-gray-500 -mt-2">Search by client name or email. You can only see their name and current mentor.</p>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            className="pl-9"
            placeholder="Type client name or email..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>

        <div className="space-y-2 max-h-64 overflow-y-auto">
          {query.trim().length < 2 ? (
            <p className="text-sm text-gray-400 text-center py-4">Type at least 2 characters to search</p>
          ) : loading ? (
            <p className="text-sm text-gray-400 text-center py-4 flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Searching…</p>
          ) : results.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No clients found</p>
          ) : (
            results.map(student => (
              <button
                key={student.id}
                onClick={() => onSelectStudent(student)}
                className="w-full text-left flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:bg-blue-50 hover:border-blue-200 transition-colors"
              >
                <div className="h-8 w-8 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                  <User className="h-4 w-4 text-gray-500" />
                </div>
                <div>
                  <p className="font-medium text-gray-900 text-sm">{student.full_name}</p>
                  <p className="text-xs text-gray-500">Managed by: {student.primary_mentor_name || 'Unknown'}</p>
                </div>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
