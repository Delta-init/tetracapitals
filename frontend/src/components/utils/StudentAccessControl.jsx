// Utility functions for student access control based on user role

export const canSubmitStudentRequest = (userRole) => {
  return ['junior_mentor', 'senior_mentor', 'subjunior_mentor', 'super_admin', 'admin', 'broker_admin', 'academic_head', 'academic_admin', 'assistance'].includes(userRole);
};

export const canEditStudent = (userRole) => {
  return ['super_admin', 'admin'].includes(userRole);
};

export const canCreateMT5Account = (userRole) => {
  return ['super_admin', 'admin', 'broker_admin'].includes(userRole);
};

export const canEditMT5Account = (userRole) => {
  return ['super_admin', 'admin'].includes(userRole);
};

export const shouldMaskStudentData = (_userRole) => {
  // Masking disabled — all authenticated users see unmasked student contact details.
  // (Previously: only super_admin/admin/broker_admin/academic_admin/assistance saw unmasked data.)
  return false;
};

export const maskEmail = (email) => {
  if (!email) return '';
  const [localPart, domain] = email.split('@');
  if (!domain) return email;
  if (localPart.length <= 5) {
    return `${localPart.substring(0, Math.min(3, localPart.length))}*****${localPart.slice(-Math.min(2, localPart.length))}@${domain}`;
  }
  const first3 = localPart.substring(0, 3);
  const last2 = localPart.substring(localPart.length - 2);
  return `${first3}*****${last2}@${domain}`;
};

export const maskPhone = (phone) => {
  if (!phone) return '';
  if (phone.length <= 4) {
    return '**' + phone.slice(-Math.min(2, phone.length));
  }
  const first2 = phone.substring(0, 2);
  const last2 = phone.substring(phone.length - 2);
  return `${first2}******${last2}`;
};

// Filter students based on user role
export const filterStudentsByRole = (students, currentUser, allUsers = []) => {
  if (!currentUser) return [];
  
  const { app_role: role, id } = currentUser;
  
  // Super Admin, Admin and Broker Admin see all students
  if (['super_admin', 'admin', 'broker_admin'].includes(role)) {
    return students;
  }
  
  // Academic Head and Academic Admin see all students (with masking)
  if (['academic_head', 'academic_admin'].includes(role)) {
    return students;
  }
  
  // Junior Mentor and Sub Junior Mentor see only their own students
  if (role === 'junior_mentor' || role === 'subjunior_mentor') {
    return students.filter(s => s.primary_mentor_id === id);
  }
  
  // Senior Mentor sees their own students + their junior mentors' students
  if (role === 'senior_mentor') {
    // Get all junior mentors assigned to this senior mentor
    const myJuniorMentors = allUsers.filter(u => 
      u.app_role === 'junior_mentor' && u.senior_mentor_id === id
    );
    const juniorMentorIds = myJuniorMentors.map(jm => jm.id);
    
    return students.filter(s => 
      s.primary_mentor_id === id || // Their own students
      s.senior_mentor_id === id || // Students assigned to them as senior mentor
      juniorMentorIds.includes(s.primary_mentor_id) // Their junior mentors' students
    );
  }
  
  return [];
};

// Apply masking to a student object based on role
export const applyStudentMasking = (student, userRole) => {
  if (!shouldMaskStudentData(userRole)) {
    return student;
  }
  
  return {
    ...student,
    email: maskEmail(student.email),
    phone: maskPhone(student.phone)
  };
};

// Generate next student code
export const generateStudentCode = async (base44) => {
  const students = await base44.entities.Student.list('-created_date', 1);
  
  if (students.length === 0) {
    return 'STU-0001';
  }
  
  const lastStudent = students[0];
  const lastCode = lastStudent.student_code || 'STU-0000';
  const lastNumber = parseInt(lastCode.split('-')[1] || '0');
  const nextNumber = lastNumber + 1;
  
  return `STU-${String(nextNumber).padStart(4, '0')}`;
};