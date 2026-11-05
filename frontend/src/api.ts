export type PatientStatus = 'active' | 'follow_up' | 'inactive';

export interface Patient {
  id: string;
  first_name: string;
  last_name: string;
  dob: string;
  age: number;
  status: PatientStatus;
  email: string | null;
  phone: string | null;
  address: string | null;
  blood_type: string | null;
  last_visit: string | null;
  allergies: string[];
  conditions: string[];
  created_at: string;
  updated_at: string;
}

export type PatientInput = Omit<Patient, 'id' | 'age' | 'created_at' | 'updated_at'>;
export interface PatientSearchMatch {
  kind: 'exact_id' | 'exact_name' | 'exact_contact' | 'name_prefix' | 'substring' | 'fuzzy';
  label: string;
  score: number;
}
export interface PatientSearchResult extends Patient {
  search_match: PatientSearchMatch | null;
}
export interface PatientNote {
  id: string;
  patient_id: string;
  encounter_id: number | null;
  timestamp: string;
  content: string;
}
export interface PatientEncounter {
  id: number;
  patient_id: string;
  doctor_name: string;
  reason: string;
  timestamp: string;
}
export type EncounterInput = Omit<PatientEncounter, 'id' | 'patient_id'>;
export interface PatientSummary {
  patient_id: string;
  summary: string;
  generated_at: string;
}
export interface PatientPage {
  items: PatientSearchResult[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}
export interface Dashboard {
  total_patients: number;
  active_patients: number;
  follow_up_patients: number;
  inactive_patients: number;
  recent_patients: Patient[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(
      'We couldn’t connect to the server. Please check your connection and try again. A sleeping demo server may take a moment to start.',
      0,
    );
  }
  if (!response.ok) {
    let message = `The request could not be completed (${response.status}). Please try again.`;
    try {
      const body = await response.json();
      if (typeof body.detail === 'string') message = body.detail;
      else if (Array.isArray(body.detail))
        message = body.detail
          .map(
            (issue: { loc?: string[]; msg?: string }) =>
              `${issue.loc?.filter((field) => field !== 'body').join(' ') || 'Field'}: ${issue.msg || 'Invalid value'}`,
          )
          .join('. ');
    } catch {
      /* A proxy error may not contain JSON. */
    }
    throw new ApiError(message, response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  dashboard: (signal?: AbortSignal) => request<Dashboard>('/dashboard', { signal }),
  patients: (params: Record<string, string | number>, signal?: AbortSignal) =>
    request<PatientPage>(
      `/patients?${new URLSearchParams(Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)])))}`,
      { signal },
    ),
  patient: (id: string, signal?: AbortSignal) => request<Patient>(`/patients/${id}`, { signal }),
  createPatient: (patient: PatientInput) =>
    request<Patient>('/patients', { method: 'POST', body: JSON.stringify(patient) }),
  updatePatient: (id: string, patient: PatientInput) =>
    request<Patient>(`/patients/${id}`, { method: 'PUT', body: JSON.stringify(patient) }),
  deletePatient: (id: string) => request<void>(`/patients/${id}`, { method: 'DELETE' }),
  encounters: (patientId: string, signal?: AbortSignal) =>
    request<PatientEncounter[]>(`/patients/${patientId}/encounters`, { signal }),
  encounter: (patientId: string, encounterId: number, signal?: AbortSignal) =>
    request<PatientEncounter>(`/patients/${patientId}/encounters/${encounterId}`, { signal }),
  createEncounter: (patientId: string, encounter: EncounterInput) =>
    request<PatientEncounter>(`/patients/${patientId}/encounters`, {
      method: 'POST',
      body: JSON.stringify(encounter),
    }),
  updateEncounter: (patientId: string, encounterId: number, encounter: EncounterInput) =>
    request<PatientEncounter>(`/patients/${patientId}/encounters/${encounterId}`, {
      method: 'PUT',
      body: JSON.stringify(encounter),
    }),
  deleteEncounter: (patientId: string, encounterId: number) =>
    request<void>(`/patients/${patientId}/encounters/${encounterId}`, { method: 'DELETE' }),
  notes: (id: string, signal?: AbortSignal, encounterId?: number) =>
    request<PatientNote[]>(
      `/patients/${id}/notes${encounterId === undefined ? '' : `?encounter_id=${encounterId}`}`,
      { signal },
    ),
  addNote: (id: string, content: string, timestamp: string, encounterId?: number | null) =>
    request<PatientNote>(`/patients/${id}/notes`, {
      method: 'POST',
      body: JSON.stringify({ content, timestamp, encounter_id: encounterId }),
    }),
  deleteNote: (id: string, noteId: string) =>
    request<void>(`/patients/${id}/notes/${noteId}`, { method: 'DELETE' }),
  summary: (id: string) => request<PatientSummary>(`/patients/${id}/summary`),
};
