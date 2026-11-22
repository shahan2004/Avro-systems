import React from 'react';
import { SlaStatus } from '../api';
import { formatWorkingMinutes, formatISTShort } from '../time';
import { Clock, AlertTriangle, CheckCircle, PauseCircle } from 'lucide-react';

interface SlaBadgeProps {
  sla: SlaStatus;
  priority: string;
  status: string;
}

export const SlaBadge: React.FC<SlaBadgeProps> = ({ sla, status }) => {
  if (status === 'closed') {
    return (
      <span className="badge" style={{ background: '#f1f5f9', color: '#64748b' }}>
        Closed
      </span>
    );
  }

  if (sla.late) {
    const overdueMins =
      sla.response.state === 'breached' && sla.response.remainingWorkingMin < 0
        ? -sla.response.remainingWorkingMin
        : sla.resolution.state === 'breached' && sla.resolution.remainingWorkingMin < 0
        ? -sla.resolution.remainingWorkingMin
        : 0;

    return (
      <span className="badge badge-late">
        <AlertTriangle size={12} />
        {overdueMins > 0 ? `OVERDUE by ${formatWorkingMinutes(overdueMins)}` : 'OVERDUE'}
      </span>
    );
  }

  if (status === 'waiting_on_customer' || sla.resolution.state === 'paused') {
    return (
      <span className="badge badge-paused">
        <PauseCircle size={12} /> Paused (Waiting)
      </span>
    );
  }

  if (status === 'resolved') {
    return (
      <span className="badge badge-met">
        <CheckCircle size={12} /> Resolved
      </span>
    );
  }

  // Active ticket: display remaining time for current active milestone
  if (sla.response.state === 'ok' && sla.response.dueAt) {
    return (
      <span className="badge badge-ok">
        <Clock size={12} /> Reply in {formatWorkingMinutes(sla.response.remainingWorkingMin)}
      </span>
    );
  }

  if (sla.resolution.state === 'ok' && sla.resolution.dueAt) {
    return (
      <span className="badge badge-ok">
        <Clock size={12} /> Fix in {formatWorkingMinutes(sla.resolution.remainingWorkingMin)}
      </span>
    );
  }

  return (
    <span className="badge badge-ok">
      <CheckCircle size={12} /> On track
    </span>
  );
};
