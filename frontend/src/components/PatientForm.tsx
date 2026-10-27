import { useEffect } from 'react';
import { Alert, Button, Modal, Select, Textarea, TextInput } from '@mantine/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { notifications } from '@mantine/notifications';
import { AlertCircle, ArrowRight, Check } from 'lucide-react';
import { api } from '../api';
import type { Patient, PatientInput } from '../api';
import { fullName, todayISO } from '../format';

const validPastDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value > todayISO()) return false;
  const date = new Date(`${value}T12:00:00`);
  return (
    !Number.isNaN(date.getTime()) &&
    date.getFullYear() === Number(value.slice(0, 4)) &&
    date.getMonth() + 1 === Number(value.slice(5, 7)) &&
    date.getDate() === Number(value.slice(8, 10))
  );
};
const toList = (value: string) => [
  ...new Set(
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  ),
];
const tagListSchema = z
  .string()
  .refine((value) => toList(value).length <= 50, 'Use 50 entries or fewer')
  .refine(
    (value) => toList(value).every((item) => item.length <= 100),
    'Each entry must use 100 characters or fewer',
  );
const schema = z
  .object({
    first_name: z
      .string()
      .trim()
      .min(1, 'First name is required')
      .max(100, 'Use 100 characters or fewer'),
    last_name: z
      .string()
      .trim()
      .min(1, 'Last name is required')
      .max(100, 'Use 100 characters or fewer'),
    dob: z.string().refine(validPastDate, 'Enter a valid date of birth that is not in the future'),
    status: z.enum(['active', 'follow_up', 'inactive']),
    email: z
      .string()
      .trim()
      .max(254)
      .refine(
        (value) => value === '' || z.string().email().safeParse(value).success,
        'Enter a valid email address',
      ),
    phone: z.string().trim().max(50, 'Use 50 characters or fewer'),
    address: z.string().trim().max(500, 'Use 500 characters or fewer'),
    blood_type: z.string(),
    last_visit: z
      .string()
      .refine(
        (value) => value === '' || validPastDate(value),
        'Enter a valid visit date that is not in the future',
      ),
    allergies: tagListSchema,
    conditions: tagListSchema,
  })
  .refine((value) => !value.last_visit || value.last_visit >= value.dob, {
    message: 'Last visit must be on or after the date of birth',
    path: ['last_visit'],
  });
type FormValues = z.infer<typeof schema>;
const defaults: FormValues = {
  first_name: '',
  last_name: '',
  dob: '',
  status: 'active',
  email: '',
  phone: '',
  address: '',
  blood_type: '',
  last_visit: '',
  allergies: '',
  conditions: '',
};
export function PatientForm({
  opened,
  onClose,
  patient,
  onSaved,
}: {
  opened: boolean;
  onClose: () => void;
  patient?: Patient;
  onSaved?: (saved: Patient) => void;
}) {
  const queryClient = useQueryClient();
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: defaults });
  const mutation = useMutation({
    mutationFn: (data: PatientInput) =>
      patient ? api.updatePatient(patient.id, data) : api.createPatient(data),
    onSuccess: (saved) => {
      queryClient.setQueryData(['patient', saved.id], saved);
      void queryClient.invalidateQueries({ queryKey: ['patients'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['summary', saved.id] });
      notifications.show({
        title: patient ? 'Patient updated' : 'Patient added',
        message: `${fullName(saved)}’s record has been saved.`,
        color: 'teal',
        icon: <Check size={17} />,
      });
      onClose();
      onSaved?.(saved);
    },
  });
  const resetMutation = mutation.reset;
  useEffect(() => {
    if (opened) {
      reset(
        patient
          ? {
              first_name: patient.first_name,
              last_name: patient.last_name,
              dob: patient.dob,
              status: patient.status,
              email: patient.email || '',
              phone: patient.phone || '',
              address: patient.address || '',
              blood_type: patient.blood_type || '',
              last_visit: patient.last_visit || '',
              allergies: (patient.allergies || []).join(', '),
              conditions: (patient.conditions || []).join(', '),
            }
          : defaults,
      );
      resetMutation();
    }
  }, [opened, patient, reset, resetMutation]);
  function submit(values: FormValues) {
    mutation.mutate({
      ...values,
      email: values.email || null,
      phone: values.phone || null,
      address: values.address || null,
      blood_type: values.blood_type || null,
      last_visit: values.last_visit || null,
      allergies: toList(values.allergies),
      conditions: toList(values.conditions),
    });
  }
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <div>
          <div className="eyebrow">PATIENT RECORD</div>
          <h2 className="modal-heading">{patient ? 'Edit patient' : 'Add a new patient'}</h2>
        </div>
      }
      size={690}
      radius="lg"
      padding="xl"
      closeOnClickOutside={!mutation.isPending && !isDirty}
      closeOnEscape={!mutation.isPending}
      closeButtonProps={{ disabled: mutation.isPending }}
      centered
    >
      <form onSubmit={handleSubmit(submit)} noValidate>
        <p className="form-intro">
          Keep the details that make care personal. Fields marked * are required.
        </p>
        <div className="form-section-heading">
          <span>01</span>
          <h3>Personal details</h3>
        </div>
        <div className="form-grid">
          <TextInput
            label="First name"
            withAsterisk
            autoComplete="given-name"
            maxLength={100}
            {...register('first_name')}
            error={errors.first_name?.message}
            data-autofocus
          />
          <TextInput
            label="Last name"
            withAsterisk
            autoComplete="family-name"
            maxLength={100}
            {...register('last_name')}
            error={errors.last_name?.message}
          />
          <TextInput
            label="Date of birth"
            withAsterisk
            type="date"
            max={todayISO()}
            {...register('dob')}
            error={errors.dob?.message}
          />
          <Controller
            control={control}
            name="status"
            render={({ field }) => (
              <Select
                label="Patient status"
                withAsterisk
                allowDeselect={false}
                data={[
                  { value: 'active', label: 'Active' },
                  { value: 'follow_up', label: 'Needs follow-up' },
                  { value: 'inactive', label: 'Inactive' },
                ]}
                value={field.value}
                onChange={(value) => field.onChange(value || 'active')}
                onBlur={field.onBlur}
                error={errors.status?.message}
              />
            )}
          />
          <TextInput
            label="Email address"
            type="email"
            autoComplete="email"
            placeholder="patient@example.com"
            {...register('email')}
            error={errors.email?.message}
          />
          <TextInput
            label="Phone number"
            type="tel"
            autoComplete="tel"
            placeholder="(555) 123-4567"
            {...register('phone')}
            error={errors.phone?.message}
          />
          <TextInput
            className="form-full"
            label="Address"
            autoComplete="street-address"
            placeholder="Street, city, state, ZIP"
            {...register('address')}
            error={errors.address?.message}
          />
        </div>
        <div className="form-section-heading">
          <span>02</span>
          <h3>Medical details</h3>
        </div>
        <div className="form-grid">
          <Controller
            control={control}
            name="blood_type"
            render={({ field }) => (
              <Select
                label="Blood type"
                placeholder="Not recorded"
                clearable
                data={['A+', 'A−', 'B+', 'B−', 'AB+', 'AB−', 'O+', 'O−'].map((label) => ({
                  label,
                  value: label.replace('−', '-'),
                }))}
                value={field.value || null}
                onChange={(value) => field.onChange(value || '')}
                onBlur={field.onBlur}
              />
            )}
          />
          <TextInput
            label="Last visit"
            type="date"
            max={todayISO()}
            {...register('last_visit')}
            error={errors.last_visit?.message}
          />
          <Textarea
            label="Conditions"
            placeholder="e.g. Hypertension, Type 2 diabetes"
            description="Separate each condition with a comma."
            autosize
            minRows={2}
            {...register('conditions')}
            error={errors.conditions?.message}
          />
          <Textarea
            label="Allergies"
            placeholder="e.g. Penicillin, Peanuts"
            description="Separate each allergy with a comma."
            autosize
            minRows={2}
            {...register('allergies')}
            error={errors.allergies?.message}
          />
        </div>
        {mutation.isError && (
          <Alert color="red" icon={<AlertCircle size={17} />} mt="lg">
            {mutation.error.message}
          </Alert>
        )}
        <div className="modal-footer">
          <Button variant="default" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            loading={mutation.isPending}
            rightSection={<ArrowRight size={16} />}
          >
            {patient ? 'Save changes' : 'Create patient'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
