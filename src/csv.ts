// RFC 4180 compliant CSV parser for the Items import feature.
// Handles quoted fields, embedded commas, escaped quotes (""), and CRLF.

export type CSVRow = Record<string, string>;

export function parseCSV(text: string): CSVRow[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n');
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]!);
  return lines
    .slice(1)
    .map(line => {
      const vals = parseCSVLine(line);
      const row: CSVRow = {};
      headers.forEach((h, i) => {
        row[h.trim().toLowerCase()] = (vals[i] || '').trim();
      });
      return row;
    })
    .filter(r => r['name']);
}

export function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
    } else if (ch === ',' && !inQ) {
      result.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}
