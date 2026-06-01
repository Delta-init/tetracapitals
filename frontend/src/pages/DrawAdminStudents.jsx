import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, Mail, Phone, MapPin } from 'lucide-react';

export default function DrawAdminStudents() {
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => {
    const fetchUser = async () => {
      const user = await base44.auth.me();
      setCurrentUser(user);
    };
    fetchUser();
  }, []);

  const { data: students = [], isLoading } = useQuery({
    queryKey: ['assignedStudents', currentUser?.id],
    queryFn: async () => {
      if (!currentUser) return [];
      const allStudents = await base44.entities.Student.list();
      return allStudents.filter(
        s => s.assigned_draw_admin_id === currentUser.id && s.retention_status === 'assigned_to_draw_admin'
      );
    },
    enabled: !!currentUser
  });

  if (!currentUser) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>;
  }

  if (currentUser.app_role !== 'draw_admin') {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <AlertCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
          <p className="text-xl font-semibold text-gray-700">Access Denied</p>
          <p className="text-gray-500">Only Draw Admin can access this page</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900">My Retention Students</h1>
          <p className="text-gray-600 mt-2">Students assigned to you for retention efforts</p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-blue-600" />
          </div>
        ) : students.length === 0 ? (
          <Card className="bg-white border-l-4 border-blue-500">
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <AlertCircle className="h-8 w-8 text-blue-500" />
                <div>
                  <p className="font-semibold text-gray-900">No Students Assigned</p>
                  <p className="text-gray-600 text-sm">You currently have no students assigned for retention</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6">
            {students.map((student) => (
              <StudentCard key={student.id} student={student} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StudentCard({ student }) {
  return (
    <Card className="bg-white hover:shadow-lg transition-shadow">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-xl text-gray-900">{student.full_name}</CardTitle>
            <p className="text-sm text-gray-600 mt-1">Student Code: {student.student_code}</p>
          </div>
          <Badge className="bg-green-100 text-green-800">
            Active Student
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-2">Contact Information</p>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-gray-400" />
                <p className="text-sm text-gray-700">{student.email}</p>
              </div>
              {student.phone && (
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-gray-400" />
                  <p className="text-sm text-gray-700">{student.phone}</p>
                </div>
              )}
              {student.country && (
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-gray-400" />
                  <p className="text-sm text-gray-700">{student.country}</p>
                </div>
              )}
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-2">Mentor Information</p>
            <div className="space-y-2">
              <div>
                <p className="text-xs text-gray-500">Primary Mentor</p>
                <p className="text-sm font-medium text-gray-900">{student.primary_mentor_name}</p>
              </div>
              {student.senior_mentor_name && (
                <div>
                  <p className="text-xs text-gray-500">Senior Mentor</p>
                  <p className="text-sm font-medium text-gray-900">{student.senior_mentor_name}</p>
                </div>
              )}
            </div>
          </div>
        </div>
        {student.notes && (
          <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
            <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-2">Notes</p>
            <p className="text-sm text-gray-700">{student.notes}</p>
          </div>
        )}
        <div className="pt-4 border-t border-gray-200">
          <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">Assigned Date</p>
          <p className="text-sm text-gray-600">{new Date(student.assigned_to_draw_admin_date).toLocaleDateString()}</p>
        </div>
      </CardContent>
    </Card>
  );
}