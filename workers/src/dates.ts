const DAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"] as const;

export function isoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Monday of the ISO week containing `d`, in UTC.
export function mondayOf(d: Date): Date {
  const dow = d.getUTCDay();                // 0 = Sun, 1 = Mon, ...
  const diff = dow === 0 ? -6 : 1 - dow;
  const m = new Date(d);
  m.setUTCDate(m.getUTCDate() + diff);
  m.setUTCHours(0, 0, 0, 0);
  return m;
}

// Mon..Fri ISO dates for the ISO week containing `d`.
export function weekdayDates(d: Date): string[] {
  const mon = mondayOf(d);
  return [0, 1, 2, 3, 4].map(i => {
    const x = new Date(mon);
    x.setUTCDate(x.getUTCDate() + i);
    return isoDate(x);
  });
}

export function germanDay(i: number): string {
  return DAYS[(i + 1) % 7]; // 0 -> Montag, 4 -> Freitag
}
