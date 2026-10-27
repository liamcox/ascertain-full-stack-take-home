import { ActionIcon, Alert, Avatar, Badge, Button, Skeleton } from '@mantine/core';
import {
  AlertCircle,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  RefreshCw,
  Users,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { Patient, PatientStatus } from '../api';
import {
  formatDate,
  fullName,
  initials,
  patientColor,
  statusColors,
  statusLabels,
} from '../format';

export function PatientAvatar({ patient, size = 38 }: { patient: Patient; size?: number }) {
  return (
    <Avatar
      size={size}
      radius="xl"
      color="dark"
      style={{ background: patientColor(patient), color: '#405254', flexShrink: 0 }}
    >
      {initials(patient)}
    </Avatar>
  );
}

export function StatusBadge({ status }: { status: PatientStatus }) {
  return (
    <Badge
      className={`status-badge status-${status}`}
      variant="light"
      color={statusColors[status]}
      radius="sm"
    >
      <span className="status-dot" />
      {statusLabels[status]}
    </Badge>
  );
}

export function ErrorState({
  error,
  retry,
  title = 'Something needs another try',
}: {
  error?: Error | null;
  retry?: () => void;
  title?: string;
}) {
  return (
    <Alert
      color="red"
      variant="light"
      icon={<AlertCircle size={19} />}
      title={title}
      className="error-state"
    >
      <p>{error?.message || 'We couldn’t load this information. Please try again.'}</p>
      {retry && (
        <Button
          color="red"
          variant="light"
          size="xs"
          mt="sm"
          leftSection={<RefreshCw size={14} />}
          onClick={retry}
        >
          Try again
        </Button>
      )}
    </Alert>
  );
}

export function EmptyState({
  title,
  children,
  action,
  icon = <Users size={25} />,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}

export function PageHeading({
  eyebrow,
  title,
  children,
  action,
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {children && <p>{children}</p>}
      </div>
      {action && <div className="page-action">{action}</div>}
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-label="Loading patients" role="status" className="table-skeleton">
      {Array.from({ length: rows }).map((_, i) => (
        <div className="skeleton-row" key={i}>
          <Skeleton height={38} width={38} radius="xl" />
          <div>
            <Skeleton height={12} width={150} mb={9} />
            <Skeleton height={9} width={90} />
          </div>
          <Skeleton height={12} width={70} className="skeleton-extra" />
          <Skeleton height={24} width={94} className="skeleton-extra" />
          <Skeleton height={12} width={100} className="skeleton-extra" />
        </div>
      ))}
    </div>
  );
}

export function PatientTable({
  patients,
  sortBy,
  sortOrder,
  onSort,
  compact = false,
}: {
  patients: Patient[];
  sortBy?: string;
  sortOrder?: string;
  onSort?: (field: string) => void;
  compact?: boolean;
}) {
  function heading(label: string, field: string) {
    if (!onSort) return label;
    const Icon =
      sortBy === field ? (sortOrder === 'asc' ? ChevronUp : ChevronDown) : ChevronsUpDown;
    return (
      <button
        type="button"
        onClick={() => onSort(field)}
        className={`sort-heading ${sortBy === field ? 'is-sorted' : ''}`}
      >
        {label}
        <Icon size={13} />
      </button>
    );
  }
  return (
    <div className="table-scroll">
      <table className="patient-table">
        <thead>
          <tr>
            <th
              aria-sort={
                sortBy === 'name' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : undefined
              }
            >
              {heading('Patient', 'name')}
            </th>
            {!compact && (
              <th
                aria-sort={
                  sortBy === 'age' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : undefined
                }
              >
                {heading('Age', 'age')}
              </th>
            )}
            <th
              aria-sort={
                sortBy === 'status' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : undefined
              }
            >
              {heading('Status', 'status')}
            </th>
            <th
              aria-sort={
                sortBy === 'last_visit'
                  ? sortOrder === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : undefined
              }
            >
              {heading('Last visit', 'last_visit')}
            </th>
            {!compact && <th>Contact</th>}
            <th>
              <span className="sr-only">View patient</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {patients.map((patient) => (
            <tr key={patient.id}>
              <td>
                <Link to={`/patients/${patient.id}`} className="patient-link">
                  <PatientAvatar patient={patient} />
                  <span>
                    <strong>{fullName(patient)}</strong>
                    <small>
                      {compact
                        ? `${patient.age} years old`
                        : `ID ${patient.id.slice(0, 8).toUpperCase()}`}
                    </small>
                  </span>
                </Link>
              </td>
              {!compact && (
                <td className="age-cell">
                  {patient.age}
                  <span> yrs</span>
                </td>
              )}
              <td>
                <StatusBadge status={patient.status} />
              </td>
              <td className="date-cell">{formatDate(patient.last_visit)}</td>
              {!compact && (
                <td className="contact-cell">
                  {patient.email ? (
                    <a href={`mailto:${patient.email}`}>{patient.email}</a>
                  ) : (
                    <span className="muted">—</span>
                  )}
                  <small>{patient.phone || 'No phone recorded'}</small>
                </td>
              )}
              <td className="row-action">
                <ActionIcon
                  component={Link}
                  to={`/patients/${patient.id}`}
                  variant="subtle"
                  color="gray"
                  aria-label={`View ${fullName(patient)}`}
                >
                  <ArrowRight size={17} />
                </ActionIcon>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
