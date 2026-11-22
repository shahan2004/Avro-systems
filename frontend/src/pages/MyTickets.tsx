import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api, AgentTicketItem, AuthUser } from '../api';
import { SlaBadge } from '../components/SlaBadge';
import { formatISTShort } from '../time';
import { AlertTriangle, Clock, PauseCircle, CheckCircle, Search, UserCheck, Inbox } from 'lucide-react';

interface MyTicketsProps {
  user: AuthUser;
}

export const MyTickets: React.FC<MyTicketsProps> = ({ user }) => {
  const [view, setView] = useState<'mine' | 'unassigned' | 'all'>('mine');
  const [tickets, setTickets] = useState<AgentTicketItem[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'error' | 'success' } | null>(null);

  const showToast = (text: string, type: 'error' | 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 4000);
  };

  const loadTickets = useCallback(async () => {
    try {
      const res = await api.getTickets(view, search);
      setTickets(res.items);
    } catch (e: any) {
      console.error('Failed to load tickets:', e);
    } finally {
      setLoading(false);
    }
  }, [view, search]);

  useEffect(() => {
    loadTickets();
    const interval = setInterval(loadTickets, 30000); // 30s auto-refresh
    const onFocus = () => loadTickets();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [loadTickets]);

  const handleTakeTicket = async (ticketId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      await api.claimTicket(ticketId);
      showToast('Ticket claimed successfully!', 'success');
      loadTickets();
    } catch (err: any) {
      if (err.code === 'ALREADY_CLAIMED') {
        const assignedTo = err.extras?.assignedTo || 'another agent';
        showToast(`Already taken by ${assignedTo}`, 'error');
      } else {
        showToast(err.message || 'Failed to claim ticket', 'error');
      }
      loadTickets();
    }
  };

  // Group tickets strictly according to R7 & §9:
  // 1. Late (overdue, unmet, not paused) - sorted by most overdue
  // 2. Active - sorted by soonest due
  // 3. Waiting on customer - shows "paused since ..."
  // 4. Resolved (reopenable) - shows reopen deadline
  const lateTickets = tickets
    .filter((t) => t.sla.late && t.status !== 'waiting_on_customer' && t.status !== 'resolved' && t.status !== 'closed')
    .sort((a, b) => {
      const remA = Math.min(a.sla.response.remainingWorkingMin, a.sla.resolution.remainingWorkingMin);
      const remB = Math.min(b.sla.response.remainingWorkingMin, b.sla.resolution.remainingWorkingMin);
      return remA - remB; // most overdue first
    });

  const activeTickets = tickets
    .filter((t) => !t.sla.late && t.status === 'open')
    .sort((a, b) => {
      const dueA = a.sla.response.state === 'ok' ? a.sla.response.dueAt : a.sla.resolution.dueAt;
      const dueB = b.sla.response.state === 'ok' ? b.sla.response.dueAt : b.sla.resolution.dueAt;
      return new Date(dueA || 0).getTime() - new Date(dueB || 0).getTime();
    });

  const waitingTickets = tickets.filter((t) => t.status === 'waiting_on_customer');
  const resolvedTickets = tickets.filter((t) => t.status === 'resolved');
  const closedTickets = tickets.filter((t) => t.status === 'closed');

  const renderTicketRow = (t: AgentTicketItem) => (
    <tr key={t.id} style={{ borderBottom: '1px solid #f1f5f9', transition: 'background 0.1s' }}>
      <td style={{ padding: '12px', fontWeight: 600 }}>
        <Link to={`/tickets/${t.id}`} style={{ color: '#2563eb' }}>
          {t.ref}
        </Link>
      </td>
      <td style={{ padding: '12px' }}>
        <Link to={`/tickets/${t.id}`} style={{ color: '#0f172a', fontWeight: 500, textDecoration: 'none' }}>
          {t.subject}
        </Link>
        {t.lastPublicPreview && (
          <div style={{ color: '#64748b', fontSize: '0.75rem', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '360px' }}>
            {t.lastPublicPreview}
          </div>
        )}
      </td>
      <td style={{ padding: '12px', fontSize: '0.8125rem' }}>
        <div style={{ fontWeight: 500, color: '#334155' }}>{t.customerName}</div>
        <div style={{ color: '#94a3b8', fontSize: '0.75rem' }}>{t.customerEmail}</div>
      </td>
      <td style={{ padding: '12px' }}>
        <span className={`badge badge-${t.priority}`}>{t.priority}</span>
      </td>
      <td style={{ padding: '12px' }}>
        <SlaBadge sla={t.sla} priority={t.priority} status={t.status} />
      </td>
      <td style={{ padding: '12px', fontSize: '0.8125rem', color: '#475569' }}>
        {t.assigneeName ? (
          <span>{t.assigneeName}</span>
        ) : (
          <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>Unassigned</span>
        )}
      </td>
      <td style={{ padding: '12px', textAlign: 'right' }}>
        {t.assigneeId === null && t.status === 'open' && (
          <button
            type="button"
            className="btn-primary"
            style={{ padding: '4px 10px', fontSize: '0.75rem' }}
            onClick={(e) => handleTakeTicket(t.id, e)}
          >
            Take
          </button>
        )}
      </td>
    </tr>
  );

  const renderSection = (
    title: string,
    items: AgentTicketItem[],
    icon: React.ReactNode,
    badgeColor: string,
    extraInfo?: (t: AgentTicketItem) => React.ReactNode
  ) => {
    if (items.length === 0) return null;

    return (
      <div className="card" style={{ marginBottom: '20px', overflow: 'hidden' }}>
        <div
          style={{
            padding: '12px 16px',
            background: '#f8fafc',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, fontSize: '0.9375rem' }}>
            {icon}
            <span>{title}</span>
            <span
              style={{
                background: badgeColor,
                color: '#fff',
                fontSize: '0.75rem',
                padding: '1px 8px',
                borderRadius: '9999px',
                fontWeight: 700,
              }}
            >
              {items.length}
            </span>
          </div>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ background: '#fafafa', borderBottom: '1px solid #e2e8f0', color: '#64748b', fontSize: '0.75rem', textTransform: 'uppercase' }}>
              <th style={{ padding: '10px 12px' }}>Ref</th>
              <th style={{ padding: '10px 12px' }}>Subject</th>
              <th style={{ padding: '10px 12px' }}>Customer</th>
              <th style={{ padding: '10px 12px' }}>Priority</th>
              <th style={{ padding: '10px 12px' }}>SLA Status</th>
              <th style={{ padding: '10px 12px' }}>Assignee</th>
              <th style={{ padding: '10px 12px', textAlign: 'right' }}>Action</th>
            </tr>
          </thead>
          <tbody>{items.map(renderTicketRow)}</tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="container">
      {toastMessage && (
        <div className="toast-container">
          <div className={`toast toast-${toastMessage.type}`}>{toastMessage.text}</div>
        </div>
      )}

      {/* View switcher & Search */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', gap: '16px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', background: '#e2e8f0', padding: '3px', borderRadius: '8px' }}>
          <button
            type="button"
            onClick={() => setView('mine')}
            style={{
              background: view === 'mine' ? '#fff' : 'transparent',
              color: view === 'mine' ? '#0f172a' : '#64748b',
              boxShadow: view === 'mine' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              padding: '6px 14px',
              border: 'none',
            }}
          >
            My Tickets
          </button>
          <button
            type="button"
            onClick={() => setView('unassigned')}
            style={{
              background: view === 'unassigned' ? '#fff' : 'transparent',
              color: view === 'unassigned' ? '#0f172a' : '#64748b',
              boxShadow: view === 'unassigned' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              padding: '6px 14px',
              border: 'none',
            }}
          >
            Unassigned Queue
          </button>
          {user.role === 'lead' && (
            <button
              type="button"
              onClick={() => setView('all')}
              style={{
                background: view === 'all' ? '#fff' : 'transparent',
                color: view === 'all' ? '#0f172a' : '#64748b',
                boxShadow: view === 'all' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                padding: '6px 14px',
                border: 'none',
              }}
            >
              All Tickets (Lead)
            </button>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '280px' }}>
          <div style={{ position: 'relative', width: '100%' }}>
            <input
              type="text"
              placeholder="Search tickets, subject, customer..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ paddingLeft: '32px' }}
            />
            <Search size={16} color="#94a3b8" style={{ position: 'absolute', left: '10px', top: '10px' }} />
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#64748b' }}>Loading tickets...</div>
      ) : tickets.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '48px 16px' }}>
          <Inbox size={40} color="#94a3b8" style={{ margin: '0 auto 12px' }} />
          <h3 style={{ fontSize: '1.125rem', fontWeight: 600, color: '#334155' }}>No tickets found</h3>
          <p style={{ color: '#64748b', fontSize: '0.875rem', marginTop: '4px' }}>
            {view === 'unassigned' ? 'Unassigned queue is empty.' : 'You have no tickets matching this view.'}
          </p>
        </div>
      ) : view === 'unassigned' ? (
        renderSection('Unassigned Tickets', tickets, <Inbox size={18} color="#2563eb" />, '#2563eb')
      ) : (
        <>
          {/* Section 1: Late tickets (red) */}
          {renderSection(
            'Late Tickets (Overdue)',
            lateTickets,
            <AlertTriangle size={18} color="#ef4444" />,
            '#ef4444'
          )}

          {/* Section 2: Active tickets */}
          {renderSection(
            'Active Tickets',
            activeTickets,
            <Clock size={18} color="#2563eb" />,
            '#2563eb'
          )}

          {/* Section 3: Waiting on customer (paused) */}
          {renderSection(
            'Waiting on Customer (SLA Paused)',
            waitingTickets,
            <PauseCircle size={18} color="#d97706" />,
            '#d97706'
          )}

          {/* Section 4: Resolved (reopenable within 7 days) */}
          {renderSection(
            'Resolved (Reopen Window Active)',
            resolvedTickets,
            <CheckCircle size={18} color="#10b981" />,
            '#10b981'
          )}

          {/* Closed */}
          {renderSection(
            'Closed Tickets',
            closedTickets,
            <CheckCircle size={18} color="#64748b" />,
            '#64748b'
          )}
        </>
      )}
    </div>
  );
};
