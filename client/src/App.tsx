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
import type { ReactNode } from 'react';

function RequireRole({ role, children }: { role: 'editor' | 'admin'; children: ReactNode }) {
  return useCan(role) ? <>{children}</> : <Navigate to="/" replace />;
}

export default function App() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageLoader />;
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/admin/templates/:id" element={<RequireRole role="admin"><TemplateDesigner /></RequireRole>} />
      <Route path="/sops/:id/edit" element={<RequireRole role="editor"><SopEditorPage /></RequireRole>} />
      <Route element={<Layout />}>
        <Route path="/" element={<LibraryPage />} />
        <Route path="/sops/:id" element={<SopViewPage />} />
        <Route path="/generate" element={<RequireRole role="editor"><GeneratePage /></RequireRole>} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/admin" element={<RequireRole role="admin"><AdminLayout /></RequireRole>}>
          <Route index element={<Navigate to="templates" replace />} />
          <Route path="templates" element={<TemplatesPage />} />
          <Route path="branding" element={<BrandingSettings />} />
          <Route path="export" element={<ExportSettings />} />
          <Route path="categories" element={<CategoriesSettings />} />
          <Route path="users" element={<UsersSettings />} />
          <Route path="ai" element={<AiSettings />} />
          <Route path="system" element={<SystemPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
