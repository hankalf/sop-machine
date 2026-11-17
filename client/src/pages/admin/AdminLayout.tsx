import { Bot, Building2, FileOutput, HardDrive, Languages, LayoutTemplate, Mail, Tags, Users } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { cx } from '../../components/ui';

const TABS = [
  { to: 'templates', label: 'Templates', icon: LayoutTemplate },
  { to: 'branding', label: 'Branding', icon: Building2 },
  { to: 'export', label: 'Export & workflow', icon: FileOutput },
  { to: 'categories', label: 'Categories', icon: Tags },
  { to: 'users', label: 'Users', icon: Users },
  { to: 'languages', label: 'Languages', icon: Languages },
  { to: 'email', label: 'Email', icon: Mail },
  { to: 'ai', label: 'AI', icon: Bot },
  { to: 'system', label: 'Storage & backup', icon: HardDrive },
];

export default function AdminLayout() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Admin</h1>
        <p className="text-sm text-slate-500">Branding, SOP design, export options and who can do what.</p>
      </div>
      <nav className="-mx-1 flex gap-1 overflow-x-auto border-b border-slate-200 px-1 scrollbar-thin">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) =>
              cx('flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition', isActive ? 'border-brand text-brand' : 'border-transparent text-slate-500 hover:text-slate-900')
            }
          >
            <t.icon className="size-4" /> {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
