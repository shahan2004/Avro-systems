import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, AuthUser } from '../api';
import { Shield, LogOut, Calendar, BarChart3, Ticket, AlertCircle } from 'lucide-react';

interface NavbarProps {
  user: AuthUser;
  onLogout: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ user, onLogout }) => {
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await api.logout();
      onLogout();
      navigate('/login');
    } catch (e) {
      console.error('Logout error:', e);
    }
  };

  return (
    <header style={{ background: '#fff', borderBottom: '1px solid #e2e8f0' }}>
      <div className="container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
          <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '8px', textDecoration: 'none', color: '#0f172a', fontWeight: 700, fontSize: '1.25rem' }}>
            <div style={{ background: '#2563eb', color: '#fff', padding: '6px', borderRadius: '6px', display: 'flex' }}>
              <Shield size={20} />
            </div>
            <span>Frontdesk</span>
            <span style={{ fontSize: '0.75rem', background: '#f1f5f9', color: '#64748b', padding: '2px 6px', borderRadius: '4px', fontWeight: 500 }}>
              Arvo Systems
            </span>
          </Link>

          <nav style={{ display: 'flex', gap: '16px' }}>
            <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.875rem', fontWeight: 500, color: '#334155' }}>
              <Ticket size={16} /> My Tickets
            </Link>
            {user.role === 'lead' && (
              <>
                <Link to="/reports" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.875rem', fontWeight: 500, color: '#334155' }}>
                  <BarChart3 size={16} /> SLA Reports
                </Link>
                <Link to="/admin/holidays" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.875rem', fontWeight: 500, color: '#334155' }}>
                  <Calendar size={16} /> Holidays
                </Link>
              </>
            )}
          </nav>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ textAlign: 'right', fontSize: '0.8125rem' }}>
            <div style={{ fontWeight: 600, color: '#0f172a' }}>{user.name}</div>
            <div style={{ color: '#64748b', textTransform: 'capitalize' }}>
              {user.role === 'lead' ? 'Support Lead' : 'Support Agent'}
            </div>
          </div>
          <button onClick={handleLogout} className="btn-secondary" style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <LogOut size={14} /> Logout
          </button>
        </div>
      </div>
    </header>
  );
};
