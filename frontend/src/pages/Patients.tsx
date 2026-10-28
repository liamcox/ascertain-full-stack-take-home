import { useCallback, useEffect, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ActionIcon, Button, Loader, Pagination, Select, TextInput } from '@mantine/core';
import { Filter, Search, SlidersHorizontal, X } from 'lucide-react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { api, type PatientPage } from '../api';
import { statusLabels } from '../format';
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
const sortLabels: Record<string, string> = {
  name: 'Name',
  age: 'Age',
  last_visit: 'Last visit',
  status: 'Status',
};

interface DirectoryContext {
  search: string;
  status: string;
  sortBy: string;
  sortOrder: string;
  page: number;
}

interface DirectoryResults {
  records: PatientPage;
  context: DirectoryContext;
}

function resultsLabel(context: DirectoryContext) {
  if (context.search) return `Results for “${context.search}”`;
  return context.status ? 'Showing filtered patients' : 'Showing all patients';
}

export function PatientsPage() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const [search, setSearch] = useState(params.get('search') || '');
  const [lastCompleted, setLastCompleted] = useState<DirectoryResults>();
  const searchTimer = useRef<number | null>(null);
  const composing = useRef(false);
  const pendingControlUpdates = useRef<Record<string, string> | null>(null);
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
  const hasDraft = search.trim() !== serverSearch;
  const hasFilters = Boolean(search.trim() || serverSearch || status);
  const cancelPendingSearch = useCallback(() => {
    if (searchTimer.current !== null) {
      window.clearTimeout(searchTimer.current);
      searchTimer.current = null;
    }
  }, []);
  function updateParams(updates: Record<string, string>, resetPage = true) {
    const hasExplicitSearch = Object.prototype.hasOwnProperty.call(updates, 'search');
    if (composing.current && !hasExplicitSearch) {
      // Preserve filter/sort intent until the IME has produced its final text.
      pendingControlUpdates.current = { ...pendingControlUpdates.current, ...updates };
      return;
    }
    cancelPendingSearch();
    const commitDraft = !hasExplicitSearch && hasDraft;
    const nextUpdates = commitDraft ? { ...updates, search: search.trim() } : updates;
    if (commitDraft) setSearch(search.trim());
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(nextUpdates)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        if (resetPage || commitDraft) next.delete('page');
        return next;
      },
      { replace: true },
    );
  }
  function commitSearch(value: string) {
    cancelPendingSearch();
    composing.current = false;
    pendingControlUpdates.current = null;
    const trimmed = value.trim();
    setSearch(trimmed);
    if (trimmed === serverSearch) return;
    updateParams({ search: trimmed });
  }
  function scheduleSearch(value: string) {
    cancelPendingSearch();
    if (composing.current || value.trim() === serverSearch) return;
    searchTimer.current = window.setTimeout(() => commitSearch(value), 750);
  }
  useEffect(() => {
    // URL navigation owns the committed query and cancels any obsolete draft timer.
    cancelPendingSearch();
    composing.current = false;
    pendingControlUpdates.current = null;
    setSearch(serverSearch);
    return cancelPendingSearch;
  }, [location.key, serverSearch, cancelPendingSearch]);
  const query = useQuery({
    queryKey: ['patients', serverSearch, status, sortBy, sortOrder, page],
    queryFn: async ({ signal }): Promise<DirectoryResults> => ({
      records: await api.patients(
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
      context: { search: serverSearch, status, sortBy, sortOrder, page },
    }),
    placeholderData: keepPreviousData,
  });
  useEffect(() => {
    if (query.data && !query.isPlaceholderData) setLastCompleted(query.data);
  }, [query.data, query.isPlaceholderData]);
  // Keep records and their original request context together, including after a failed update.
  const displayed = query.data ?? lastCompleted;
  const data = displayed?.records;
  const displayedContext = displayed?.context;
  const filtered = Boolean(displayedContext?.search || displayedContext?.status);
  const controlsDisabled = query.isFetching || query.isPlaceholderData || query.isError;
  useEffect(() => {
    const completed = query.data?.records;
    if (
      completed &&
      !query.isPlaceholderData &&
      !query.isFetching &&
      !query.isError &&
      search.trim() === serverSearch &&
      page > Math.max(1, completed.total_pages)
    ) {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set('page', String(Math.max(1, completed.total_pages)));
          return next;
        },
        { replace: true },
      );
    }
  }, [
    query.data,
    query.isPlaceholderData,
    query.isFetching,
    query.isError,
    page,
    search,
    serverSearch,
    setParams,
  ]);
  function clearFilters() {
    cancelPendingSearch();
    composing.current = false;
    pendingControlUpdates.current = null;
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
              Patient directory <span className="count-badge">{data?.total ?? '—'}</span>
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
            onChange={(event) => {
              const value = event.currentTarget.value;
              setSearch(value);
              scheduleSearch(value);
            }}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                !composing.current &&
                !event.nativeEvent.isComposing &&
                event.nativeEvent.keyCode !== 229
              ) {
                event.preventDefault();
                commitSearch(event.currentTarget.value);
              }
            }}
            onCompositionStart={() => {
              composing.current = true;
              cancelPendingSearch();
            }}
            onCompositionEnd={(event) => {
              composing.current = false;
              const value = event.currentTarget.value;
              setSearch(value);
              const pendingUpdates = pendingControlUpdates.current;
              pendingControlUpdates.current = null;
              if (pendingUpdates) updateParams({ ...pendingUpdates, search: value.trim() });
              else scheduleSearch(value);
            }}
            leftSection={<Search size={17} />}
            rightSection={
              search ? (
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  onClick={() => commitSearch('')}
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
          <Button
            variant="subtle"
            color="gray"
            size="xs"
            onClick={clearFilters}
            disabled={!hasFilters}
          >
            Clear filters
          </Button>
        </div>
        <div className="directory-search-help" id="patient-search-help">
          <p>Search ID, name, email, phone, or condition. Press Enter to search immediately.</p>
          <details>
            <summary>How matches are ordered</summary>
            <p>
              Exact IDs appear first, then exact names or contacts, names starting with your search,
              other matches, and similar names. Column sorting breaks relevance ties. Check date of
              birth, ID, and contact details before opening a possible match.
            </p>
          </details>
        </div>
        <div className="directory-results-heading">
          <div className="directory-results-context">
            <p
              className="directory-results-label"
              title={displayedContext ? resultsLabel(displayedContext) : undefined}
            >
              {displayedContext ? resultsLabel(displayedContext) : 'Loading patients…'}
            </p>
            <p className="directory-results-meta">
              {displayedContext ? (
                <>
                  {displayedContext.status
                    ? statusLabels[displayedContext.status as keyof typeof statusLabels]
                    : 'All statuses'}
                  {' · '}
                  {displayedContext.search ? 'Tie sort: ' : 'Sort: '}
                  {sortLabels[displayedContext.sortBy]},{' '}
                  {displayedContext.sortOrder === 'asc' ? 'ascending' : 'descending'}
                  {' · '}Page {data?.page}
                </>
              ) : (
                '\u00a0'
              )}
            </p>
          </div>
          <span className="directory-updating" role="status" aria-live="polite">
            {query.isFetching && (
              <>
                <Loader size={12} color="teal" />
                <span>Updating results…</span>
              </>
            )}
          </span>
        </div>
        {query.isError && (
          <div className="inset-error">
            <ErrorState
              title={
                serverSearch
                  ? `Couldn’t load results for “${serverSearch}”`
                  : 'Couldn’t update patient results'
              }
              error={query.error}
              retry={() => void query.refetch()}
            />
            {data && <p>The previous results remain below with their original search details.</p>}
          </div>
        )}
        <div className="directory-results" aria-busy={query.isFetching}>
          {!data ? (
            query.isError ? null : (
              <TableSkeleton rows={8} />
            )
          ) : data.items.length ? (
            <PatientTable
              patients={data.items}
              sortBy={displayedContext?.sortBy}
              sortOrder={displayedContext?.sortOrder}
              ranked={Boolean(displayedContext?.search)}
              sortDisabled={controlsDisabled}
              onSort={(field) =>
                updateParams({
                  sort_by: field,
                  sort_order:
                    displayedContext?.sortBy === field && displayedContext.sortOrder === 'asc'
                      ? 'desc'
                      : 'asc',
                })
              }
            />
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
        </div>
        {data && data.total > 0 && (
          <div className="pagination-footer">
            <span>
              Showing{' '}
              <strong>
                {(data.page - 1) * data.page_size + 1}–
                {Math.min(data.page * data.page_size, data.total)}
              </strong>{' '}
              of <strong>{data.total}</strong> patients
            </span>
            <Pagination
              total={Math.max(1, data.total_pages)}
              value={data.page}
              onChange={(next) => updateParams({ page: String(next) }, false)}
              size="sm"
              radius="md"
              disabled={controlsDisabled || hasDraft || composing.current}
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
