import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ActionIcon, Button, Loader, Pagination, Select, TextInput } from '@mantine/core';
import { Filter, Search, SlidersHorizontal, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import {
  EmptyState,
  ErrorState,
  PageHeading,
  PatientTable,
  TableSkeleton,
} from '../components/Common';
import { AddPatientButton, useCreatePatient } from '../components/Layout';

const allowedSorts = ['name', 'age', 'last_visit', 'status'];
const allowedStatuses = ['active', 'follow_up', 'inactive'];

export function PatientsPage() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') || '');
  const openCreate = useCreatePatient();
  const rawPage = Number(params.get('page') || 1);
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const status = allowedStatuses.includes(params.get('status') || '')
    ? params.get('status') || ''
    : '';
  const sortBy = allowedSorts.includes(params.get('sort_by') || '')
    ? params.get('sort_by') || 'name'
    : 'name';
  const sortOrder = params.get('sort_order') === 'desc' ? 'desc' : 'asc';
  const pageSize = 12;
  const serverSearch = params.get('search') || '';
  const filtered = Boolean(search.trim() || serverSearch || status);
  const ranked = Boolean(serverSearch);
  function updateParams(updates: Record<string, string>, resetPage = true) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(updates)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        if (resetPage) next.delete('page');
        return next;
      },
      { replace: true },
    );
  }
  useEffect(() => {
    setSearch(serverSearch);
  }, [serverSearch]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setParams(
        (current) => {
          const value = search.trim();
          if ((current.get('search') || '') === value) return current;
          const next = new URLSearchParams(current);
          if (value) next.set('search', value);
          else next.delete('search');
          next.delete('page');
          return next;
        },
        { replace: true },
      );
    }, 350);
    return () => window.clearTimeout(timer);
  }, [search, setParams]);
  const query = useQuery({
    queryKey: ['patients', serverSearch, status, sortBy, sortOrder, page],
    queryFn: ({ signal }) =>
      api.patients(
        {
          page,
          page_size: pageSize,
          search: serverSearch,
          status,
          sort_by: sortBy,
          sort_order: sortOrder,
        },
        signal,
      ),
    placeholderData: keepPreviousData,
  });
  const data = query.data;
  const isDebouncing = search.trim() !== serverSearch;
  const resultsPending = isDebouncing || query.isPlaceholderData || query.isPending;
  const searching = resultsPending && Boolean(search.trim() || serverSearch);
  useEffect(() => {
    if (data && !resultsPending && page > Math.max(1, data.total_pages)) {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set('page', String(Math.max(1, data.total_pages)));
          return next;
        },
        { replace: true },
      );
    }
  }, [data, page, resultsPending, setParams]);
  function clearFilters() {
    setSearch('');
    updateParams({ search: '', status: '' });
  }
  return (
    <>
      <PageHeading
        eyebrow="PEOPLE, NOT JUST RECORDS"
        title="Your patients."
        action={<AddPatientButton />}
      >
        Every detail, every note. A clearer view of the people in your care.
      </PageHeading>
      <section className="panel directory-panel">
        <div className="directory-top">
          <div>
            <h2>
              Patient directory{' '}
              <span className="count-badge">
                {!resultsPending && !query.isError ? (data?.total ?? '—') : '—'}
              </span>
            </h2>
            <p>
              {filtered
                ? 'Find the people you’re looking for.'
                : 'A connected home for every patient record.'}
            </p>
          </div>
          <div className="directory-symbol" aria-hidden="true">
            <SlidersHorizontal size={20} />
          </div>
        </div>
        <div className="directory-toolbar">
          <TextInput
            aria-label="Search patients by ID, name, email, phone, or condition"
            aria-describedby="patient-search-help"
            placeholder="Search ID, name, email, phone…"
            maxLength={200}
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            leftSection={<Search size={17} />}
            rightSection={
              search ? (
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                >
                  <X size={14} />
                </ActionIcon>
              ) : null
            }
            className="patient-search"
          />
          <Select
            className="status-filter"
            aria-label="Filter patients by status"
            leftSection={<Filter size={15} />}
            data={[
              { value: '', label: 'All statuses' },
              { value: 'active', label: 'Active' },
              { value: 'follow_up', label: 'Needs follow-up' },
              { value: 'inactive', label: 'Inactive' },
            ]}
            value={status}
            onChange={(value) => updateParams({ status: value || '' })}
            allowDeselect={false}
          />
          {filtered && (
            <Button variant="subtle" color="gray" size="xs" onClick={clearFilters}>
              Clear filters
            </Button>
          )}
          <span className="directory-updating" role="status" aria-live="polite">
            {resultsPending || query.isFetching ? (
              <>
                <Loader size={12} color="teal" />
                <span>{searching ? 'Searching…' : 'Updating…'}</span>
              </>
            ) : (
              <>
                <span className="soft-dot" />
                Live records
              </>
            )}
          </span>
        </div>
        <div className="directory-search-help" id="patient-search-help">
          <p>Search by patient ID, name, email, phone, or condition.</p>
          {(search.trim() || serverSearch) && (
            <>
              <p>
                Exact ID matches appear first, followed by exact names or contacts, names starting
                with your search, other matches, then similar names. Column sorting breaks relevance
                ties.
              </p>
              <p>
                Possible match suggests a similar name. Check date of birth, ID, and contact details
                before opening.
              </p>
            </>
          )}
        </div>
        {resultsPending ? (
          searching ? (
            <div className="directory-searching" role="status" aria-live="polite">
              <Loader size={20} color="teal" />
              <p>Searching…</p>
            </div>
          ) : (
            <TableSkeleton rows={8} />
          )
        ) : query.isError ? (
          <div className="inset-error">
            <ErrorState error={query.error} retry={() => void query.refetch()} />
          </div>
        ) : data?.items.length ? (
          <div aria-busy={query.isFetching}>
            <PatientTable
              patients={data.items}
              sortBy={sortBy}
              sortOrder={sortOrder}
              ranked={ranked}
              onSort={(field) =>
                updateParams({
                  sort_by: field,
                  sort_order: sortBy === field && sortOrder === 'asc' ? 'desc' : 'asc',
                })
              }
            />
          </div>
        ) : (
          <EmptyState
            title={filtered ? 'No patients match your search' : 'Good care begins with a person'}
            action={
              <Button
                variant={filtered ? 'light' : 'filled'}
                onClick={filtered ? clearFilters : openCreate}
              >
                {filtered ? 'Clear filters' : 'Add your first patient'}
              </Button>
            }
          >
            {filtered
              ? 'Try a different ID, name, contact detail, condition, or status.'
              : 'Create your first patient record to get started.'}
          </EmptyState>
        )}
        {data && !resultsPending && !query.isError && data.total > 0 && (
          <div className="pagination-footer">
            <span>
              Showing{' '}
              <strong>
                {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, data.total)}
              </strong>{' '}
              of <strong>{data.total}</strong> patients
            </span>
            <Pagination
              total={Math.max(1, data.total_pages)}
              value={page}
              onChange={(next) => updateParams({ page: String(next) }, false)}
              size="sm"
              radius="md"
              disabled={query.isPlaceholderData}
              aria-label="Patient pages"
              siblings={1}
            />
          </div>
        )}
      </section>
      <div className="directory-hint">
        <span className="soft-dot" />
        Only fictional patient data is used in this demo.
      </div>
    </>
  );
}
