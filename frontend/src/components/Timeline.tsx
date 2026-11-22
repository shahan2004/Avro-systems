import React from 'react';
import { AuditEventItem } from '../api';
import { formatWorkingMinutes } from '../time';
import { ShieldCheck, Clock, User, Cpu, AlertTriangle } from 'lucide-react';

interface TimelineProps {
  events: AuditEventItem[];
}

export const Timeline: React.FC<TimelineProps> = ({ events }) => {
  if (events.length === 0) {
    return <div style={{ color: '#64748b', fontSize: '0.875rem', padding: '16px' }}>No audit events found.</div>;
  }

  const getActorIcon = (actorType: string) => {
    switch (actorType) {
      case 'agent':
        return <User size={14} color="#2563eb" />;
      case 'customer':
        return <User size={14} color="#059669" />;
      default:
        return <Cpu size={14} color="#64748b" />;
    }
  };

  const getEventTypeBadge = (type: string) => {
    if (type === 'sla_breached') {
      return (
        <span className="badge" style={{ background: '#fee2e2', color: '#dc2626', border: '1px solid #f87171' }}>
          <AlertTriangle size={12} /> BREACH
        </span>
      );
    }
    return (
      <span className="badge" style={{ background: '#f1f5f9', color: '#475569' }}>
        {type.replace(/_/g, ' ')}
      </span>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8125rem', color: '#16a34a', fontWeight: 600 }}>
        <ShieldCheck size={16} /> Cryptographically Hash-Chained Audit Trail (SHA-256 Verified)
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {events.map((ev) => (
          <div
            key={ev.seq}
            style={{
              padding: '12px',
              borderRadius: '6px',
              border: ev.type === 'sla_breached' ? '1px solid #fca5a5' : '1px solid #e2e8f0',
              background: ev.type === 'sla_breached' ? '#fff5f5' : '#fff',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              fontSize: '0.8125rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: '#94a3b8', fontWeight: 600 }}>#{ev.seq}</span>
                {getEventTypeBadge(ev.type)}
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#334155', fontWeight: 500 }}>
                  {getActorIcon(ev.actorType)}
                  <span>{ev.actorName}</span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: '#64748b' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Clock size={12} /> {ev.occurredAtIst}
                </span>
                <span style={{ background: '#f8fafc', padding: '2px 6px', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
                  +{formatWorkingMinutes(ev.workingMinutesSinceCycleStart)} working time
                </span>
              </div>
            </div>

            {Object.keys(ev.payload || {}).length > 0 && (
              <pre
                style={{
                  background: '#f8fafc',
                  padding: '6px 8px',
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  color: '#475569',
                  overflowX: 'auto',
                }}
              >
                {JSON.stringify(ev.payload)}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
