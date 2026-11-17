import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth, useCan } from './auth';
import Layout from './components/Layout';
import { PageLoader } from './components/ui';
import AccountPage from './pages/AccountPage';
import GeneratePage from './pages/GeneratePage';
import LibraryPage from './pages/LibraryPage';
import LoginPage from './pages/LoginPage';
import SopEditorPage from './pages/SopEditorPage';
import SopViewPage from './pages/SopViewPage';
import AdminLayout from './pages/admin/AdminLayout';
import BrandingSettings from './pages/admin/BrandingSettings';
import CategoriesSettings from './pages/admin/CategoriesSettings';
import ExportSettings from './pages/admin/ExportSettings';
import AiSettings from './pages/admin/AiSettings';
import SystemPage from './pages/admin/SystemPage';
import TemplateDesigner from './pages/admin/TemplateDesigner';
import TemplatesPage from './pages/admin/TemplatesPage';
import UsersSettings from './pages/admin/UsersSettings';
import LanguagesSettings from './pages/admin/LanguagesSettings';
import NotificationsSettings from './pages/admin/NotificationsSettings';
import OperationsSettings from './pages/admin/OperationsSettings';
import TeamsSettings from './pages/admin/TeamsSettings';
import ActionsPage from './pages/ActionsPage';
import DashboardPage from './pages/DashboardPage';
import RecordsPage from './pages/RecordsPage';
import SchedulesPage from './pages/SchedulesPage';
import StationsPage from './pages/StationsPage';
import TrainingPage from './pages/TrainingPage';
import TranslationEditorPage from './pages/TranslationEditorPage';
import RunPage from './pages/floor/RunPage';
import StationPage from './pages/floor/StationPage';
import StationSopPage from './pages/floor/StationSopPage';
import type { ReactNode } from 'react';

function RequireRole({ role, children }: { role: 'editor' | 'admin'; children: ReactNode }) {
  return useCan(role) ? <>{children}</> : <Navigate to="/" replace />;
}

export default function App() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageLoader />;
  // Floor pages (QR stations, checklists) work with or without an account.
  const floor = (
    <>
      <Route path="/s/:token" element={<StationPage />} />
      <Route path="/s/:token/sop/:sopId" element={<StationSopPage />} />
      <Route path="/run/:token" element={<RunPage />} />
    </>
  );
  if (!user) {
    return (
      <Routes>
        {floor}
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />} />
      </Routes>
    );
  }
  return (
    <Routes>
      {floor}
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/sops/:id/translate/:lang" element={<RequireRole role="editor"><TranslationEditorPage /></RequireRole>} />
      <Route path="/admin/templates/:id" element={<RequireRole role="admin"><TemplateDesigner /></RequireRole>} />
      <Route path="/sops/:id/edit" element={<RequireRole role="editor"><SopEditorPage /></RequireRole>} />
      <Route element={<Layout />}>
        <Route path="/" element={<LibraryPage />} />
        <Route path="/sops/:id" element={<SopViewPage />} />
        <Route path="/generate" element={<RequireRole role="editor"><GeneratePage /></RequireRole>} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/training" element={<RequireRole role="editor"><TrainingPage /></RequireRole>} />
        <Route path="/stations" element={<RequireRole role="editor"><StationsPage /></RequireRole>} />
        <Route path="/records" element={<RequireRole role="editor"><RecordsPage /></RequireRole>} />
        <Route path="/actions" element={<RequireRole role="editor"><ActionsPage /></RequireRole>} />
        <Route path="/schedules" element={<RequireRole role="editor"><SchedulesPage /></RequireRole>} />
        <Route path="/dashboard" element={<RequireRole role="editor"><DashboardPage /></RequireRole>} />
        <Route path="/admin" element={<RequireRole role="admin"><AdminLayout /></RequireRole>}>
          <Route index element={<Navigate to="templates" replace />} />
          <Route path="templates" element={<TemplatesPage />} />
          <Route path="branding" element={<BrandingSettings />} />
          <Route path="export" element={<ExportSettings />} />
          <Route path="categories" element={<CategoriesSettings />} />
          <Route path="users" element={<UsersSettings />} />
          <Route path="teams" element={<TeamsSettings />} />
          <Route path="operations" element={<OperationsSettings />} />
          <Route path="languages" element={<LanguagesSettings />} />
          <Route path="email" element={<NotificationsSettings />} />
          <Route path="ai" element={<AiSettings />} />
          <Route path="system" element={<SystemPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
