import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, TicketDetail as TicketDetailType, AuthUser, AuditEventItem } from '../api';
import { SlaBadge } from '../components/SlaBadge';
import { Composer } from '../components/Composer';
import { Timeline } from '../components/Timeline';
import { formatIST, formatWorkingMinutes } from '../time';
import {
  ArrowLeft,
  User,
  Clock,
  Lock,
  CheckCircle,
  AlertCircle,
  ShieldCheck,
  Send,
  MessageSquare,
  History,
} from 'lucide-react';

interface TicketDetailProps {
  user: AuthUser;
}

export const TicketDetail: React.FC<TicketDetailProps> = ({ user }) => {
  const { id } = useParams<{ id: string }>();
  const ticketId = parseInt(id || '', 10);

  const [detail, setDetail] = useState<TicketDetailType | null>(null);
  const [events, setEvents] = useState<AuditEventItem[]>([]);
  const [agents, setAgents] = useState<AuthUser[]>([]);
  const [activeTab, setActiveTab] = useState<'thread' | 'history'>('thread');
  const [loading, setLoading] = useState(true);
  const [assigneeSelect, setAssigneeSelect] = useState('');
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'error' | 'success' } | null>(null);

  const showToast = (text: string, type: 'error' | 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 4000);
  };

  const loadData = useCallback(async () => {
    if (isNaN(ticketId)) return;
    try {
      const [ticketRes, eventsRes, agentsRes] = await Promise.all([
        api.getTicket(ticketId),
        api.getEvents(ticketId),
        api.getAgents(),
      ]);
      setDetail(ticketRes);
      setEvents(eventsRes.events);
      setAgents(agentsRes.agents);
      setAssigneeSelect(ticketRes.ticket.assignee_id || '');
    } catch (err: any) {
      showToast(err.message || 'Failed to load ticket', 'error');
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return <div className="container" style={{ textAlign: 'center', padding: '48px' }}>Loading ticket...</div>;
  }
  if (!detail) {
    return (
      <div className="container" style={{ textAlign: 'center', padding: '48px' }}>
        <h2>Ticket Not Found</h2>
        <Link to="/" style={{ marginTop: '12px', display: 'inline-block' }}>Back to Tickets</Link>
      </div>
    );
  }

  const { ticket, sla, messages, notes } = detail;
  const isAssignee = ticket.assignee_id === user.id;
  const isLead = user.role === 'lead';
  const canMutate = isAssignee || isLead;

  // Combine public messages and internal notes for the conversation thread, ordered by timestamp
  const threadItems = [
    ...messages.map((m) => ({
      kind: 'message' as const,
      id: m.id,
      authorType: m.author_type,
      authorName: m.author_type === 'customer' ? ticket.customer_name : (m.agent_name || 'Agent'),
      body: m.body,
      createdAt: m.created_at,
    })),
    ...notes.map((n) => ({
      kind: 'note' as const,
      id: n.id,
      authorType: 'agent' as const,
      authorName: n.author_name || 'Team Member',
      body: n.body,
      createdAt: n.created_at,
    })),
  ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  // Count agent public replies in the current cycle
  const publicAgentRepliesCount = messages.filter((m) => m.author_type === 'agent').length;

  const handleClaim = async () => {
    try {
      await api.claimTicket(ticketId);
      showToast('Claimed successfully', 'success');
      loadData();
    } catch (err: any) {
      showToast(err.extras?.assignedTo ? `Already taken by ${err.extras.assignedTo}` : err.message, 'error');
      loadData();
    }
  };

  const handleRelease = async () => {
    try {
      await api.releaseTicket(ticketId);
      showToast('Ticket released to unassigned queue', 'success');
      loadData();
    } catch (err: any) {
      showToast(err.message || 'Failed to release', 'error');
    }
  };

  const handleAssignChange = async (newAgentId: string) => {
    if (!newAgentId) return;
    try {
      await api.assignTicket(ticketId, newAgentId);
      showToast('Ticket assigned successfully', 'success');
      loadData();
    } catch (err: any) {
      showToast(err.message || 'Failed to assign', 'error');
    }
  };

  const handlePriorityChange = async (newPriority: string) => {
    try {
      await api.changePriority(ticketId, newPriority);
      showToast(`Priority changed to ${newPriority}`, 'success');
      loadData();
    } catch (err: any) {
      showToast(err.message || 'Failed to change priority', 'error');
    }
  };

  const handleSendReply = async (body: string, waitForCustomer: boolean) => {
    try {
      await api.sendReply(ticketId, body, waitForCustomer);
      showToast(waitForCustomer ? 'Reply sent & SLA clock paused' : 'Reply sent successfully', 'success');
      loadData();
    } catch (err: any) {
      showToast(err.message || 'Failed to send reply', 'error');
      throw err;
    }
  };

  const handleAddNote = async (body: string) => {
    try {
      await api.addNote(ticketId, body);
      showToast('Team note added', 'success');
      loadData();
    } catch (err: any) {
      showToast(err.message || 'Failed to add note', 'error');
      throw err;
    }
  };

  const handleResolve = async () => {
    if (publicAgentRepliesCount === 0) {
      showToast('Cannot resolve: at least 1 public agent reply is required (D15)', 'error');
      return;
    }
    if (!window.confirm('Are you sure you want to mark this ticket as Resolved?')) return;

    try {
      await api.resolveTicket(ticketId);
      showToast('Ticket marked as resolved', 'success');
      loadData();
    } catch (err: any) {
      showToast(err.message || 'Failed to resolve ticket', 'error');
    }
  };

  return (
    <div className="container">
      {toastMessage && (
        <div className="toast-container">
          <div className={`toast toast-${toastMessage.type}`}>{toastMessage.text}</div>
        </div>
      )}

      {/* Back button */}
      <div style={{ marginBottom: '16px' }}>
        <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.875rem', color: '#64748b' }}>
          <ArrowLeft size={16} /> Back to My Tickets
        </Link>
      </div>

      {/* Ticket Header Card */}
      <div className="card" style={{ padding: '20px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <span style={{ fontSize: '1.25rem', fontWeight: 700, color: '#2563eb' }}>{ticket.ref}</span>
              <span className={`badge badge-${ticket.priority}`}>{ticket.priority}</span>
              <SlaBadge sla={sla} priority={ticket.priority} status={ticket.status} />
              {ticket.cycle > 1 && (
                <span className="badge" style={{ background: '#f1f5f9', color: '#475569' }}>
                  Cycle {ticket.cycle} (Reopened {ticket.reopen_count}x)
                </span>
              )}
            </div>
            <h1 style={{ fontSize: '1.375rem', fontWeight: 600, color: '#0f172a', marginBottom: '6px' }}>{ticket.subject}</h1>
            <div style={{ fontSize: '0.8125rem', color: '#64748b', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              <div>
                Customer: <strong style={{ color: '#334155' }}>{ticket.customer_name}</strong> ({ticket.customer_email})
              </div>
              <div>Created: <strong>{formatIST(ticket.created_at)}</strong></div>
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            {ticket.assignee_id === null ? (
              <button type="button" className="btn-primary" onClick={handleClaim}>
                Take Ticket
              </button>
            ) : isAssignee ? (
              <button type="button" className="btn-secondary" onClick={handleRelease}>
                Release to Queue
              </button>
            ) : null}

            {ticket.status !== 'resolved' && ticket.status !== 'closed' && canMutate && (
              <button
                type="button"
                className="btn-success"
                onClick={handleResolve}
                disabled={publicAgentRepliesCount === 0}
                title={publicAgentRepliesCount === 0 ? 'Need at least 1 public reply first (D15)' : 'Mark as resolved'}
              >
                Mark Resolved
              </button>
            )}
          </div>
        </div>

        {/* Status, Priority & SLA Target Clocks */}
        <div
          style={{
            marginTop: '16px',
            paddingTop: '16px',
            borderTop: '1px solid #e2e8f0',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '16px',
            fontSize: '0.8125rem',
          }}
        >
          {/* Priority changer */}
          <div>
            <span style={{ color: '#64748b', display: 'block', marginBottom: '4px' }}>Priority (SLA Budget)</span>
            {canMutate ? (
              <select
                value={ticket.priority}
                onChange={(e) => handlePriorityChange(e.target.value)}
                style={{ padding: '4px 8px', fontSize: '0.8125rem' }}
              >
                <option value="urgent">Urgent (2h reply / End of day fix)</option>
                <option value="medium">Medium (Half day reply / 3 days fix)</option>
                <option value="low">Low (1 day reply / 5 days fix)</option>
              </select>
            ) : (
              <strong>{ticket.priority.toUpperCase()}</strong>
            )}
          </div>

          {/* Assignee transfer */}
          <div>
            <span style={{ color: '#64748b', display: 'block', marginBottom: '4px' }}>Assignee</span>
            {canMutate ? (
              <select
                value={assigneeSelect}
                onChange={(e) => {
                  setAssigneeSelect(e.target.value);
                  handleAssignChange(e.target.value);
                }}
                style={{ padding: '4px 8px', fontSize: '0.8125rem' }}
              >
                <option value="" disabled>Select agent...</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.role})
                  </option>
                ))}
              </select>
            ) : (
              <strong>{ticket.assignee_name || 'Unassigned'}</strong>
            )}
          </div>

          {/* First Response Target */}
          <div style={{ background: '#f8fafc', padding: '10px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
            <span style={{ color: '#64748b', display: 'block' }}>First Response Target</span>
            {ticket.first_response_at ? (
              <span style={{ color: '#16a34a', fontWeight: 600 }}>
                Met at {formatIST(ticket.first_response_at)}
              </span>
            ) : (
              <div>
                <strong style={{ color: sla.response.state === 'breached' ? '#dc2626' : '#0f172a' }}>
                  {formatIST(ticket.response_due_at)}
                </strong>
                <div style={{ color: sla.response.remainingWorkingMin < 0 ? '#dc2626' : '#64748b', fontSize: '0.75rem' }}>
                  {sla.response.remainingWorkingMin < 0
                    ? `Overdue by ${formatWorkingMinutes(-sla.response.remainingWorkingMin)}`
                    : `${formatWorkingMinutes(sla.response.remainingWorkingMin)} remaining`}
                </div>
              </div>
            )}
          </div>

          {/* Resolution Target */}
          <div style={{ background: '#f8fafc', padding: '10px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
            <span style={{ color: '#64748b', display: 'block' }}>Resolution Target</span>
            {ticket.status === 'waiting_on_customer' ? (
              <span style={{ color: '#d97706', fontWeight: 600 }}>
                Paused (Customer turn)
              </span>
            ) : ticket.resolved_at ? (
              <span style={{ color: '#16a34a', fontWeight: 600 }}>
                Resolved at {formatIST(ticket.resolved_at)}
              </span>
            ) : (
              <div>
                <strong style={{ color: sla.resolution.state === 'breached' ? '#dc2626' : '#0f172a' }}>
                  {formatIST(ticket.resolution_due_at)}
                </strong>
                <div style={{ color: sla.resolution.remainingWorkingMin < 0 ? '#dc2626' : '#64748b', fontSize: '0.75rem' }}>
                  {sla.resolution.remainingWorkingMin < 0
                    ? `Overdue by ${formatWorkingMinutes(-sla.resolution.remainingWorkingMin)}`
                    : `${formatWorkingMinutes(sla.resolution.remainingWorkingMin)} remaining`}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tabs: Thread vs History */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', borderBottom: '1px solid #e2e8f0' }}>
        <button
          type="button"
          onClick={() => setActiveTab('thread')}
          style={{
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'thread' ? '2px solid #2563eb' : '2px solid transparent',
            color: activeTab === 'thread' ? '#2563eb' : '#64748b',
            fontWeight: 600,
            padding: '8px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <MessageSquare size={16} /> Conversation & Notes
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('history')}
          style={{
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'history' ? '2px solid #2563eb' : '2px solid transparent',
            color: activeTab === 'history' ? '#2563eb' : '#64748b',
            fontWeight: 600,
            padding: '8px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <History size={16} /> Audit History ({events.length})
        </button>
      </div>

      {activeTab === 'thread' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Thread messages & notes */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {threadItems.map((item, idx) => (
              <div
                key={`${item.kind}-${item.id}-${idx}`}
                style={{
                  padding: '16px',
                  borderRadius: '8px',
                  // INC-0304: Visually distinct yellow style for internal notes with Lock icon
                  background:
                    item.kind === 'note'
                      ? '#fffbeb'
                      : item.authorType === 'customer'
                      ? '#f8fafc'
                      : '#eff6ff',
                  border:
                    item.kind === 'note'
                      ? '1px solid #fcd34d'
                      : item.authorType === 'customer'
                      ? '1px solid #e2e8f0'
                      : '1px solid #bfdbfe',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {item.kind === 'note' ? (
                      <span
                        style={{
                          background: '#fef3c7',
                          color: '#b45309',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        <Lock size={12} /> TEAM ONLY NOTE
                      </span>
                    ) : item.authorType === 'customer' ? (
                      <span style={{ fontWeight: 600, color: '#334155', fontSize: '0.875rem' }}>
                        Customer: {item.authorName}
                      </span>
                    ) : (
                      <span style={{ fontWeight: 600, color: '#1d4ed8', fontSize: '0.875rem' }}>
                        Support Reply ({item.authorName})
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{formatIST(item.createdAt)}</span>
                </div>

                <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.875rem', color: '#1e293b', lineHeight: 1.6 }}>
                  {item.body}
                </div>
              </div>
            ))}
          </div>

          {/* Composer */}
          {ticket.status !== 'closed' ? (
            canMutate ? (
              <Composer
                customerEmail={ticket.customer_email}
                onSendReply={handleSendReply}
                onAddNote={handleAddNote}
              />
            ) : (
              <div className="card" style={{ padding: '16px', textAlign: 'center', color: '#64748b', fontSize: '0.875rem' }}>
                You must claim this ticket or be assigned to reply or write notes.
              </div>
            )
          ) : (
            <div className="card" style={{ padding: '16px', textAlign: 'center', color: '#64748b', fontSize: '0.875rem' }}>
              This ticket is permanently closed ({ticket.close_reason || 'closed'}). No further replies can be added.
            </div>
          )}
        </div>
      ) : (
        <div className="card">
          <Timeline events={events} />
        </div>
      )}
    </div>
  );
};
