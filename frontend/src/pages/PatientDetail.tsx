import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Menu,
  Modal,
  Skeleton,
  Textarea,
  TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  ClipboardList,
  Clock3,
  FileText,
  HeartPulse,
  Mail,
  MapPin,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Stethoscope,
  Trash2,
  UserRound,
} from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import type { Patient, PatientNote } from '../api';
import { formatDate, fullName } from '../format';
import { EmptyState, ErrorState, PatientAvatar, StatusBadge } from '../components/Common';
import { PatientForm } from '../components/PatientForm';
import { NotFoundPage } from './NotFound';

function localDateTime() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function DetailSkeleton() {
  return (
    <div aria-label="Loading patient record" role="status">
      <Skeleton width={130} height={15} mb={35} />
      <div className="detail-header">
        <Skeleton height={76} width={76} radius="xl" />
        <div>
          <Skeleton width={250} height={35} mb={12} />
          <Skeleton width={160} height={14} />
        </div>
      </div>
      <div className="detail-grid">
        <div>
          <Skeleton height={260} radius="md" mb={24} />
          <Skeleton height={360} radius="md" />
        </div>
        <div>
          <Skeleton height={270} radius="md" mb={24} />
          <Skeleton height={220} radius="md" />
        </div>
      </div>
    </div>
  );
}

function ProfileInfo({ patient }: { patient: Patient }) {
  const details = [
    {
      label: 'Date of birth',
      value: `${formatDate(patient.dob)} · ${patient.age} years`,
      Icon: CalendarDays,
    },
    {
      label: 'Email address',
      value: patient.email ? (
        <a href={`mailto:${patient.email}`}>{patient.email}</a>
      ) : (
        'Not recorded'
      ),
      Icon: Mail,
    },
    {
      label: 'Phone number',
      value: patient.phone ? <a href={`tel:${patient.phone}`}>{patient.phone}</a> : 'Not recorded',
      Icon: Phone,
    },
    { label: 'Address', value: patient.address || 'Not recorded', Icon: MapPin },
  ];
  return (
    <section className="panel profile-info">
      <div className="panel-heading compact">
        <h2>
          <UserRound size={18} />
          Personal information
        </h2>
      </div>
      <dl className="info-grid">
        {details.map(({ label, value, Icon }) => (
          <div key={label}>
            <dt>
              <Icon size={15} />
              {label}
            </dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function PatientDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [noteToDelete, setNoteToDelete] = useState<PatientNote | null>(null);
  const [noteText, setNoteText] = useState('');
  const [noteTimestamp, setNoteTimestamp] = useState(localDateTime);
  const [noteValidation, setNoteValidation] = useState('');
  const query = useQuery({
    queryKey: ['patient', id],
    queryFn: ({ signal }) => api.patient(id, signal),
  });
  const notes = useQuery({
    queryKey: ['notes', id],
    queryFn: ({ signal }) => api.notes(id, signal),
    enabled: Boolean(query.data),
  });
  const summary = useMutation({ mutationFn: () => api.summary(id) });
  const resetSummary = summary.reset;
  useEffect(() => {
    resetSummary();
    setNoteText('');
    setNoteTimestamp(localDateTime());
  }, [id, resetSummary]);
  const addNote = useMutation({
    mutationFn: () => api.addNote(id, noteText.trim(), new Date(noteTimestamp).toISOString()),
    onSuccess: () => {
      setNoteText('');
      setNoteTimestamp(localDateTime());
      setNoteValidation('');
      void queryClient.invalidateQueries({ queryKey: ['notes', id] });
      void queryClient.invalidateQueries({ queryKey: ['patient', id] });
      resetSummary();
      notifications.show({
        title: 'Note saved',
        message: 'The note has been added to this patient’s record.',
        color: 'teal',
        icon: <Check size={16} />,
      });
    },
  });
  const deleteNote = useMutation({
    mutationFn: (noteId: string) => api.deleteNote(id, noteId),
    onSuccess: () => {
      setNoteToDelete(null);
      void queryClient.invalidateQueries({ queryKey: ['notes', id] });
      void queryClient.invalidateQueries({ queryKey: ['patient', id] });
      resetSummary();
      notifications.show({
        title: 'Note deleted',
        message: 'The note has been removed from this record.',
        color: 'teal',
      });
    },
  });
  const deletePatient = useMutation({
    mutationFn: () => api.deletePatient(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['patients'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.removeQueries({ queryKey: ['patient', id] });
      queryClient.removeQueries({ queryKey: ['notes', id] });
      notifications.show({
        title: 'Patient deleted',
        message: 'The patient and their notes have been removed.',
        color: 'teal',
      });
      navigate('/patients');
    },
  });
  function submitNote(event: React.FormEvent) {
    event.preventDefault();
    if (!noteText.trim()) {
      setNoteValidation('Write a note before saving.');
      return;
    }
    const timestamp = new Date(noteTimestamp);
    if (!noteTimestamp || Number.isNaN(timestamp.getTime()) || timestamp.getTime() > Date.now()) {
      setNoteValidation('Choose a valid date and time that is not in the future.');
      return;
    }
    setNoteValidation('');
    addNote.mutate();
  }
  if (query.isPending) return <DetailSkeleton />;
  if (query.isError) {
    if (
      query.error instanceof ApiError &&
      (query.error.status === 404 || query.error.status === 422)
    )
      return <NotFoundPage patient />;
    return (
      <>
        <Link className="back-link" to="/patients">
          <ArrowLeft size={15} />
          Back to patients
        </Link>
        <ErrorState
          title="We couldn’t open this patient record"
          error={query.error}
          retry={() => void query.refetch()}
        />
      </>
    );
  }
  const patient = query.data;
  const sortedNotes = [...(notes.data || [])].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
  return (
    <>
      <Link className="back-link" to="/patients">
        <ArrowLeft size={15} />
        Back to patients
      </Link>
      <div className="detail-header">
        <PatientAvatar patient={patient} size={76} />
        <div className="detail-title">
          <div className="eyebrow">
            PATIENT RECORD <span>#{patient.id.slice(0, 8).toUpperCase()}</span>
          </div>
          <h1>{fullName(patient)}</h1>
          <div className="detail-meta">
            <StatusBadge status={patient.status} />
            <span>{patient.age} years old</span>
            <span className="meta-dot">·</span>
            <span>
              Patient since {formatDate(patient.created_at, { month: 'short', year: 'numeric' })}
            </span>
          </div>
        </div>
        <div className="detail-actions">
          <Button
            variant="default"
            leftSection={<Pencil size={15} />}
            onClick={() => setEditOpen(true)}
          >
            Edit patient
          </Button>
          <Menu position="bottom-end" width={200} shadow="md">
            <Menu.Target>
              <ActionIcon size={36} variant="default" aria-label="Patient actions">
                <MoreHorizontal size={19} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>Patient record</Menu.Label>
              <Menu.Item
                color="red"
                leftSection={<Trash2 size={15} />}
                onClick={() => {
                  deletePatient.reset();
                  setDeleteOpen(true);
                }}
              >
                Delete patient
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </div>
      </div>
      <div className="detail-grid">
        <div className="detail-main">
          <ProfileInfo patient={patient} />
          <section className="panel notes-panel">
            <div className="panel-heading compact">
              <div>
                <h2>
                  <ClipboardList size={18} />
                  Care notes <span className="count-badge">{notes.data?.length ?? '—'}</span>
                </h2>
                <p>Context that carries care forward.</p>
              </div>
            </div>
            <form className="note-composer" onSubmit={submitNote}>
              <Textarea
                label="Add a note"
                placeholder="Record a visit, observation, or next step…"
                value={noteText}
                onChange={(event) => {
                  setNoteText(event.currentTarget.value);
                  setNoteValidation('');
                }}
                maxLength={10000}
                minRows={3}
                autosize
                error={noteValidation || undefined}
                disabled={addNote.isPending}
              />
              <div className="note-composer-footer">
                <TextInput
                  aria-label="Note date and time"
                  type="datetime-local"
                  value={noteTimestamp}
                  max={localDateTime()}
                  onChange={(event) => setNoteTimestamp(event.currentTarget.value)}
                  leftSection={<CalendarDays size={14} />}
                  disabled={addNote.isPending}
                  className="note-date"
                />
                <span className="note-character-count">
                  {noteText.length.toLocaleString()}/10,000
                </span>
                <Button
                  type="submit"
                  size="sm"
                  loading={addNote.isPending}
                  leftSection={<Plus size={15} />}
                >
                  Save note
                </Button>
              </div>
              {addNote.isError && (
                <Alert color="red" mt="sm" icon={<AlertCircle size={16} />}>
                  {addNote.error.message}
                </Alert>
              )}
            </form>
            <div className="notes-list">
              {notes.isPending ? (
                <div className="notes-loading">
                  <Skeleton height={14} width={130} mb={14} />
                  <Skeleton height={65} mb={25} />
                  <Skeleton height={14} width={130} mb={14} />
                  <Skeleton height={65} />
                </div>
              ) : notes.isError ? (
                <ErrorState
                  title="Notes couldn’t be loaded"
                  error={notes.error}
                  retry={() => void notes.refetch()}
                />
              ) : sortedNotes.length === 0 ? (
                <EmptyState title="Every story starts somewhere" icon={<FileText size={25} />}>
                  Add the first note to start building this patient’s care history.
                </EmptyState>
              ) : (
                sortedNotes.map((note) => (
                  <article className="note-item" key={note.id}>
                    <span className="timeline-dot" />
                    <div className="note-top">
                      <div>
                        <time dateTime={note.timestamp}>{formatDate(note.timestamp)}</time>
                        <span className="note-time">
                          {new Date(note.timestamp).toLocaleTimeString('en-US', {
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        size="sm"
                        aria-label={`Delete note from ${formatDate(note.timestamp)}`}
                        onClick={() => {
                          deleteNote.reset();
                          setNoteToDelete(note);
                        }}
                      >
                        <Trash2 size={14} />
                      </ActionIcon>
                    </div>
                    <p>{note.content}</p>
                    <span className="note-author">Care team</span>
                  </article>
                ))
              )}
            </div>
          </section>
        </div>
        <aside className="detail-aside">
          <section className="panel medical-panel">
            <div className="panel-heading compact">
              <h2>
                <HeartPulse size={18} />
                Medical profile
              </h2>
            </div>
            <div className="medical-stats">
              <div>
                <span>Blood type</span>
                <strong>{patient.blood_type || '—'}</strong>
              </div>
              <div>
                <span>Last visit</span>
                <strong className="last-visit-value">
                  {formatDate(patient.last_visit, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </strong>
              </div>
            </div>
            <div className="medical-group">
              <h3>
                <Stethoscope size={14} />
                Conditions
              </h3>
              {patient.conditions?.length ? (
                <div className="medical-tags">
                  {patient.conditions.map((condition) => (
                    <Badge key={condition} color="gray" variant="light" radius="sm">
                      {condition}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="medical-empty">No conditions recorded</p>
              )}
            </div>
            <div className="medical-group allergies-group">
              <h3>
                <AlertCircle size={14} />
                Allergies
              </h3>
              {patient.allergies?.length ? (
                <div className="medical-tags">
                  {patient.allergies.map((allergy) => (
                    <Badge key={allergy} color="orange" variant="light" radius="sm">
                      {allergy}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="medical-empty">No allergies recorded</p>
              )}
            </div>
          </section>
          <section className="summary-panel">
            <div className="summary-header">
              <div className="summary-icon">
                <FileText size={19} />
              </div>
              <span className="eyebrow">TEMPLATE SUMMARY</span>
            </div>
            <h2>The story so far.</h2>
            <p className="summary-description">
              A clear snapshot of this patient’s profile and care notes.
            </p>
            {summary.isSuccess && (
              <div className="generated-summary">
                <div className="summary-output">{summary.data.summary}</div>
                <div className="summary-timestamp">
                  <Clock3 size={12} />
                  Generated{' '}
                  {new Date(summary.data.generated_at).toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </div>
              </div>
            )}
            {summary.isError && (
              <Alert color="red" mb="md" icon={<AlertCircle size={16} />}>
                {summary.error.message}
              </Alert>
            )}
            <Button
              fullWidth
              variant={summary.isSuccess ? 'light' : 'filled'}
              loading={summary.isPending}
              onClick={() => summary.mutate()}
              leftSection={summary.isSuccess ? <RefreshCw size={15} /> : <FileText size={15} />}
              rightSection={!summary.isSuccess && <ArrowRight size={15} />}
            >
              {summary.isSuccess ? 'Regenerate summary' : 'Generate summary'}
            </Button>
            <p className="summary-disclaimer">Built from saved details. No information is added.</p>
          </section>
          <div className="record-updated">
            <Clock3 size={13} />
            Record updated {formatDate(patient.updated_at)}
          </div>
        </aside>
      </div>
      <PatientForm
        opened={editOpen}
        onClose={() => setEditOpen(false)}
        patient={patient}
        onSaved={() => resetSummary()}
      />
      <Modal
        opened={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete patient?"
        centered
        radius="lg"
        closeOnClickOutside={!deletePatient.isPending}
        closeOnEscape={!deletePatient.isPending}
      >
        <div className="delete-modal-icon">
          <Trash2 size={24} />
        </div>
        <p className="confirm-description">
          This will permanently delete <strong>{fullName(patient)}</strong> and all of their care
          notes. This action cannot be undone.
        </p>
        {deletePatient.isError && (
          <Alert color="red" mt="md">
            {deletePatient.error.message}
          </Alert>
        )}
        <div className="modal-footer">
          <Button
            variant="default"
            onClick={() => setDeleteOpen(false)}
            disabled={deletePatient.isPending}
          >
            Keep patient
          </Button>
          <Button
            color="red"
            onClick={() => deletePatient.mutate()}
            loading={deletePatient.isPending}
          >
            Delete patient
          </Button>
        </div>
      </Modal>
      <Modal
        opened={Boolean(noteToDelete)}
        onClose={() => setNoteToDelete(null)}
        title="Delete this note?"
        centered
        radius="lg"
        closeOnClickOutside={!deleteNote.isPending}
        closeOnEscape={!deleteNote.isPending}
      >
        <p className="confirm-description">
          The note from <strong>{formatDate(noteToDelete?.timestamp)}</strong> will be permanently
          removed from this patient’s record.
        </p>
        {noteToDelete && (
          <blockquote className="note-preview">
            {noteToDelete.content.slice(0, 200)}
            {noteToDelete.content.length > 200 ? '…' : ''}
          </blockquote>
        )}
        {deleteNote.isError && (
          <Alert color="red" mt="md">
            {deleteNote.error.message}
          </Alert>
        )}
        <div className="modal-footer">
          <Button
            variant="default"
            onClick={() => setNoteToDelete(null)}
            disabled={deleteNote.isPending}
          >
            Keep note
          </Button>
          <Button
            color="red"
            onClick={() => noteToDelete && deleteNote.mutate(noteToDelete.id)}
            loading={deleteNote.isPending}
          >
            Delete note
          </Button>
        </div>
      </Modal>
    </>
  );
}
