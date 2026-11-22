import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api, AuthUser } from '../api';
import { BarChart3, ShieldCheck, Download, AlertTriangle, CheckCircle, Users } from 'lucide-react';

interface ReportsProps {
  user: AuthUser;
}

export const Reports: React.FC<ReportsProps> = () => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [auditResult, setAuditResult] = useState<any>(null);
  const [verifyingAudit, setVerifyingAudit] = useState(false);

  useEffect(() => {
    api.getSlaReports()
      .then(setData)
      .catch((e) => console.error('Failed to load reports:', e))
      .finally(() => setLoading(false));
  }, []);

  const handleVerifyAudit = async () => {
    try {
      setVerifyingAudit(true);
      const res = await api.verifyAudit();
      setAuditResult(res);
    } catch (e: any) {
      alert(`Audit verification error: ${e.message}`);
    } finally {
      setVerifyingAudit(false);
    }
  };

  if (loading) {
    return <div className="container" style={{ textAlign: 'center', padding: '48px' }}>Loading analytics...</div>;
  }
  if (!data) {
    return <div className="container" style={{ textAlign: 'center', padding: '48px' }}>Failed to load report data.</div>;
  }

  const { summary, byPriority, byAgent, lateTickets } = data;

  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a' }}>SLA Performance & Late Ticket Report</h1>
          <p style={{ color: '#64748b', fontSize: '0.875rem', marginTop: '4px' }}>
            Root cause analysis answering: "Which tickets were late and why?" (Meera's Report)
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleVerifyAudit}
            disabled={verifyingAudit}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <ShieldCheck size={16} color="#16a34a" />
            {verifyingAudit ? 'Verifying Chains...' : 'Verify Cryptographic Audit'}
          </button>

          <a
            href="/api/tickets/export.csv"
            download
            className="btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '6px', textDecoration: 'none' }}
          >
            <Download size={16} /> Export CSV
          </a>
        </div>
      </div>

      {auditResult && (
        <div
          className="card"
          style={{
            padding: '16px',
            marginBottom: '20px',
            background: auditResult.ok ? '#f0fdf4' : '#fef2f2',
            border: auditResult.ok ? '1px solid #86efac' : '1px solid #fca5a5',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, color: auditResult.ok ? '#166534' : '#991b1b' }}>
            <ShieldCheck size={20} />
            <span>
              {auditResult.ok
                ? 'All SHA-256 event hash chains verified successfully! No tampering detected.'
                : `WARNING: Hash chain broken at ${auditResult.brokenAt.length} points!`}
            </span>
          </div>
          {!auditResult.ok && (
            <pre style={{ marginTop: '8px', fontSize: '0.75rem', color: '#b91c1c' }}>
              {JSON.stringify(auditResult.brokenAt, null, 2)}
            </pre>
          )}
        </div>
      )}

      {/* Summary KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        <div className="card" style={{ padding: '20px' }}>
          <div style={{ fontSize: '0.8125rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Total Tickets</div>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: '#0f172a', marginTop: '4px' }}>{summary.totalTickets}</div>
        </div>

        <div className="card" style={{ padding: '20px' }}>
          <div style={{ fontSize: '0.8125rem', color: '#16a34a', fontWeight: 600, textTransform: 'uppercase' }}>On-Time Rate</div>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: '#16a34a', marginTop: '4px' }}>{summary.onTimePercentage}%</div>
          <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '2px' }}>{summary.onTimeTicketsCount} tickets met all SLAs</div>
        </div>

        <div className="card" style={{ padding: '20px' }}>
          <div style={{ fontSize: '0.8125rem', color: '#dc2626', fontWeight: 600, textTransform: 'uppercase' }}>Late Tickets</div>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: '#dc2626', marginTop: '4px' }}>{summary.latePercentage}%</div>
          <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '2px' }}>{summary.lateTicketsCount} tickets overdue or breached</div>
        </div>
      </div>

      {/* Breakdowns */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px', marginBottom: '24px' }}>
        {/* By Priority */}
        <div className="card" style={{ padding: '20px' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#0f172a', marginBottom: '16px' }}>Breakdown by Priority</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {Object.entries(byPriority).map(([pri, val]: [string, any]) => (
              <div key={pri} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className={`badge badge-${pri}`}>{pri}</span>
                <span style={{ fontSize: '0.875rem', color: '#475569' }}>
                  {val.total} total • <strong style={{ color: val.late > 0 ? '#dc2626' : '#16a34a' }}>{val.late} late</strong>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* By Agent */}
        <div className="card" style={{ padding: '20px' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#0f172a', marginBottom: '16px' }}>Performance by Agent</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {byAgent.map((ag: any, idx: number) => (
              <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.875rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Users size={14} color="#64748b" />
                  <span>{ag.agentName}</span>
                </div>
                <span>
                  {ag.total} tickets ({ag.late > 0 ? <strong style={{ color: '#dc2626' }}>{ag.late} late</strong> : '0 late'})
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Late tickets root-cause drilldown */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', background: '#fff5f5', borderBottom: '1px solid #fed7d7', display: 'flex', alignItems: 'center', gap: '8px', color: '#991b1b', fontWeight: 600 }}>
          <AlertTriangle size={18} />
          <span>Which Tickets Were Late and Why? ({lateTickets.length} tickets)</span>
        </div>

        {lateTickets.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: '#16a34a' }}>
            🎉 No late tickets! All tickets are within SLA promises.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ background: '#fafafa', borderBottom: '1px solid #e2e8f0', color: '#64748b', fontSize: '0.75rem', textTransform: 'uppercase' }}>
                <th style={{ padding: '10px 16px' }}>Ref</th>
                <th style={{ padding: '10px 16px' }}>Subject</th>
                <th style={{ padding: '10px 16px' }}>Priority</th>
                <th style={{ padding: '10px 16px' }}>Assignee</th>
                <th style={{ padding: '10px 16px' }}>Root Cause</th>
              </tr>
            </thead>
            <tbody>
              {lateTickets.map((t: any) => (
                <tr key={t.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '12px 16px', fontWeight: 600 }}>
                    <Link to={`/tickets/${t.id}`}>{t.ref}</Link>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <Link to={`/tickets/${t.id}`} style={{ color: '#0f172a', textDecoration: 'none' }}>
                      {t.subject}
                    </Link>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span className={`badge badge-${t.priority}`}>{t.priority}</span>
                  </td>
                  <td style={{ padding: '12px 16px', color: '#475569' }}>{t.assigneeName}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {t.causes.map((c: string, idx: number) => (
                        <span key={idx} className="badge" style={{ background: '#fee2e2', color: '#991b1b', textTransform: 'none' }}>
                          {c === 'no_first_reply'
                            ? 'First Reply Late'
                            : c === 'slow_resolution'
                            ? 'Resolution Exceeded Budget'
                            : c === 'priority_escalated'
                            ? 'Priority Escalated Mid-flight'
                            : c}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
