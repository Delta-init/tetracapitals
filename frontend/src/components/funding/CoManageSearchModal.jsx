import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Search, User } from "lucide-react";

export default function CoManageSearchModal({ allStudents = [], currentUser, onSelectStudent, onClose }) {
  const [query, setQuery] = useState('');

  // Only show students NOT owned by current user
  const filtered = query.trim().length < 2 ? [] : allStudents.filter(s => {
    if (s.primary_mentor_id === currentUser?.id) return false;
    return s.email?.toLowerCase().includes(query.toLowerCase());
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Find a Client for Co-Management</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-gray-500 -mt-2">Search by client email. You can only see their name and current mentor.</p>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            className="pl-9"
            placeholder="Type client email..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>

        <div className="space-y-2 max-h-64 overflow-y-auto">
          {query.trim().length < 2 ? (
            <p className="text-sm text-gray-400 text-center py-4">Type at least 2 characters to search</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No clients found</p>
          ) : (
            filtered.map(student => (
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