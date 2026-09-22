export function selectRate(rows, date) {
  let match = null;
  for (const row of rows) {
    if (date >= row.from && (row.to === null || date <= row.to)) {
      if (match !== null) return null;
      match = row;
    }
  }
  return match;
}
