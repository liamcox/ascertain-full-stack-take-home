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
import { useId } from 'react';
import type { ReactNode } from 'react';
import type { Patient, PatientSearchResult, PatientStatus } from '../api';
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
  ranked = false,
}: {
  patients: (Patient | PatientSearchResult)[];
  sortBy?: string;
  sortOrder?: string;
  onSort?: (field: string) => void;
  compact?: boolean;
  ranked?: boolean;
}) {
  const scrollHintId = useId();
  function heading(label: string, field: string) {
    if (!onSort) return label;
    const Icon =
      sortBy === field ? (sortOrder === 'asc' ? ChevronUp : ChevronDown) : ChevronsUpDown;
    return (
      <button
        type="button"
        onClick={() => onSort(field)}
        className={`sort-heading ${sortBy === field ? 'is-sorted' : ''}`}
        title={ranked ? `Use ${label.toLowerCase()} to break relevance ties` : undefined}
      >
        {label}
        <Icon size={13} />
      </button>
    );
  }
  return (
    <>
      <p className="table-scroll-hint" id={scrollHintId}>
        Scroll horizontally or use the arrow keys to see all columns.
      </p>
      <div
        className="table-scroll"
        role="region"
        aria-label={compact ? 'Recent patient visits' : 'Patient directory'}
        aria-describedby={scrollHintId}
        tabIndex={0}
      >
        <table className="patient-table">
          {ranked && (
            <caption className="sr-only">
              Patients ordered by match type, then name similarity for possible matches. Column
              sorting breaks relevance ties.
            </caption>
          )}
          <thead>
            <tr>
              <th
                aria-sort={
                  sortBy === 'name'
                    ? ranked
                      ? 'other'
                      : sortOrder === 'asc'
                        ? 'ascending'
                        : 'descending'
                    : undefined
                }
              >
                {heading('Patient', 'name')}
              </th>
              {!compact && (
                <th
                  aria-sort={
                    sortBy === 'age'
                      ? ranked
                        ? 'other'
                        : sortOrder === 'asc'
                          ? 'ascending'
                          : 'descending'
                      : undefined
                  }
                >
                  {heading('Age', 'age')}
                </th>
              )}
              <th
                aria-sort={
                  sortBy === 'status'
                    ? ranked
                      ? 'other'
                      : sortOrder === 'asc'
                        ? 'ascending'
                        : 'descending'
                    : undefined
                }
              >
                {heading('Status', 'status')}
              </th>
              <th
                aria-sort={
                  sortBy === 'last_visit'
                    ? ranked
                      ? 'other'
                      : sortOrder === 'asc'
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
                      {compact ? (
                        <small>{patient.age} years old</small>
                      ) : (
                        <>
                          <small>DOB {formatDate(patient.dob)}</small>
                          <small title={`Patient ID ${patient.id}`}>
                            <span aria-hidden="true">
                              ID {patient.id.slice(0, 8).toUpperCase()}
                            </span>
                            <span className="sr-only">Patient ID {patient.id}</span>
                          </small>
                        </>
                      )}
                    </span>
                  </Link>
                  {!compact && ranked && 'search_match' in patient && patient.search_match && (
                    <span className={`search-match search-match-${patient.search_match.kind}`}>
                      {patient.search_match.kind === 'fuzzy'
                        ? 'Possible match'
                        : patient.search_match.label}
                    </span>
                  )}
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
                    aria-label={
                      compact
                        ? `View ${fullName(patient)}`
                        : `View ${fullName(patient)}, born ${formatDate(patient.dob)}, patient ID ${patient.id}`
                    }
                  >
                    <ArrowRight size={17} />
                  </ActionIcon>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
