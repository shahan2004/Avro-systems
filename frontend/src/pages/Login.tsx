import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, AuthUser } from '../api';
import { Shield, KeyRound, UserCheck } from 'lucide-react';

interface LoginProps {
  onLoginSuccess: (user: AuthUser) => void;
}

export const Login: React.FC<LoginProps> = ({ onLoginSuccess }) => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('meera@arvo.test');
  const [password, setPassword] = useState('Frontdesk@123');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await api.login(email, password);
      onLoginSuccess(res.user);
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const setDemoUser = (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword('Frontdesk@123');
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div className="card" style={{ maxWidth: '440px', width: '100%', padding: '32px' }}>
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div style={{ display: 'inline-flex', background: '#2563eb', color: '#fff', padding: '12px', borderRadius: '12px', marginBottom: '12px' }}>
            <Shield size={32} />
          </div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a' }}>Arvo Systems Frontdesk</h1>
          <p style={{ color: '#64748b', fontSize: '0.875rem', marginTop: '4px' }}>Agent & Lead Support Portal</p>
        </div>

        {error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: '10px 14px', borderRadius: '6px', fontSize: '0.875rem', marginBottom: '16px' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
              Email Address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="agent@arvo.test"
              required
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          <button type="submit" className="btn-primary" style={{ padding: '10px', marginTop: '4px' }} disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div style={{ marginTop: '24px', paddingTop: '20px', borderTop: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', marginBottom: '8px' }}>
            Demo Quick Logins (Pass: Frontdesk@123):
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="btn-secondary"
              style={{ flex: 1, fontSize: '0.75rem', padding: '6px' }}
              onClick={() => setDemoUser('meera@arvo.test')}
            >
              Meera (Lead)
            </button>
            <button
              type="button"
              className="btn-secondary"
              style={{ flex: 1, fontSize: '0.75rem', padding: '6px' }}
              onClick={() => setDemoUser('agent1@arvo.test')}
            >
              Rahul (Agent 1)
            </button>
            <button
              type="button"
              className="btn-secondary"
              style={{ flex: 1, fontSize: '0.75rem', padding: '6px' }}
              onClick={() => setDemoUser('agent2@arvo.test')}
            >
              Priya (Agent 2)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
