/**
 * Monthly report generator — produces a branded PDF for a restaurant.
 *
 * V1: pulls totals + per-dish leaderboard + peak day/hour, renders simple PDF.
 * V2 (post-launch): swap to pdf-lib for richer layout, charts, cover page.
 */

export async function renderMonthlyReport(restaurant, period, env) {
  // period: 'YYYY-MM'
  const [yyyy, mm] = period.split('-').map(Number);
  const start = Math.floor(Date.UTC(yyyy, mm - 1, 1) / 1000);
  const end = Math.floor(Date.UTC(yyyy, mm, 1) / 1000);

  const totals = await env.DB.prepare(
    `SELECT COUNT(*) AS scans, SUM(ar_activated) AS ar
     FROM scans WHERE restaurant_id = ? AND ts >= ? AND ts < ?`
  ).bind(restaurant.id, start, end).first();

  const { results: dishLeaderboard } = await env.DB.prepare(
    `SELECT d.name, COUNT(s.id) AS scans
     FROM dishes d LEFT JOIN scans s
       ON s.dish_id = d.id AND s.ts >= ? AND s.ts < ?
     WHERE d.restaurant_id = ?
     GROUP BY d.id ORDER BY scans DESC LIMIT 10`
  ).bind(start, end, restaurant.id).all();

  const { results: hourly } = await env.DB.prepare(
    `SELECT strftime('%w', ts, 'unixepoch') AS dow,
            strftime('%H', ts, 'unixepoch') AS hr,
            COUNT(*) AS n
     FROM scans WHERE restaurant_id = ? AND ts >= ? AND ts < ?
     GROUP BY dow, hr ORDER BY n DESC LIMIT 1`
  ).bind(restaurant.id, start, end).all();

  const peak = hourly[0] || { dow: '-', hr: '-', n: 0 };
  const dowName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][peak.dow] || '-';

  const lines = [
    `AR Menu — Monthly Performance Report`,
    `${restaurant.name}`,
    `Period: ${period}`,
    ``,
    `Total scans: ${totals?.scans || 0}`,
    `AR activations: ${totals?.ar || 0}`,
    `Peak: ${dowName} @ ${peak.hr}:00 (${peak.n} scans)`,
    ``,
    `Top dishes:`,
    ...dishLeaderboard.map((d, i) => `${i + 1}. ${d.name} — ${d.scans} scans`)
  ];

  return renderTextPDF(lines, restaurant);
}

function renderTextPDF(lines, restaurant) {
  const W = 595, H = 842; // A4
  let y = H - 80;
  const fontMain = 'F1';
  const out = [];

  // Background bar
  out.push(`q 0.024 0.020 0.016 rg 0 0 ${W} ${H} re f Q`);
  // Brand bar
  out.push(`q 1 0.341 0.133 rg 0 ${H - 30} ${W} 30 re f Q`);
  out.push(`BT 1 1 1 rg /${fontMain} 11 Tf 32 ${H - 21} Td (AR MENU \\267 MONTHLY REPORT \\267 ${restaurant.name}) Tj ET`);

  // Title
  out.push(`BT 0.961 0.937 0.902 rg /${fontMain} 24 Tf 32 ${y} Td (Monthly Performance Report) Tj ET`); y -= 28;
  out.push(`BT 0.604 0.576 0.533 rg /${fontMain} 12 Tf 32 ${y} Td (${restaurant.name}) Tj ET`); y -= 36;

  // Body lines
  out.push(`BT 0.961 0.937 0.902 rg /${fontMain} 11 Tf 32 ${y} Td`);
  for (let i = 3; i < lines.length; i++) {
    const ln = String(lines[i]).replace(/[()\\]/g, ' ');
    out.push(`(${ln}) Tj 0 -16 Td`);
  }
  out.push(`ET`);

  // Footer
  out.push(`BT 0.339 0.310 0.271 rg /${fontMain} 9 Tf 32 32 Td (armenu.co.za \\267 Generated automatically) Tj ET`);

  const stream = out.join('\n');
  const enc = new TextEncoder();
  const objs = [
    `<< /Type /Catalog /Pages 2 0 R >>`,
    `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`
  ];
  let pdf = '%PDF-1.4\n';
  const off = [];
  objs.forEach((o, i) => { off.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  off.forEach(o => { pdf += String(o).padStart(10, '0') + ' 00000 n \n'; });
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return enc.encode(pdf);
}
