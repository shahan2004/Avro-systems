export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: 'agent' | 'lead';
}

export interface SlaMilestone {
  state: 'met' | 'ok' | 'breached' | 'paused' | 'n/a';
  dueAt: string | null;
  remainingWorkingMin: number;
}

export interface SlaStatus {
  response: SlaMilestone;
  resolution: SlaMilestone;
  late: boolean;
  everBreached: boolean;
}

export interface AgentTicketItem {
  id: number;
  ref: string;
  subject: string;
  customerName: string;
  customerEmail: string;
  priority: 'urgent' | 'medium' | 'low';
  status: 'open' | 'waiting_on_customer' | 'resolved' | 'closed';
  assigneeId: string | null;
  assigneeName: string | null;
  createdAt: string;
  sla: SlaStatus;
  lastPublicPreview: string | null;
  pausedAt: string | null;
  reopenableUntil: string | null;
}

export interface TicketMessage {
  id: number;
  author_type: 'customer' | 'agent';
  author_agent_id: string | null;
  agent_name: string | null;
  body: string;
  created_at: string;
}

export interface InternalNote {
  id: number;
  ticket_id: number;
  author_agent_id: string;
  author_name?: string;
  body: string;
  created_at: string;
}

export interface TicketDetail {
  ticket: {
    id: number;
    ref: string;
    customer_name: string;
    customer_email: string;
    subject: string;
    priority: 'urgent' | 'medium' | 'low';
    status: 'open' | 'waiting_on_customer' | 'resolved' | 'closed';
    assignee_id: string | null;
    assignee_name: string | null;
    created_at: string;
    cycle: number;
    reopen_count: number;
    response_due_at: string | null;
    resolution_due_at: string | null;
    first_response_at: string | null;
    resolved_at: string | null;
    paused_at: string | null;
    paused_working_minutes: number;
    close_reason: string | null;
  };
  sla: SlaStatus;
  messages: TicketMessage[];
  notes: InternalNote[];
}

export interface AuditEventItem {
  seq: number;
  type: string;
  actorType: 'agent' | 'customer' | 'system';
  actorName: string;
  payload: Record<string, unknown>;
  occurredAt: string;
  occurredAtIst: string;
  workingMinutesSinceCycleStart: number;
}

export interface PortalTicket {
  ref: string;
  subject: string;
  status: string;
  priority: string;
  createdAt: string;
  messages: Array<{
    id: number;
    from: 'you' | 'support';
    agentFirstName?: string | null;
    body: string;
    at: string;
  }>;
  canReply: boolean;
  reopenableUntil: string | null;
  canCreateFollowUp: boolean;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!res.ok) {
    let errorJson: any;
    try {
      errorJson = await res.json();
    } catch {
      throw new Error(`HTTP Error ${res.status}`);
    }
    const err = new Error(errorJson?.error?.message || `Request failed with ${res.status}`);
    (err as any).status = res.status;
    (err as any).code = errorJson?.error?.code;
    (err as any).extras = errorJson?.error;
    throw err;
  }

  return res.json() as Promise<T>;
}

export const api = {
  // Auth
  login: (email: string, password: string) =>
    request<{ user: AuthUser; token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  me: () => request<{ user: AuthUser }>('/api/auth/me'),

  // Tickets
  getTickets: (view = 'mine', q = '') =>
    request<{ items: AgentTicketItem[] }>(`/api/tickets?view=${encodeURIComponent(view)}&q=${encodeURIComponent(q)}`),
  getTicket: (id: number) => request<TicketDetail>(`/api/tickets/${id}`),
  claimTicket: (id: number) => request<{ ok: boolean; ticket: any }>(`/api/tickets/${id}/claim`, { method: 'POST' }),
  releaseTicket: (id: number) => request<{ ok: boolean; ticket: any }>(`/api/tickets/${id}/release`, { method: 'POST' }),
  assignTicket: (id: number, agentId: string) =>
    request<{ ok: boolean; ticket: any }>(`/api/tickets/${id}/assign`, {
      method: 'POST',
      body: JSON.stringify({ agentId }),
    }),
  sendReply: (id: number, body: string, waitForCustomer = false) =>
    request<{ ok: boolean; ticket: any; messageId: number }>(`/api/tickets/${id}/replies`, {
      method: 'POST',
      body: JSON.stringify({ body, waitForCustomer }),
    }),
  addNote: (id: number, body: string) =>
    request<{ ok: boolean; noteId: number }>(`/api/tickets/${id}/notes`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),
  changePriority: (id: number, priority: string, reason?: string) =>
    request<{ ok: boolean; ticket: any }>(`/api/tickets/${id}/priority`, {
      method: 'POST',
      body: JSON.stringify({ priority, reason }),
    }),
  resolveTicket: (id: number) =>
    request<{ ok: boolean; ticket: any }>(`/api/tickets/${id}/resolve`, { method: 'POST' }),
  getEvents: (id: number) =>
    request<{ events: AuditEventItem[] }>(`/api/tickets/${id}/events`),

  // Admin & Reports
  getAgents: () => request<{ agents: AuthUser[] }>('/api/admin/agents'),
  getHolidays: () => request<{ holidays: Array<{ day: string; name: string }> }>('/api/admin/holidays'),
  addHoliday: (day: string, name: string) =>
    request<{ ok: boolean }>('/api/admin/holidays', {
      method: 'POST',
      body: JSON.stringify({ day, name }),
    }),
  deleteHoliday: (day: string) =>
    request<{ ok: boolean }>(`/api/admin/holidays/${day}`, { method: 'DELETE' }),
  getSlaReports: () =>
    request<{
      summary: {
        totalTickets: number;
        lateTicketsCount: number;
        onTimeTicketsCount: number;
        latePercentage: number;
        onTimePercentage: number;
      };
      byPriority: Record<string, { total: number; late: number }>;
      byAgent: Array<{ agentName: string; total: number; late: number }>;
      lateTickets: Array<{
        id: number;
        ref: string;
        subject: string;
        priority: string;
        status: string;
        assigneeName: string;
        causes: string[];
      }>;
    }>('/api/reports/sla'),
  verifyAudit: () =>
    request<{ ok: boolean; brokenAt: Array<{ ticketId: number; seq: number; reason: string }> }>('/api/audit/verify'),

  // Portal
  createPortalTicket: (data: { name: string; email: string; subject: string; description: string; severity: string }) =>
    request<{ ref: string; portalUrl: string; token: string }>('/api/portal/tickets', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getPortalTicket: (token: string) => request<PortalTicket>(`/api/portal/tickets/${token}`),
  sendPortalReply: (token: string, body: string) =>
    request<{ ok: boolean; messageId: number }>(`/api/portal/tickets/${token}/replies`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),
  reopenPortalTicket: (token: string, reason?: string) =>
    request<{ ok: boolean }>(`/api/portal/tickets/${token}/reopen`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  createFollowUp: (token: string, data?: { subject?: string; description?: string; severity?: string }) =>
    request<{ ref: string; portalUrl: string; token: string }>(`/api/portal/tickets/${token}/follow-up`, {
      method: 'POST',
      body: JSON.stringify(data || {}),
    }),
};
