import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Skeleton } from '@mantine/core';
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Clock3,
  HeartPulse,
  Plus,
  UserCheck,
  UserRound,
  Users,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { formatDate } from '../format';
import {
  EmptyState,
  ErrorState,
  PageHeading,
  PatientTable,
  TableSkeleton,
} from '../components/Common';
import { AddPatientButton, useCreatePatient } from '../components/Layout';
import { PatientStatusChart } from '../components/PatientStatusChart';

export function DashboardPage() {
  const query = useQuery({
    queryKey: ['dashboard'],
    queryFn: ({ signal }) => api.dashboard(signal),
  });
  const openCreate = useCreatePatient();
  const data = query.data;
  const counts = [
    {
      label: 'Total patients',
      value: data?.total_patients,
      Icon: Users,
      description: 'People in your workspace',
      className: 'metric-total',
    },
    {
      label: 'Active patients',
      value: data?.active_patients,
      Icon: UserCheck,
      description: 'Currently receiving care',
      className: 'metric-active',
    },
    {
      label: 'Needs follow-up',
      value: data?.follow_up_patients,
      Icon: Clock3,
      description: 'A little attention goes a long way',
      className: 'metric-followup',
    },
    {
      label: 'Inactive patients',
      value: data?.inactive_patients,
      Icon: UserRound,
      description: 'Records available when needed',
      className: 'metric-inactive',
    },
  ];
  return (
    <>
      <PageHeading
        eyebrow="THE BIG PICTURE"
        title="Care starts with clarity."
        action={<AddPatientButton />}
      >
        A thoughtful overview of your patients, all in one place.
      </PageHeading>
      <div className="overview-date">
        <CalendarDays size={15} />
        <span>
          {formatDate(new Date().toISOString(), {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          })}
        </span>
        <span className="date-line" />
        <span className="workspace-live">
          <span />
          Workspace overview
        </span>
      </div>
      {query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : (
        <>
          <div className="metrics-grid">
            {counts.map(({ label, value, Icon, description, className }) => (
              <div key={label} className={`metric-card ${className}`}>
                <div className="metric-top">
                  <span>{label}</span>
                  <span className="metric-icon">
                    <Icon size={19} strokeWidth={1.7} />
                  </span>
                </div>
                {query.isPending ? (
                  <Skeleton width={70} height={43} my={10} />
                ) : (
                  <div className="metric-value">{value?.toLocaleString() ?? '—'}</div>
                )}
                <p>{description}</p>
                <div className="metric-decoration" aria-hidden="true" />
              </div>
            ))}
          </div>
          <div className="dashboard-grid">
            <section className="panel recent-panel">
              <div className="panel-heading">
                <div>
                  <div className="eyebrow">STAY CONNECTED</div>
                  <h2>Recent patient visits</h2>
                </div>
                <Button
                  component={Link}
                  to="/patients"
                  variant="subtle"
                  color="dark"
                  rightSection={<ArrowRight size={15} />}
                  size="xs"
                >
                  View all patients
                </Button>
              </div>
              {query.isPending ? (
                <TableSkeleton />
              ) : data?.recent_patients.length ? (
                <PatientTable patients={data.recent_patients} compact />
              ) : (
                <EmptyState
                  title="Your patient workspace starts here"
                  action={
                    <Button onClick={openCreate} leftSection={<Plus size={15} />}>
                      Add your first patient
                    </Button>
                  }
                >
                  Add a patient to begin organizing their details and care notes.
                </EmptyState>
              )}
              <div className="panel-footnote">
                <span className="soft-dot" />
                Ordered by most recent recorded visit.
              </div>
            </section>
            <aside className="dashboard-aside">
              <PatientStatusChart data={data} loading={query.isPending} />
              <section className="care-callout">
                <div className="care-callout-icon">
                  <HeartPulse size={24} strokeWidth={1.5} />
                </div>
                <Badge variant="outline" color="teal" size="xs">
                  A LITTLE MORE CONTEXT
                </Badge>
                <h2>
                  The whole patient.
                  <br />
                  Not just the record.
                </h2>
                <p>
                  Bring personal details, medical history, and care notes together in every patient
                  profile.
                </p>
                <Button
                  component={Link}
                  to="/patients"
                  variant="white"
                  color="teal"
                  rightSection={<ArrowUpRight size={16} />}
                >
                  Explore patients
                </Button>
                <ArrowDownRight
                  className="callout-decoration"
                  size={150}
                  strokeWidth={0.6}
                  aria-hidden="true"
                />
              </section>
            </aside>
          </div>
        </>
      )}
    </>
  );
}
