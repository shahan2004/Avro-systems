import React, { useState, useEffect } from 'react';
import { api, AuthUser } from '../api';
import { Calendar, Trash2, Plus } from 'lucide-react';

interface HolidaysProps {
  user: AuthUser;
}

export const Holidays: React.FC<HolidaysProps> = () => {
  const [holidays, setHolidays] = useState<Array<{ day: string; name: string }>>([]);
  const [dayInput, setDayInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [loading, setLoading] = useState(true);

  const loadHolidays = async () => {
    try {
      const res = await api.getHolidays();
      setHolidays(res.holidays);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHolidays();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dayInput || !nameInput) return;
    try {
      await api.addHoliday(dayInput, nameInput);
      setDayInput('');
      setNameInput('');
      loadHolidays();
    } catch (err: any) {
      alert(err.message || 'Failed to add holiday');
    }
  };

  const handleDelete = async (day: string) => {
    if (!window.confirm(`Delete holiday on ${day}?`)) return;
    try {
      await api.deleteHoliday(day);
      loadHolidays();
    } catch (err: any) {
      alert(err.message || 'Failed to delete');
    }
  };

  return (
    <div className="container" style={{ maxWidth: '800px' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a' }}>Festival & Company Holidays</h1>
        <p style={{ color: '#64748b', fontSize: '0.875rem', marginTop: '4px' }}>
          Working days calculation automatically skips weekends (Saturday & Sunday) and these festival holidays.
        </p>
      </div>

      <div className="card" style={{ padding: '20px', marginBottom: '24px' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '16px' }}>Add Festival Holiday</h3>
        <form onSubmit={handleAdd} style={{ display: 'grid', gridTemplateColumns: '180px 1fr auto', gap: '12px', alignItems: 'end' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#64748b', marginBottom: '4px' }}>
              Date (YYYY-MM-DD)
            </label>
            <input
              type="date"
              value={dayInput}
              onChange={(e) => setDayInput(e.target.value)}
              required
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#64748b', marginBottom: '4px' }}>
              Holiday Name
            </label>
            <input
              type="text"
              placeholder="e.g. Diwali / Onam / Christmas"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Plus size={16} /> Add Holiday
          </button>
        </form>
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ background: '#fafafa', borderBottom: '1px solid #e2e8f0', color: '#64748b', fontSize: '0.75rem', textTransform: 'uppercase' }}>
              <th style={{ padding: '12px 16px' }}>Date</th>
              <th style={{ padding: '12px 16px' }}>Holiday Name</th>
              <th style={{ padding: '12px 16px', textAlign: 'right' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={3} style={{ padding: '24px', textAlign: 'center' }}>Loading...</td></tr>
            ) : holidays.length === 0 ? (
              <tr><td colSpan={3} style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>No holidays configured.</td></tr>
            ) : (
              holidays.map((h) => (
                <tr key={h.day} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '12px 16px', fontWeight: 600, color: '#0f172a' }}>{h.day}</td>
                  <td style={{ padding: '12px 16px', color: '#334155' }}>{h.name}</td>
                  <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                    <button
                      type="button"
                      onClick={() => handleDelete(h.day)}
                      style={{ background: 'none', border: 'none', color: '#ef4444', padding: '4px 8px' }}
                      title="Delete holiday"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
