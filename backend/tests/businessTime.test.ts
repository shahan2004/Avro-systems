import { describe, it, expect } from 'vitest';
import {
  fromIstComponents,
  getIstComponents,
  isWorkingDay,
  isWorkingInstant,
  nextWorkingStart,
  addWorkingMinutes,
  workingMinutesBetween,
  endOfWorkingDay,
} from '../src/domain/businessTime.js';

describe('Business Time Engine (IST)', () => {
  // Calendar fixture:
  // 2026-10-16: Friday
  // 2026-10-17: Saturday
  // 2026-10-18: Sunday
  // 2026-10-19: Monday
  // 2026-10-20: Tuesday (Holiday in test 4 & 5)
  // 2026-10-21: Wednesday
  const holidays = new Set(['2026-10-20']); // Tuesday is holiday

  it('1. Fri 18:00 + 270 min -> Mon 13:30. Not late at Sun 10:00', () => {
    const fri1800 = fromIstComponents(2026, 9, 16, 18, 0); // Oct is month index 9
    // Fri has 30 working minutes remaining (18:00 to 18:30).
    // Remaining 240 minutes on Mon: 09:30 + 240 min (4 hrs) = 13:30.
    const due = addWorkingMinutes(fri1800, 270, new Set());
    const dueIst = getIstComponents(due);

    expect(dueIst.dateStr).toBe('2026-10-19');
    expect(dueIst.hours).toBe(13);
    expect(dueIst.minutes).toBe(30);

    // Check Sun 10:00 is not late (Sun 10:00 is before due date Mon 13:30)
    const sun1000 = fromIstComponents(2026, 9, 18, 10, 0);
    expect(sun1000.getTime() < due.getTime()).toBe(true);
    // Working minutes elapsed between Fri 18:00 and Sun 10:00 should be only 30 min
    const wmUntilSun = workingMinutesBetween(fri1800, sun1000, new Set());
    expect(wmUntilSun).toBe(30);
  });

  it('2. Sat 11:00, low response (540) -> start Mon 09:30, due Mon 18:30 (exact-boundary rule)', () => {
    const sat1100 = fromIstComponents(2026, 9, 17, 11, 0);
    const start = nextWorkingStart(sat1100, new Set());
    const startIst = getIstComponents(start);
    expect(startIst.dateStr).toBe('2026-10-19');
    expect(startIst.hours).toBe(9);
    expect(startIst.minutes).toBe(30);

    const due = addWorkingMinutes(start, 540, new Set());
    const dueIst = getIstComponents(due);
    // Boundary rule: exactly 540 minutes from 09:30 should land on 18:30 same day, NOT next day 09:30
    expect(dueIst.dateStr).toBe('2026-10-19');
    expect(dueIst.hours).toBe(18);
    expect(dueIst.minutes).toBe(30);
  });

  it('3. Mon 09:00 (pre-open) start -> Mon 09:30', () => {
    const mon0900 = fromIstComponents(2026, 9, 19, 9, 0);
    const start = nextWorkingStart(mon0900, new Set());
    const startIst = getIstComponents(start);
    expect(startIst.dateStr).toBe('2026-10-19');
    expect(startIst.hours).toBe(9);
    expect(startIst.minutes).toBe(30);
  });

  it('4. Holiday on Tue: Mon 17:30 + 120 -> Wed 10:30', () => {
    const mon1730 = fromIstComponents(2026, 9, 19, 17, 30);
    // Mon 17:30 to 18:30 = 60 min
    // Tue is holiday
    // Wed 09:30 + 60 min = 10:30
    const due = addWorkingMinutes(mon1730, 120, holidays);
    const dueIst = getIstComponents(due);
    expect(dueIst.dateStr).toBe('2026-10-21');
    expect(dueIst.hours).toBe(10);
    expect(dueIst.minutes).toBe(30);
  });

  it('5. workingMinutesBetween across weekend and holiday', () => {
    const fri1700 = fromIstComponents(2026, 9, 16, 17, 0);
    const wed1000 = fromIstComponents(2026, 9, 21, 10, 0);
    // Fri: 17:00 to 18:30 = 90 min
    // Sat & Sun: 0 min
    // Mon: 540 min
    // Tue: 0 min (holiday)
    // Wed: 09:30 to 10:00 = 30 min
    // Total = 90 + 540 + 30 = 660 min
    const wm = workingMinutesBetween(fri1700, wed1000, holidays);
    expect(wm).toBe(660);
  });

  it('6. Urgent created Tue 14:00 -> resolution due Tue 18:30; created Sat -> Mon 18:30', () => {
    const tue1400 = fromIstComponents(2026, 9, 20, 14, 0);
    const eodTue = endOfWorkingDay(tue1400, new Set()); // No holiday for this check
    const eodTueIst = getIstComponents(eodTue);
    expect(eodTueIst.dateStr).toBe('2026-10-20');
    expect(eodTueIst.hours).toBe(18);
    expect(eodTueIst.minutes).toBe(30);

    const sat = fromIstComponents(2026, 9, 17, 10, 0);
    const eodSat = endOfWorkingDay(sat, new Set());
    const eodSatIst = getIstComponents(eodSat);
    expect(eodSatIst.dateStr).toBe('2026-10-19'); // Advances to Monday
    expect(eodSatIst.hours).toBe(18);
    expect(eodSatIst.minutes).toBe(30);
  });

  it('7. Exactly 18:30 creation -> next working day 09:30', () => {
    const fri1830 = fromIstComponents(2026, 9, 16, 18, 30);
    const start = nextWorkingStart(fri1830, new Set());
    const startIst = getIstComponents(start);
    expect(startIst.dateStr).toBe('2026-10-19');
    expect(startIst.hours).toBe(9);
    expect(startIst.minutes).toBe(30);
  });
});
