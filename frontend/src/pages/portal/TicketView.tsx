import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, PortalTicket } from '../../api';
import { formatIST } from '../../time';
import { Shield, Send, Download, RefreshCw, PlusCircle, CheckCircle } from 'lucide-react';

export const TicketView: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [ticket, setTicket] = useState<PortalTicket | null>(null);
  const [loading, setLoading] = useState(true);
  const [replyText, setReplyText] = useState('');
  const [reopenReason, setReopenReason] = useState('');
  const [showReopenBox, setShowReopenBox] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadTicket = useCallback(async () => {
    if (!token) return;
    try {
      const res = await api.getPortalTicket(token);
      setTicket(res);
    } catch (err: any) {
      console.error('Failed to load portal ticket:', err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadTicket();
  }, [loadTicket]);

  const handleReplySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim() || submitting || !token) return;

    try {
      setSubmitting(true);
      await api.sendPortalReply(token, replyText.trim());
      setReplyText('');
      loadTicket();
    } catch (err: any) {
      alert(err.message || 'Failed to send reply');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReopen = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || submitting) return;

    try {
      setSubmitting(true);
      await api.reopenPortalTicket(token, reopenReason);
      setShowReopenBox(false);
      setReopenReason('');
      loadTicket();
    } catch (err: any) {
      alert(err.message || 'Failed to reopen ticket');
    } finally {
      setSubmitting(false);
    }
  };

  const handleFollowUp = async () => {
    if (!token) return;
    const confirmCreate = window.confirm('Create a new follow-up ticket linked to this closed issue?');
    if (!confirmCreate) return;

    try {
      const res = await api.createFollowUp(token);
      window.location.href = res.portalUrl;
    } catch (err: any) {
      alert(err.message || 'Failed to create follow-up');
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '48px', color: '#64748b' }}>Loading ticket details...</div>;
  }
  if (!ticket || !token) {
    return (
      <div style={{ maxWidth: '600px', margin: '60px auto', textAlign: 'center' }}>
        <h2>Ticket Not Found</h2>
        <p style={{ color: '#64748b', marginTop: '8px' }}>Please check the link provided in your email confirmation.</p>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', padding: '24px 16px' }}>
      <div style={{ maxWidth: '800px', margin: '0 auto' }}>
        {/* Header */}
        <div className="card" style={{ padding: '24px', marginBottom: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                <span style={{ fontSize: '1.25rem', fontWeight: 700, color: '#2563eb' }}>{ticket.ref}</span>
                <span className="badge" style={{ background: '#e0e7ff', color: '#3730a3' }}>
                  {ticket.status}
                </span>
                <span className={`badge badge-${ticket.priority}`}>
                  {ticket.priority}
                </span>
              </div>
              <h1 style={{ fontSize: '1.25rem', fontWeight: 600, color: '#0f172a' }}>{ticket.subject}</h1>
              <div style={{ color: '#64748b', fontSize: '0.8125rem', marginTop: '4px' }}>
                Submitted: {formatIST(ticket.createdAt)}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <a
                href={`/api/portal/tickets/${token}/transcript.txt`}
                download
                className="btn-secondary"
                style={{ display: 'flex', alignItems: 'center', gap: '4px', textDecoration: 'none', fontSize: '0.8125rem' }}
              >
                <Download size={14} /> Transcript (.txt)
              </a>
            </div>
          </div>
        </div>

        {/* Message Thread (INC-0304: strictly messages only, no internal notes) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
          {ticket.messages.map((m) => (
            <div
              key={m.id}
              style={{
                padding: '16px',
                borderRadius: '8px',
                background: m.from === 'you' ? '#ffffff' : '#eff6ff',
                border: m.from === 'you' ? '1px solid #e2e8f0' : '1px solid #bfdbfe',
                marginLeft: m.from === 'you' ? '0' : '24px',
                marginRight: m.from === 'you' ? '24px' : '0',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <strong style={{ fontSize: '0.875rem', color: m.from === 'you' ? '#334155' : '#1d4ed8' }}>
                  {m.from === 'you' ? 'You' : `Support (${m.agentFirstName || 'Agent'})`}
                </strong>
                <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{formatIST(m.at)}</span>
              </div>
              <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.875rem', color: '#1e293b', lineHeight: 1.6 }}>
                {m.body}
              </div>
            </div>
          ))}
        </div>

        {/* Reopen or Follow-up actions */}
        {ticket.status === 'Resolved' && ticket.reopenableUntil && (
          <div className="card" style={{ padding: '16px', marginBottom: '20px', background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <strong style={{ color: '#166534', display: 'block' }}>Is this problem still not solved?</strong>
                <span style={{ fontSize: '0.8125rem', color: '#4b5563' }}>
                  You can reopen this ticket until {formatIST(ticket.reopenableUntil)}.
                </span>
              </div>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowReopenBox(!showReopenBox)}
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <RefreshCw size={14} /> Reopen Ticket
              </button>
            </div>

            {showReopenBox && (
              <form onSubmit={handleReopen} style={{ marginTop: '12px' }}>
                <textarea
                  rows={3}
                  placeholder="Explain why the issue is still not solved..."
                  value={reopenReason}
                  onChange={(e) => setReopenReason(e.target.value)}
                  required
                />
                <button type="submit" className="btn-primary" style={{ marginTop: '8px' }} disabled={submitting}>
                  {submitting ? 'Reopening...' : 'Confirm Reopen'}
                </button>
              </form>
            )}
          </div>
        )}

        {ticket.canCreateFollowUp && (
          <div className="card" style={{ padding: '16px', marginBottom: '20px', textAlign: 'center' }}>
            <p style={{ color: '#64748b', fontSize: '0.875rem', marginBottom: '12px' }}>
              This ticket is permanently closed. If you have questions or need further assistance, you may create a linked follow-up ticket.
            </p>
            <button
              type="button"
              className="btn-primary"
              onClick={handleFollowUp}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <PlusCircle size={16} /> Create a Follow-up Ticket
            </button>
          </div>
        )}

        {/* Reply Composer */}
        {ticket.canReply && (
          <div className="card" style={{ padding: '20px' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#0f172a', marginBottom: '12px' }}>Send a Reply</h3>
            <form onSubmit={handleReplySubmit}>
              <textarea
                rows={4}
                placeholder="Type your response to the support team..."
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                required
                disabled={submitting}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px' }}>
                <button type="submit" className="btn-primary" disabled={submitting || !replyText.trim()}>
                  {submitting ? 'Sending...' : 'Send Reply'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};
