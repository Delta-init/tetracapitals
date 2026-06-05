import React, { useState, useEffect } from 'react';
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Search, ArrowLeft, Clock, AlertCircle, CheckCircle2, XCircle, Ticket as TicketIcon } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import TicketForm from "../components/tickets/TicketForm";
import TicketChat from "../components/tickets/TicketChat";
import { canCreateTicket, canRespondToTicket, filterTicketsByRole, getAutoAssignRole } from "../components/utils/TicketAccessControl";
import generateTicketNumber from "../components/utils/TicketNumberGenerator";
import { logAction } from "../components/utils/AuditLogger";
import { getEffectiveUser } from "../components/utils/ImpersonationContext";

export default function Tickets() {
  const [currentUser, setCurrentUser] = useState(null);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterPriority, setFilterPriority] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');

  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(u => setCurrentUser(getEffectiveUser(u)));
  }, []);

  const { data: tickets = [] } = useQuery({
    queryKey: ['tickets'],
    queryFn: () => base44.entities.Ticket.list('-created_date'),
    enabled: !!currentUser,
  });

  const { data: students = [] } = useQuery({
    queryKey: ['students'],
    queryFn: () => base44.entities.Student.list(),
    enabled: !!currentUser,
  });

  const { data: allUsers = [] } = useQuery({
    queryKey: ['all-users-tickets'],
    queryFn: async () => {
      try { return await base44.entities.User.list(); } catch (e) { return []; }
    },
    enabled: !!currentUser,
    retry: false,
  });

  const { data: rawMessages = [] } = useQuery({
    queryKey: ['ticket-messages', selectedTicket?.id],
    queryFn: () => base44.entities.TicketMessage.filter({ ticket_id: selectedTicket.id }, 'created_date'),
    enabled: !!selectedTicket,
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (selectedTicket && tickets.length > 0) {
      const updated = tickets.find(t => t.id === selectedTicket.id);
      if (updated) setSelectedTicket(updated);
    }
  }, [tickets]);

  // Auto-open ticket from notification URL param
  useEffect(() => {
    if (!currentUser || tickets.length === 0) return;
    const urlParams = new URLSearchParams(window.location.search);
    const openTicketId = urlParams.get('open');
    if (openTicketId && !selectedTicket) {
      const ticket = tickets.find(t => t.id === openTicketId);
      if (ticket) setSelectedTicket(ticket);
    }
  }, [currentUser, tickets]);

  const createMutation = useMutation({
    mutationFn: async (formData) => {
      const ticketNumber = generateTicketNumber(tickets);
      const assignedToRole = getAutoAssignRole(formData.category);
      const assignedUser = allUsers.find(u => u.app_role === assignedToRole);

      const newTicket = await base44.entities.Ticket.create({
        ticket_number: ticketNumber,
        title: formData.title,
        description: formData.description,
        category: formData.category,
        priority: formData.priority,
        status: 'open',
        created_by_id: currentUser.id,
        created_by_name: currentUser.full_name,
        assigned_to_role: assignedToRole,
        assigned_to_id: assignedUser?.id || '',
        assigned_to_name: assignedUser?.full_name || '',
        student_id: formData.student_id || '',
        student_name: formData.student_name || '',
        screenshot_url: formData.screenshot_url || '',
        escalated: false,
      });

      await base44.entities.TicketMessage.create({
        ticket_id: newTicket.id,
        sender_id: currentUser.id,
        sender_name: currentUser.full_name,
        sender_role: currentUser.app_role,
        message: formData.description,
        message_type: 'user_message',
      });

      // Notify assigned role users + super admins via backend (service role)
      try {
        await base44.functions.invoke('sendTicketNotification', {
          title: `New Ticket: ${ticketNumber}`,
          message: `${currentUser.full_name} raised a ${formData.category} ticket: ${formData.title}`,
          type: 'ticket_new',
          assignedToRole,
          assignedToId: assignedUser?.id || null,
          referenceId: newTicket.id,
        });
      } catch (e) { console.error('Notification error (create):', e); }

      await logAction('create_ticket', 'Ticket', newTicket.id, `Created ticket: ${formData.title}`, null, newTicket);
      return newTicket;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      setShowCreateDialog(false);
      toast.success('Ticket submitted successfully');
    },
  });

  const sendMessageMutation = useMutation({
    mutationFn: async ({ messageText, attachmentUrl }) => {
      const isFirstAdminResponse = canRespondToTicket(currentUser.app_role) && selectedTicket.status === 'open';

      await base44.entities.TicketMessage.create({
        ticket_id: selectedTicket.id,
        sender_id: currentUser.id,
        sender_name: currentUser.full_name,
        sender_role: currentUser.app_role,
        message: messageText || '',
        message_type: 'user_message',
        ...(attachmentUrl ? { attachment_url: attachmentUrl } : {}),
      });

      if (isFirstAdminResponse) {
        await base44.entities.Ticket.update(selectedTicket.id, {
          status: 'in_progress',
          first_response_date: new Date().toISOString(),
        });
        // Notification 3: in_progress — notify ticket creator directly (we have the id)
        try {
          await base44.entities.Notification.create({
            user_id: selectedTicket.created_by_id,
            title: `Ticket ${selectedTicket.ticket_number} In Progress`,
            message: `Your ticket '${selectedTicket.title}' is now being handled.`,
            type: 'ticket_status',
            read: false,
            reference_id: selectedTicket.id,
          });
        } catch (e) { console.error('Notification error (in_progress):', e); }
      }

      // Notification 2: new reply
      const isCreator = currentUser.id === selectedTicket.created_by_id;
      if (isCreator) {
        // Mentor sent reply — notify assigned admin + super admins via backend
        try {
          await base44.functions.invoke('sendTicketNotification', {
            title: `New Reply: ${selectedTicket.ticket_number}`,
            message: `${currentUser.full_name} replied to ticket: ${selectedTicket.title}`,
            type: 'ticket_reply',
            assignedToRole: selectedTicket.assigned_to_role,
            assignedToId: selectedTicket.assigned_to_id || null,
            referenceId: selectedTicket.id,
          });
        } catch (e) { console.error('Notification error (reply mentor):', e); }
      } else {
        // Admin sent reply — notify ticket creator directly
        try {
          await base44.entities.Notification.create({
            user_id: selectedTicket.created_by_id,
            title: `New Reply: ${selectedTicket.ticket_number}`,
            message: `${currentUser.full_name} replied to ticket: ${selectedTicket.title}`,
            type: 'ticket_reply',
            read: false,
            reference_id: selectedTicket.id,
          });
        } catch (e) { console.error('Notification error (reply admin):', e); }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket-messages', selectedTicket?.id] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: async () => {
      await base44.entities.Ticket.update(selectedTicket.id, {
        status: 'resolved',
        resolved_date: new Date().toISOString(),
      });
      await base44.entities.TicketMessage.create({
        ticket_id: selectedTicket.id,
        sender_id: 'system',
        sender_name: 'System',
        sender_role: 'system',
        message: `Ticket has been marked as resolved by ${currentUser.full_name}. Waiting for confirmation from ${selectedTicket.created_by_name} to close.`,
        message_type: 'system_message',
      });
      await base44.entities.Notification.create({
        user_id: selectedTicket.created_by_id,
        title: `Ticket ${selectedTicket.ticket_number} Resolved`,
        message: `Your ticket "${selectedTicket.title}" has been resolved. Please close it to confirm.`,
        type: 'ticket_resolved',
        read: false,
        reference_id: selectedTicket.id,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      queryClient.invalidateQueries({ queryKey: ['ticket-messages', selectedTicket?.id] });
      toast.success('Ticket marked as resolved');
    },
  });

  const closeMutation = useMutation({
    mutationFn: async () => {
      await base44.entities.Ticket.update(selectedTicket.id, {
        status: 'closed',
        closed_date: new Date().toISOString(),
      });
      await base44.entities.TicketMessage.create({
        ticket_id: selectedTicket.id,
        sender_id: 'system',
        sender_name: 'System',
        sender_role: 'system',
        message: `Ticket closed by ${currentUser.full_name}.`,
        message_type: 'system_message',
      });
      // Notification 5: closed — notify assigned admin + super admins via backend
      try {
        await base44.functions.invoke('sendTicketNotification', {
          title: `Ticket ${selectedTicket.ticket_number} Closed`,
          message: `${selectedTicket.created_by_name} confirmed and closed the ticket.`,
          type: 'ticket_closed',
          assignedToRole: selectedTicket.assigned_to_role,
          assignedToId: selectedTicket.assigned_to_id || null,
          referenceId: selectedTicket.id,
        });
      } catch (e) { console.error('Notification error (closed):', e); }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      queryClient.invalidateQueries({ queryKey: ['ticket-messages', selectedTicket?.id] });
      toast.success('Ticket closed');
    },
  });

  if (!currentUser) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
      </div>
    );
  }

  let visibleTickets = filterTicketsByRole(currentUser, tickets);
  if (filterStatus !== 'all') visibleTickets = visibleTickets.filter(t => t.status === filterStatus);
  if (filterPriority !== 'all') visibleTickets = visibleTickets.filter(t => t.priority === filterPriority);
  if (filterCategory !== 'all') visibleTickets = visibleTickets.filter(t => t.category === filterCategory);
  if (searchTerm) visibleTickets = visibleTickets.filter(t =>
    t.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.ticket_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.created_by_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const statusCounts = {
    open: visibleTickets.filter(t => t.status === 'open').length,
    in_progress: visibleTickets.filter(t => t.status === 'in_progress').length,
    resolved: visibleTickets.filter(t => t.status === 'resolved').length,
    closed: visibleTickets.filter(t => t.status === 'closed').length,
  };

  const getStatusBadge = (status) => {
    const map = {
      open: { cls: 'bg-blue-100 text-blue-800 border-blue-200', Icon: Clock },
      in_progress: { cls: 'bg-yellow-100 text-yellow-800 border-yellow-200', Icon: AlertCircle },
      resolved: { cls: 'bg-green-100 text-green-800 border-green-200', Icon: CheckCircle2 },
      closed: { cls: 'bg-gray-100 text-gray-800 border-gray-200', Icon: XCircle },
    };
    const { cls, Icon } = map[status] || map.open;
    return (
      <Badge variant="outline" className={cls}>
        <Icon className="h-3 w-3 mr-1" />{status.replace('_', ' ')}
      </Badge>
    );
  };

  const getPriorityBadge = (priority) => {
    const colors = {
      low: 'bg-gray-100 text-gray-700',
      medium: 'bg-blue-100 text-blue-700',
      high: 'bg-orange-100 text-orange-700',
      urgent: 'bg-red-100 text-red-700',
    };
    return <Badge variant="outline" className={colors[priority] || ''}>{priority}</Badge>;
  };

  const filteredStudents = ['super_admin', 'admin', 'broker_admin', 'academic_head', 'academic_admin', 'finance_admin'].includes(currentUser.app_role)
    ? students
    : students.filter(s => s.primary_mentor_id === currentUser.id || s.senior_mentor_id === currentUser.id);

  if (selectedTicket) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
        <div className="max-w-4xl mx-auto space-y-4">
          <Button variant="outline" onClick={() => setSelectedTicket(null)} className="gap-2">
            <ArrowLeft className="h-4 w-4" /> Back to Tickets
          </Button>
          <div style={{ height: 'calc(100vh - 160px)' }}>
            <TicketChat
              ticket={selectedTicket}
              messages={rawMessages}
              currentUser={currentUser}
              onSendMessage={(msg, attachmentUrl) => sendMessageMutation.mutate({ messageText: msg, attachmentUrl })}
              onResolve={() => resolveMutation.mutate()}
              onClose={() => closeMutation.mutate()}
              isSending={sendMessageMutation.isPending}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight flex items-center gap-3">
            <TicketIcon className="h-9 w-9 text-blue-600" />
            Support Tickets
          </h1>
          {canCreateTicket(currentUser.app_role) && (
            <Button onClick={() => setShowCreateDialog(true)} className="bg-blue-600 hover:bg-blue-700">
              <Plus className="h-4 w-4 mr-2" /> Create Ticket
            </Button>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Open', key: 'open', color: 'bg-blue-50 border-blue-200 text-blue-700' },
            { label: 'In Progress', key: 'in_progress', color: 'bg-yellow-50 border-yellow-200 text-yellow-700' },
            { label: 'Resolved', key: 'resolved', color: 'bg-green-50 border-green-200 text-green-700' },
            { label: 'Closed', key: 'closed', color: 'bg-gray-50 border-gray-200 text-gray-700' },
          ].map(s => (
            <div key={s.key} className={`rounded-xl border p-4 text-center ${s.color}`}>
              <p className="text-3xl font-bold">{statusCounts[s.key]}</p>
              <p className="text-sm font-medium mt-1">{s.label}</p>
            </div>
          ))}
        </div>

        <Card className="border-gray-200">
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-3 items-center">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search tickets..." className="pl-9" />
              </div>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterPriority} onValueChange={setFilterPriority}>
                <SelectTrigger className="w-36"><SelectValue placeholder="Priority" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Priority</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterCategory} onValueChange={setFilterCategory}>
                <SelectTrigger className="w-36"><SelectValue placeholder="Category" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  <SelectItem value="academic">Academic</SelectItem>
                  <SelectItem value="financial">Financial</SelectItem>
                  <SelectItem value="technical">Technical</SelectItem>
                  <SelectItem value="general">General</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card className="border-gray-200">
          <CardHeader className="border-b border-gray-100 bg-gradient-to-r from-gray-50 to-blue-50">
            <CardTitle className="text-lg font-semibold">Tickets ({visibleTickets.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead>Ticket #</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created By</TableHead>
                    <TableHead>Assigned To</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleTickets.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-10 text-gray-400">No tickets found</TableCell>
                    </TableRow>
                  ) : visibleTickets.map(ticket => (
                    <TableRow
                      key={ticket.id}
                      className="hover:bg-blue-50 cursor-pointer transition-colors"
                      onClick={() => setSelectedTicket(ticket)}
                    >
                      <TableCell className="font-mono text-xs font-semibold text-blue-700">{ticket.ticket_number || '—'}</TableCell>
                      <TableCell className="font-medium max-w-xs truncate">{ticket.title}</TableCell>
                      <TableCell><Badge variant="outline" className="capitalize">{ticket.category}</Badge></TableCell>
                      <TableCell>{getPriorityBadge(ticket.priority)}</TableCell>
                      <TableCell>{getStatusBadge(ticket.status)}</TableCell>
                      <TableCell className="text-sm">{ticket.created_by_name}</TableCell>
                      <TableCell className="text-sm capitalize">{ticket.assigned_to_name || ticket.assigned_to_role?.replace(/_/g, ' ')}</TableCell>
                      <TableCell className="text-sm">{ticket.created_date ? format(new Date(ticket.created_date), 'MMM d, yyyy') : '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New Ticket</DialogTitle>
          </DialogHeader>
          <TicketForm
            onSubmit={(data) => createMutation.mutate(data)}
            onCancel={() => setShowCreateDialog(false)}
            isSubmitting={createMutation.isPending}
            students={filteredStudents}
            currentUser={currentUser}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}