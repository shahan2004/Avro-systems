import React, { useState } from 'react';
import { api } from '../../api';
import { Shield, CheckCircle, Copy, ExternalLink } from 'lucide-react';

export const NewTicket: React.FC = () => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState('partly_blocked');
  const [submitting, setSubmitting] = useState(false);
  const [createdResult, setCreatedResult] = useState<{ ref: string; portalUrl: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await api.createPortalTicket({
        name,
        email,
        subject,
        description,
        severity,
      });
      setCreatedResult(res);
    } catch (err: any) {
      alert(err.message || 'Failed to submit ticket');
    } finally {
      setSubmitting(false);
    }
  };

  const copyLink = () => {
    if (createdResult) {
      navigator.clipboard.writeText(createdResult.portalUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    }
  };

  if (createdResult) {
    return (
      <div style={{ minHeight: '100vh', background: '#f8fafc', padding: '32px 16px' }}>
        <div className="card" style={{ maxWidth: '600px', margin: '40px auto', padding: '32px', textAlign: 'center' }}>
          <div style={{ display: 'inline-flex', background: '#dcfce7', color: '#16a34a', padding: '16px', borderRadius: '50%', marginBottom: '16px' }}>
            <CheckCircle size={40} />
          </div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a' }}>Ticket Submitted!</h1>
          <p style={{ color: '#64748b', fontSize: '0.9375rem', marginTop: '6px' }}>
            Your support ticket <strong>{createdResult.ref}</strong> has been created.
          </p>

          <div
            style={{
              background: '#eff6ff',
              border: '1px solid #bfdbfe',
              borderRadius: '8px',
              padding: '16px',
              margin: '24px 0',
              textAlign: 'left',
            }}
          >
            <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#1e40af', marginBottom: '6px' }}>
              IMPORTANT: Save this link to check replies and update your ticket
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                readOnly
                value={createdResult.portalUrl}
                style={{ fontSize: '0.8125rem', background: '#fff' }}
              />
              <button type="button" className="btn-secondary" onClick={copyLink} style={{ display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
                <Copy size={14} /> {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          <a
            href={createdResult.portalUrl}
            className="btn-primary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '10px 20px', textDecoration: 'none' }}
          >
            View My Ticket <ExternalLink size={16} />
          </a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', padding: '32px 16px' }}>
      <div className="card" style={{ maxWidth: '640px', margin: '0 auto', padding: '32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
          <div style={{ background: '#2563eb', color: '#fff', padding: '8px', borderRadius: '8px', display: 'flex' }}>
            <Shield size={24} />
          </div>
          <div>
            <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: '#0f172a' }}>Arvo Systems Support</h1>
            <p style={{ color: '#64748b', fontSize: '0.875rem' }}>Submit a ticket to our customer care team</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                Your Name
              </label>
              <input
                type="text"
                placeholder="Jane Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                Your Email
              </label>
              <input
                type="email"
                placeholder="jane@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
              Subject
            </label>
            <input
              type="text"
              placeholder="Brief summary of the problem"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
            />
          </div>

          {/* Severity selector in plain language */}
          <div>
            <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
              How urgent is this problem?
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '10px 14px',
                  borderRadius: '6px',
                  border: severity === 'cannot_work' ? '2px solid #ef4444' : '1px solid #e2e8f0',
                  background: severity === 'cannot_work' ? '#fef2f2' : '#fff',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="radio"
                  name="severity"
                  value="cannot_work"
                  style={{ width: 'auto' }}
                  checked={severity === 'cannot_work'}
                  onChange={(e) => setSeverity(e.target.value)}
                />
                <div>
                  <strong style={{ color: '#991b1b', display: 'block' }}>I cannot work at all (Urgent)</strong>
                  <span style={{ fontSize: '0.75rem', color: '#64748b' }}>We reply within 2 hours and aim to fix the same working day.</span>
                </div>
              </label>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '10px 14px',
                  borderRadius: '6px',
                  border: severity === 'partly_blocked' ? '2px solid #f59e0b' : '1px solid #e2e8f0',
                  background: severity === 'partly_blocked' ? '#fffbeb' : '#fff',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="radio"
                  name="severity"
                  value="partly_blocked"
                  style={{ width: 'auto' }}
                  checked={severity === 'partly_blocked'}
                  onChange={(e) => setSeverity(e.target.value)}
                />
                <div>
                  <strong style={{ color: '#92400e', display: 'block' }}>I am partly blocked (Medium)</strong>
                  <span style={{ fontSize: '0.75rem', color: '#64748b' }}>We reply within half a working day and fix in about 3 days.</span>
                </div>
              </label>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '10px 14px',
                  borderRadius: '6px',
                  border: severity === 'question' ? '2px solid #2563eb' : '1px solid #e2e8f0',
                  background: severity === 'question' ? '#eff6ff' : '#fff',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="radio"
                  name="severity"
                  value="question"
                  style={{ width: 'auto' }}
                  checked={severity === 'question'}
                  onChange={(e) => setSeverity(e.target.value)}
                />
                <div>
                  <strong style={{ color: '#1e40af', display: 'block' }}>Question or small request (Low)</strong>
                  <span style={{ fontSize: '0.75rem', color: '#64748b' }}>We reply within 1 working day and complete within 1 week.</span>
                </div>
              </label>
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
              Detailed Description
            </label>
            <textarea
              rows={5}
              placeholder="Please provide steps to reproduce, error messages, and context..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
            />
          </div>

          <button type="submit" className="btn-primary" style={{ padding: '12px' }} disabled={submitting}>
            {submitting ? 'Submitting...' : 'Submit Support Ticket'}
          </button>
        </form>
      </div>
    </div>
  );
};
