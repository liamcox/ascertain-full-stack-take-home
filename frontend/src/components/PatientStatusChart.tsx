import { useId } from 'react';
import { Skeleton } from '@mantine/core';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Dashboard } from '../api';
import './PatientStatusChart.css';

export function PatientStatusChart({ data, loading }: { data?: Dashboard; loading: boolean }) {
  const headingId = useId();
  const descriptionId = useId();
  const total = data?.total_patients ?? 0;
  const statuses = [
    { label: 'Active', status: 'active', count: data?.active_patients ?? 0 },
    { label: 'Needs follow-up', status: 'follow_up', count: data?.follow_up_patients ?? 0 },
    { label: 'Inactive', status: 'inactive', count: data?.inactive_patients ?? 0 },
  ].map((item) => ({
    ...item,
    percentage: total > 0 ? (item.count / total) * 100 : 0,
  }));
  let offset = 0;
  return (
    <section
      className="patient-status-chart"
      aria-labelledby={headingId}
      aria-describedby={descriptionId}
      aria-busy={loading}
    >
      <div className="patient-status-chart__eyebrow">YOUR PATIENT COMMUNITY</div>
      <h2 id={headingId} className="patient-status-chart__heading">
        Patient status
      </h2>
      <p id={descriptionId} className="patient-status-chart__description">
        Select a status to see those patients.
      </p>
      <div className="patient-status-chart__visual">
        <svg viewBox="0 0 160 160" aria-hidden="true" focusable="false">
          <circle className="patient-status-chart__track" cx="80" cy="80" r="62" />
          {!loading &&
            total > 0 &&
            statuses.map((item) => {
              const segmentOffset = offset;
              offset += item.percentage;
              return item.count > 0 ? (
                <circle
                  key={item.status}
                  className={`patient-status-chart__segment patient-status-chart__segment--${item.status}`}
                  cx="80"
                  cy="80"
                  r="62"
                  pathLength="100"
                  strokeDasharray={`${item.percentage} ${100 - item.percentage}`}
                  strokeDashoffset={-segmentOffset}
                  transform="rotate(-90 80 80)"
                />
              ) : null;
            })}
        </svg>
        <div className="patient-status-chart__total">
          {loading ? (
            <Skeleton width={52} height={35} aria-hidden="true" />
          ) : (
            <strong>{total.toLocaleString()}</strong>
          )}
          <span>Total patients</span>
        </div>
      </div>
      {loading ? (
        <div className="patient-status-chart__loading" role="status">
          <span className="sr-only">Loading patient status chart</span>
          {statuses.map((item) => (
            <Skeleton key={item.status} height={42} radius="sm" aria-hidden="true" />
          ))}
        </div>
      ) : (
        <>
          <ul className="patient-status-chart__legend">
            {statuses.map((item) => {
              const percentage = item.percentage.toLocaleString('en-US', {
                maximumFractionDigits: 1,
              });
              return (
                <li key={item.status}>
                  <Link
                    to={`/patients?status=${item.status}`}
                    aria-label={`${item.label}: ${item.count.toLocaleString()} patients, ${percentage}%. View patients.`}
                  >
                    <span
                      className={`patient-status-chart__dot patient-status-chart__dot--${item.status}`}
                      aria-hidden="true"
                    />
                    <span className="patient-status-chart__status">{item.label}</span>
                    <span className="patient-status-chart__values">
                      <strong>{item.count.toLocaleString()}</strong>
                      <span>{percentage}%</span>
                    </span>
                    <ChevronRight size={14} aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
          {total === 0 && (
            <p className="patient-status-chart__empty">
              Add a patient to see your workspace’s status breakdown.
            </p>
          )}
        </>
      )}
    </section>
  );
}
