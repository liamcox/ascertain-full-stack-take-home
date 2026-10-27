import { createContext, useContext, useState } from 'react';
import { ActionIcon, Badge, Button, Drawer } from '@mantine/core';
import {
  Activity,
  ChevronRight,
  LayoutDashboard,
  Menu,
  Plus,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { PatientForm } from './PatientForm';

const CreatePatientContext = createContext<() => void>(() => {});
export const useCreatePatient = () => useContext(CreatePatientContext);

function Brand() {
  return (
    <Link to="/" className="brand" aria-label="Ascertain Care home">
      <span className="brand-mark">
        a<span />
      </span>
      <span>
        ascertain<span className="brand-care">CARE WORKSPACE</span>
      </span>
    </Link>
  );
}

function SidebarContent({ close }: { close?: () => void }) {
  return (
    <>
      <Brand />
      <div className="workspace-label">YOUR WORKSPACE</div>
      <nav className="main-nav" aria-label="Main navigation">
        <NavLink to="/" end onClick={close}>
          <LayoutDashboard size={19} />
          <span>Overview</span>
        </NavLink>
        <NavLink to="/patients" onClick={close}>
          <Users size={19} />
          <span>Patients</span>
        </NavLink>
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-note">
          <span className="sidebar-note-icon">
            <ShieldCheck size={20} />
          </span>
          <strong>A space for better care.</strong>
          <p>Patient information, thoughtfully connected.</p>
          <Badge color="teal" variant="light" size="sm">
            DEMO WORKSPACE
          </Badge>
        </div>
        <div className="workspace-user">
          <div className="workspace-avatar">AC</div>
          <span>
            <strong>Ascertain Care</strong>
            <small>Clinical workspace</small>
          </span>
          <span className="online-dot" title="Demo workspace" />
        </div>
      </div>
    </>
  );
}

export function Layout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const section = pathname.startsWith('/patients')
    ? 'Patients'
    : pathname === '/'
      ? 'Overview'
      : 'Workspace';
  return (
    <CreatePatientContext.Provider value={() => setCreateOpen(true)}>
      <div className="app-layout">
        <aside className="desktop-sidebar">
          <SidebarContent />
        </aside>
        <Drawer
          opened={menuOpen}
          onClose={() => setMenuOpen(false)}
          size={268}
          title="Workspace navigation"
          classNames={{ body: 'mobile-sidebar' }}
        >
          <SidebarContent close={() => setMenuOpen(false)} />
        </Drawer>
        <div className="main-shell">
          <header className="topbar">
            <div className="topbar-left">
              <ActionIcon
                variant="subtle"
                color="dark"
                className="mobile-menu"
                onClick={() => setMenuOpen(true)}
                aria-label="Open navigation"
              >
                <Menu size={21} />
              </ActionIcon>
              <span className="breadcrumb-home">Workspace</span>
              <ChevronRight size={13} className="breadcrumb-chevron" />
              <span className="breadcrumb-current">{section}</span>
              {pathname.startsWith('/patients/') && (
                <>
                  <ChevronRight size={13} className="breadcrumb-chevron" />
                  <span className="breadcrumb-detail">Patient record</span>
                </>
              )}
            </div>
            <div className="topbar-right">
              <span className="demo-indicator">
                <span />
                Fictional demo data
              </span>
              <div className="header-avatar" aria-label="Ascertain Care workspace">
                AC
              </div>
            </div>
          </header>
          <main id="main-content" className="page-content">
            <Outlet />
          </main>
          <footer className="page-footer">
            <span>
              <Activity size={13} />
              Ascertain Care
            </span>
            <span>Built around the people you care for.</span>
          </footer>
        </div>
      </div>
      <PatientForm
        opened={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={(patient) => navigate(`/patients/${patient.id}`)}
      />
    </CreatePatientContext.Provider>
  );
}

export function AddPatientButton({ compact = false }: { compact?: boolean }) {
  const openCreate = useCreatePatient();
  return (
    <Button leftSection={<Plus size={17} />} onClick={openCreate} size={compact ? 'sm' : 'md'}>
      Add patient
    </Button>
  );
}
