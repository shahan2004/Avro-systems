import React, { useState } from 'react';
import { Send, Lock, AlertCircle } from 'lucide-react';

interface ComposerProps {
  customerEmail: string;
  onSendReply: (body: string, waitForCustomer: boolean) => Promise<void>;
  onAddNote: (body: string) => Promise<void>;
  disabled?: boolean;
}

export const Composer: React.FC<ComposerProps> = ({
  customerEmail,
  onSendReply,
  onAddNote,
  disabled = false,
}) => {
  const [activeTab, setActiveTab] = useState<'reply' | 'note'>('reply');
  const [replyText, setReplyText] = useState('');
  const [noteText, setNoteText] = useState('');
  const [waitForCustomer, setWaitForCustomer] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleReplySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim() || isSubmitting) return;

    try {
      setIsSubmitting(true);
      await onSendReply(replyText.trim(), waitForCustomer);
      setReplyText('');
      setWaitForCustomer(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleNoteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteText.trim() || isSubmitting) return;

    try {
      setIsSubmitting(true);
      await onAddNote(noteText.trim());
      setNoteText('');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      {/* INC-0304: Distinct separate composer tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
        <button
          type="button"
          onClick={() => setActiveTab('reply')}
          style={{
            flex: 1,
            padding: '12px 16px',
            border: 'none',
            borderBottom: activeTab === 'reply' ? '2px solid #2563eb' : '2px solid transparent',
            background: activeTab === 'reply' ? '#fff' : 'transparent',
            color: activeTab === 'reply' ? '#2563eb' : '#64748b',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            borderRadius: 0,
          }}
        >
          <Send size={16} /> Reply to Customer
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('note')}
          style={{
            flex: 1,
            padding: '12px 16px',
            border: 'none',
            borderBottom: activeTab === 'note' ? '2px solid #d97706' : '2px solid transparent',
            background: activeTab === 'note' ? '#fffbeb' : 'transparent',
            color: activeTab === 'note' ? '#b45309' : '#64748b',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            borderRadius: 0,
          }}
        >
          <Lock size={16} /> Team-Only Note
        </button>
      </div>

      <div style={{ padding: '16px' }}>
        {activeTab === 'reply' ? (
          <form onSubmit={handleReplySubmit}>
            <div style={{ fontSize: '0.8125rem', color: '#64748b', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span>Public Message • Sent to:</span>
              <strong style={{ color: '#0f172a' }}>{customerEmail}</strong>
            </div>
            <textarea
              rows={4}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="Type your message to the customer..."
              disabled={disabled || isSubmitting}
              required
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', cursor: 'pointer', userSelect: 'none' }}>
                <input
                  type="checkbox"
                  style={{ width: 'auto' }}
                  checked={waitForCustomer}
                  onChange={(e) => setWaitForCustomer(e.target.checked)}
                  disabled={disabled || isSubmitting}
                />
                <span>Waiting for customer's answer (pauses SLA resolution clock)</span>
              </label>

              <button type="submit" className="btn-primary" disabled={disabled || isSubmitting || !replyText.trim()}>
                {isSubmitting ? 'Sending...' : 'Send to Customer'}
              </button>
            </div>
          </form>
        ) : (
          /* INC-0304: Distinct yellow styling with prominent warning banner */
          <form onSubmit={handleNoteSubmit}>
            <div
              style={{
                background: '#fef3c7',
                border: '1px solid #fcd34d',
                borderRadius: '6px',
                padding: '8px 12px',
                marginBottom: '10px',
                color: '#92400e',
                fontSize: '0.8125rem',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontWeight: 600,
              }}
            >
              <Lock size={16} />
              <span>TEAM ONLY — Customer cannot see this note (not on screen, API, or transcript).</span>
            </div>
            <textarea
              rows={4}
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Write an internal note for Arvo team members..."
              style={{ background: '#fffbeb', borderColor: '#fcd34d' }}
              disabled={disabled || isSubmitting}
              required
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px' }}>
              <button
                type="submit"
                style={{ background: '#d97706', color: '#fff' }}
                disabled={disabled || isSubmitting || !noteText.trim()}
              >
                {isSubmitting ? 'Saving...' : 'Add Team Note'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
