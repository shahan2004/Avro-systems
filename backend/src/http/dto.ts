import { TicketRow } from '../domain/ticketService.js';
import { SlaStatus } from '../domain/sla.js';
import { SLA } from '../domain/sla.js';

export interface PublicMessageDto {
  id: number;
  from: 'you' | 'support';
  agentFirstName?: string | null;
  body: string;
  at: string;
}

export interface PortalTicketDto {
  ref: string;
  subject: string;
  status: string;
  priority: string;
  createdAt: string;
  messages: PublicMessageDto[];
  canReply: boolean;
  reopenableUntil: string | null;
  canCreateFollowUp: boolean;
}

export interface AgentTicketListItemDto {
  id: number;
  ref: string;
  subject: string;
  customerName: string;
  customerEmail: string;
  priority: string;
  status: string;
  assigneeId: string | null;
  assigneeName: string | null;
  createdAt: string;
  sla: SlaStatus;
  lastPublicPreview: string | null;
  pausedAt: string | null;
  reopenableUntil: string | null;
}

export function formatRef(id: number): string {
  return `FD-${String(id).padStart(4, '0')}`;
}

export function toFriendlyStatus(status: string): string {
  switch (status) {
    case 'open':
      return 'In Progress';
    case 'waiting_on_customer':
      return 'Waiting on you';
    case 'resolved':
      return 'Resolved';
    case 'closed':
      return 'Closed';
    default:
      return status;
  }
}

// INC-0304: Whitelist serializer for Customer Portal.
// Strictly whitelisted fields only. No internal notes or metadata can ever leak here.
export function toPortalTicketDto(
  ticket: TicketRow,
  messages: Array<{
    id: number;
    author_type: 'customer' | 'agent';
    agent_name?: string | null;
    body: string;
    created_at: Date;
  }>
): PortalTicketDto {
  const publicMessages: PublicMessageDto[] = messages.map((m) => {
    let agentFirstName: string | null = null;
    if (m.author_type === 'agent' && m.agent_name) {
      agentFirstName = m.agent_name.split(' ')[0];
    }
    return {
      id: m.id,
      from: m.author_type === 'customer' ? 'you' : 'support',
      agentFirstName,
      body: m.body,
      at: new Date(m.created_at).toISOString(),
    };
  });

  let reopenableUntil: string | null = null;
  if (ticket.status === 'resolved' && ticket.resolved_at) {
    const limit = new Date(new Date(ticket.resolved_at).getTime() + SLA.reopenWindowDays * 24 * 60 * 60 * 1000);
    reopenableUntil = limit.toISOString();
  }

  return {
    ref: formatRef(ticket.id),
    subject: ticket.subject,
    status: toFriendlyStatus(ticket.status),
    priority: ticket.priority,
    createdAt: new Date(ticket.created_at).toISOString(),
    messages: publicMessages,
    canReply: ticket.status !== 'closed',
    reopenableUntil,
    canCreateFollowUp: ticket.status === 'closed',
  };
}
