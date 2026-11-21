export const TZ_OFFSET_MIN = 330; // IST is UTC+05:30 (330 minutes)
export const DAY_START_MIN = 9 * 60 + 30; // 09:30 (570 min)
export const DAY_END_MIN = 18 * 60 + 30; // 18:30 (1110 min)
export const DAY_WORKING_MIN = DAY_END_MIN - DAY_START_MIN; // 540 min (9 hours)

export type Holidays = Set<string>; // Set of 'YYYY-MM-DD' strings

interface IstComponents {
  year: number;
  month: number; // 0-11
  date: number; // 1-31
  dayOfWeek: number; // 0=Sun, 6=Sat
  hours: number;
  minutes: number;
  seconds: number;
  ms: number;
  dateStr: string; // 'YYYY-MM-DD'
  minuteOfDay: number;
}

export function getIstComponents(d: Date): IstComponents {
  const istMs = d.getTime() + TZ_OFFSET_MIN * 60 * 1000;
  const istDate = new Date(istMs);

  const year = istDate.getUTCFullYear();
  const month = istDate.getUTCMonth();
  const date = istDate.getUTCDate();
  const dayOfWeek = istDate.getUTCDay();
  const hours = istDate.getUTCHours();
  const minutes = istDate.getUTCMinutes();
  const seconds = istDate.getUTCSeconds();
  const ms = istDate.getUTCMilliseconds();

  const mm = String(month + 1).padStart(2, '0');
  const dd = String(date).padStart(2, '0');
  const dateStr = `${year}-${mm}-${dd}`;
  const minuteOfDay = hours * 60 + minutes + (seconds * 1000 + ms) / 60000;

  return { year, month, date, dayOfWeek, hours, minutes, seconds, ms, dateStr, minuteOfDay };
}

export function fromIstComponents(
  year: number,
  month: number,
  date: number,
  hours = 0,
  minutes = 0,
  seconds = 0,
  ms = 0
): Date {
  const utcMs = Date.UTC(year, month, date, hours, minutes, seconds, ms) - TZ_OFFSET_MIN * 60 * 1000;
  return new Date(utcMs);
}

export function isWorkingDay(d: Date, holidays: Holidays = new Set()): boolean {
  const ist = getIstComponents(d);
  if (ist.dayOfWeek === 0 || ist.dayOfWeek === 6) {
    return false;
  }
  if (holidays.has(ist.dateStr)) {
    return false;
  }
  return true;
}

export function isWorkingInstant(d: Date, holidays: Holidays = new Set()): boolean {
  if (!isWorkingDay(d, holidays)) {
    return false;
  }
  const ist = getIstComponents(d);
  return ist.minuteOfDay >= DAY_START_MIN && ist.minuteOfDay < DAY_END_MIN;
}

export function nextWorkingStart(d: Date, holidays: Holidays = new Set()): Date {
  if (isWorkingInstant(d, holidays)) {
    return d;
  }

  const ist = getIstComponents(d);
  // If it's a working day and before 09:30
  if (isWorkingDay(d, holidays) && ist.minuteOfDay < DAY_START_MIN) {
    return fromIstComponents(ist.year, ist.month, ist.date, 9, 30, 0, 0);
  }

  // Otherwise advance to the next working day 09:30
  let check = fromIstComponents(ist.year, ist.month, ist.date + 1, 9, 30, 0, 0);
  while (!isWorkingDay(check, holidays)) {
    const cIst = getIstComponents(check);
    check = fromIstComponents(cIst.year, cIst.month, cIst.date + 1, 9, 30, 0, 0);
  }
  return check;
}

export function endOfWorkingDay(d: Date, holidays: Holidays = new Set()): Date {
  const start = nextWorkingStart(d, holidays);
  const ist = getIstComponents(start);
  return fromIstComponents(ist.year, ist.month, ist.date, 18, 30, 0, 0);
}

export function addWorkingMinutes(start: Date, minutes: number, holidays: Holidays = new Set()): Date {
  if (minutes <= 0) {
    return nextWorkingStart(start, holidays);
  }

  let current = nextWorkingStart(start, holidays);
  let remaining = minutes;

  while (remaining > 0) {
    const ist = getIstComponents(current);
    const minutesLeftToday = DAY_END_MIN - ist.minuteOfDay;

    if (remaining <= minutesLeftToday) {
      // If remaining minutes hit exactly 0 at 18:30, return 18:30 same day
      return new Date(current.getTime() + remaining * 60 * 1000);
    }

    remaining -= minutesLeftToday;
    // Advance to next working day 09:30
    let nextDay = fromIstComponents(ist.year, ist.month, ist.date + 1, 9, 30, 0, 0);
    while (!isWorkingDay(nextDay, holidays)) {
      const nIst = getIstComponents(nextDay);
      nextDay = fromIstComponents(nIst.year, nIst.month, nIst.date + 1, 9, 30, 0, 0);
    }
    current = nextDay;
  }

  return current;
}

export function workingMinutesBetween(a: Date, b: Date, holidays: Holidays = new Set()): number {
  if (b.getTime() <= a.getTime()) {
    return 0;
  }

  let current = nextWorkingStart(a, holidays);
  if (current.getTime() >= b.getTime()) {
    return 0;
  }

  let totalMinutes = 0;

  while (current.getTime() < b.getTime()) {
    const ist = getIstComponents(current);
    if (isWorkingDay(current, holidays)) {
      const dayEnd = fromIstComponents(ist.year, ist.month, ist.date, 18, 30, 0, 0);
      const segmentEnd = b.getTime() < dayEnd.getTime() ? b : dayEnd;
      if (segmentEnd.getTime() > current.getTime()) {
        totalMinutes += (segmentEnd.getTime() - current.getTime()) / 60000;
      }
    }

    // Advance to next working day at 09:30
    let nextDay = fromIstComponents(ist.year, ist.month, ist.date + 1, 9, 30, 0, 0);
    while (!isWorkingDay(nextDay, holidays) && nextDay.getTime() < b.getTime()) {
      const nIst = getIstComponents(nextDay);
      nextDay = fromIstComponents(nIst.year, nIst.month, nIst.date + 1, 9, 30, 0, 0);
    }
    current = nextDay;
  }

  return Math.round(totalMinutes * 1000) / 1000;
}
