import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { createTheme, localStorageColorSchemeManager, MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from './components/Layout';
import { DashboardPage } from './pages/Dashboard';
import { PatientsPage } from './pages/Patients';
import { PatientDetailPage } from './pages/PatientDetail';
import { NotFoundPage } from './pages/NotFound';
import { ApiError } from './api';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import './styles.css';
import './theme.css';

const colorSchemeManager = localStorageColorSchemeManager({ key: 'ascertain-color-scheme' });

const theme = createTheme({
  primaryColor: 'care',
  colors: {
    care: [
      '#edf6f1',
      '#dcece3',
      '#b5d7c8',
      '#8cc0ac',
      '#66aa93',
      '#4b9c82',
      '#358c71',
      '#247a61',
      '#156450',
      '#105744',
    ],
  },
  fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  headings: {
    fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontWeight: '600',
  },
  defaultRadius: 'md',
  components: {
    Button: { defaultProps: { fw: 600 } },
    TextInput: { defaultProps: { size: 'sm' } },
    Select: { defaultProps: { size: 'sm' } },
    Modal: { defaultProps: { overlayProps: { backgroundOpacity: 0.3, blur: 3 } } },
  },
});
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) =>
        !(error instanceof ApiError && error.status >= 400 && error.status < 500) &&
        failureCount < 1,
      refetchOnWindowFocus: false,
    },
    mutations: { retry: false },
  },
});

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <div className="fatal-error">
          <h1>Let’s try that again.</h1>
          <p>Something interrupted the workspace. Reload to get back to your patients.</p>
          <button onClick={() => window.location.reload()}>Reload workspace</button>
        </div>
      );
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MantineProvider
      theme={theme}
      defaultColorScheme="auto"
      colorSchemeManager={colorSchemeManager}
    >
      <Notifications position="top-right" />
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <a href="#main-content" className="skip-link">
              Skip to content
            </a>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<DashboardPage />} />
                <Route path="patients" element={<PatientsPage />} />
                <Route path="patients/:id" element={<PatientDetailPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </QueryClientProvider>
      </ErrorBoundary>
    </MantineProvider>
  </React.StrictMode>,
);
