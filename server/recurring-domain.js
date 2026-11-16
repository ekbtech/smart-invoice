function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError("Schedule dates must use YYYY-MM-DD format.");
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new RangeError("The schedule date is invalid.");
  }
  return { year, month: month - 1, day, date };
}

function formatDate(year, month, day) {
  return `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function addRecurringFrequency(value, frequency, anchorDay) {
  const current = parseDate(value);
  if (frequency === "weekly") {
    current.date.setUTCDate(current.day + 7);
    return formatDate(current.date.getUTCFullYear(), current.date.getUTCMonth(), current.date.getUTCDate());
  }

  const monthSteps = { monthly: 1, quarterly: 3, yearly: 12 }[frequency];
  if (!monthSteps) throw new RangeError("The recurring invoice frequency is invalid.");
  if (!Number.isInteger(anchorDay) || anchorDay < 1 || anchorDay > 31) throw new RangeError("The recurring invoice anchor day is invalid.");
  const monthIndex = current.year * 12 + current.month + monthSteps;
  const year = Math.floor(monthIndex / 12);
  const month = monthIndex % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return formatDate(year, month, Math.min(anchorDay, lastDay));
}

export function addDays(value, days) {
  const { date } = parseDate(value);
  if (!Number.isInteger(days) || days < 0 || days > 365) throw new RangeError("Payment terms must be between 0 and 365 days.");
  date.setUTCDate(date.getUTCDate() + days);
  return formatDate(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}
