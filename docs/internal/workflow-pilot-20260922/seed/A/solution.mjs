export function selectRate(rows, date) {
  return rows.find(row => date >= row.from && (row.to === null || date < row.to)) ?? null;
}
