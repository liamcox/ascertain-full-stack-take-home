import { Button } from '@mantine/core';
import { ArrowLeft, FileQuestion } from 'lucide-react';
import { Link } from 'react-router-dom';

export function NotFoundPage({ patient = false }: { patient?: boolean }) {
  return (
    <div className="not-found">
      <div className="not-found-code">404</div>
      <div className="empty-icon">
        <FileQuestion size={28} />
      </div>
      <h1>{patient ? 'Patient record not found.' : 'This page took a wrong turn.'}</h1>
      <p>
        {patient
          ? 'This record may have been removed, or the link may be incorrect.'
          : 'The page you’re looking for isn’t in this workspace.'}
      </p>
      <Button
        component={Link}
        to={patient ? '/patients' : '/'}
        leftSection={<ArrowLeft size={16} />}
      >
        {patient ? 'Back to patients' : 'Back to overview'}
      </Button>
    </div>
  );
}
