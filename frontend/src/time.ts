export function formatIST(dateStrOrObj?: string | Date | null): string {
  if (!dateStrOrObj) return 'N/A';
  const d = new Date(dateStrOrObj);
  if (isNaN(d.getTime())) return 'N/A';

  const parts = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d);

  return `${parts} IST`;
}

export function formatISTShort(dateStrOrObj?: string | Date | null): string {
  if (!dateStrOrObj) return 'N/A';
  const d = new Date(dateStrOrObj);
  if (isNaN(d.getTime())) return 'N/A';

  const parts = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);

  return `${parts} IST`;
}

export function formatWorkingMinutes(wm: number): string {
  const abs = Math.abs(Math.round(wm));
  const hours = Math.floor(abs / 60);
  const mins = abs % 60;

  if (hours === 0) {
    return `${mins}m`;
  }
  if (mins === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${mins}m`;
}
