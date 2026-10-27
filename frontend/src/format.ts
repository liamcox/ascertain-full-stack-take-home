import type { Patient } from './api';

export const statusLabels = {
  active: 'Active',
  follow_up: 'Needs follow-up',
  inactive: 'Inactive',
};
export const statusColors = { active: 'teal', follow_up: 'orange', inactive: 'gray' };
export const fullName = (patient: Pick<Patient, 'first_name' | 'last_name'>) =>
  `${patient.first_name} ${patient.last_name}`;
export const initials = (patient: Pick<Patient, 'first_name' | 'last_name'>) =>
  `${patient.first_name.charAt(0)}${patient.last_name.charAt(0)}`.toUpperCase();

export function formatDate(
  value: string | null | undefined,
  options?: Intl.DateTimeFormatOptions,
): string {
  if (!value) return 'Not recorded';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not recorded';
  return date.toLocaleDateString(
    'en-US',
    options || { month: 'short', day: 'numeric', year: 'numeric' },
  );
}

export function todayISO() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function patientColor(patient: Patient): string {
  const colors = ['#e4eaf3', '#e5eee5', '#f2e9df', '#e7e4f0', '#e0eeec'];
  return colors[patient.id.charCodeAt(0) % colors.length];
}
