import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { api, AuthUser } from './api';
import { Navbar } from './components/Navbar';
import { Login } from './pages/Login';
import { MyTickets } from './pages/MyTickets';
import { TicketDetail } from './pages/TicketDetail';
import { Reports } from './pages/Reports';
import { Holidays } from './pages/Holidays';
import { NewTicket } from './pages/portal/NewTicket';
import { TicketView } from './pages/portal/TicketView';

export const App: React.FC = () => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.me()
      .then((res) => setUser(res.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>
        Loading Frontdesk...
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        {/* Customer Portal (Public) */}
        <Route path="/portal/new" element={<NewTicket />} />
        <Route path="/portal/t/:token" element={<TicketView />} />

        {/* Agent Auth */}
        <Route
          path="/login"
          element={user ? <Navigate to="/" replace /> : <Login onLoginSuccess={(u) => setUser(u)} />}
        />

        {/* Protected Agent Routes */}
        <Route
          path="/*"
          element={
            user ? (
              <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
                <Navbar user={user} onLogout={() => setUser(null)} />
                <main style={{ flex: 1, paddingBottom: '40px' }}>
                  <Routes>
                    <Route path="/" element={<MyTickets user={user} />} />
                    <Route path="/tickets/:id" element={<TicketDetail user={user} />} />
                    <Route
                      path="/reports"
                      element={user.role === 'lead' ? <Reports user={user} /> : <Navigate to="/" replace />}
                    />
                    <Route
                      path="/admin/holidays"
                      element={user.role === 'lead' ? <Holidays user={user} /> : <Navigate to="/" replace />}
                    />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </main>
              </div>
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
