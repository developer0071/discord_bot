import { formatDate, getAvatarColor, getInitials } from './helpers';

// ── CSV Export ──
export function exportCSV(members) {
  const esc = (v) => '"' + String(v || '').replace(/"/g, '""') + '"';
  let csv = '\uFEFF'; // UTF-8 BOM for Excel
  csv += 'sep=,\r\n'; // Force Excel to recognize comma as delimiter
  csv += [esc('Discord'), esc('Roblox'), esc('Status'), esc('Joined'), esc('Feedback'), esc('Notes')].join(',') + '\r\n';
  members.forEach(m => {
    csv += [esc(m.discord), esc(m.roblox), esc(m.status), esc(formatDate(m.joined)), esc(m.feedback), esc(m.notes)].join(',') + '\r\n';
  });
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'moonlight_soldiers_members.csv'; a.click();
  URL.revokeObjectURL(url);
  return members.length;
}

// ── PNG Export (A4 high-resolution canvas) ──
export function exportPNG(allMembers) {
  if (allMembers.length === 0) return 0;

  const W = 2480, margin = 80;
  const usable = W - margin * 2;
  const headerH = 140, colHeaderH = 52, rowH = 44, footerH = 70;
  const totalRows = allMembers.length;
  const tableH = colHeaderH + totalRows * rowH;
  const H = Math.max(3508, headerH + tableH + footerH + margin * 2 + 40);

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#0e1117';
  ctx.fillRect(0, 0, W, H);

  const grad = ctx.createLinearGradient(margin, margin, W - margin, margin + headerH);
  grad.addColorStop(0, '#1a1d27'); grad.addColorStop(1, '#12141c');
  roundRect(ctx, margin, margin, usable, headerH, 16);
  ctx.fillStyle = grad; ctx.fill();
  ctx.strokeStyle = 'rgba(139,92,246,0.35)'; ctx.lineWidth = 2; ctx.stroke();

  ctx.fillStyle = '#f5f5f7'; ctx.font = 'bold 42px "Segoe UI", Arial, sans-serif';
  ctx.fillText('☾ Moonlight Soldiers — Member Roster', margin + 36, margin + 58);
  ctx.fillStyle = '#8b8fa3'; ctx.font = '26px "Segoe UI", Arial, sans-serif';
  ctx.fillText(`${allMembers.length} members  •  Exported ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`, margin + 36, margin + 100);

  const cols = [
    { label: '#', w: 70 },
    { label: 'Discord', w: 480 },
    { label: 'Roblox Username', w: 480 },
    { label: 'Status', w: 280 },
    { label: 'Joined', w: 340 },
    { label: 'Feedback', w: usable - 70 - 480 - 480 - 280 - 340 },
  ];

  const tableTop = margin + headerH + 24;
  let x0 = margin;

  roundRect(ctx, margin, tableTop, usable, colHeaderH, [12, 12, 0, 0]);
  ctx.fillStyle = '#161922'; ctx.fill();
  ctx.strokeStyle = 'rgba(90,106,128,0.3)'; ctx.lineWidth = 1; ctx.stroke();

  ctx.fillStyle = '#8b8fa3'; ctx.font = 'bold 22px "Segoe UI", Arial, sans-serif';
  x0 = margin;
  cols.forEach(c => { ctx.fillText(c.label, x0 + 16, tableTop + 34); x0 += c.w; });

  const statusColors = {
    active: { bg: 'rgba(16,185,129,0.14)', text: '#34d399', label: 'In Regiment' },
    pending: { bg: 'rgba(245,158,11,0.14)', text: '#fbbf24', label: 'Pending' },
    inactive: { bg: 'rgba(107,114,128,0.14)', text: '#9ca3af', label: 'Inactive' },
    kicked: { bg: 'rgba(239,68,68,0.14)', text: '#f87171', label: 'Kicked' },
  };

  allMembers.forEach((m, i) => {
    const ry = tableTop + colHeaderH + i * rowH;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(22,25,34,0.6)' : 'rgba(30,33,44,0.5)';
    if (i === allMembers.length - 1) {
      roundRect(ctx, margin, ry, usable, rowH, [0, 0, 12, 12]); ctx.fill();
    } else {
      ctx.fillRect(margin, ry, usable, rowH);
    }
    ctx.strokeStyle = 'rgba(90,106,128,0.12)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(margin, ry + rowH); ctx.lineTo(margin + usable, ry + rowH); ctx.stroke();

    x0 = margin;
    const ty = ry + 30;

    ctx.fillStyle = '#5a6a80'; ctx.font = '20px "Segoe UI", Arial, sans-serif';
    ctx.fillText(String(i + 1), x0 + 16, ty);
    x0 += cols[0].w;

    ctx.fillStyle = '#f5f5f7'; ctx.font = '600 22px "Segoe UI", Arial, sans-serif';
    ctx.fillText(truncate(ctx, m.discord, cols[1].w - 32), x0 + 16, ty);
    x0 += cols[1].w;

    ctx.fillStyle = '#c8ccd4'; ctx.font = '22px "Segoe UI", Arial, sans-serif';
    ctx.fillText(truncate(ctx, m.roblox, cols[2].w - 32), x0 + 16, ty);
    x0 += cols[2].w;

    const st = statusColors[m.status] || statusColors.active;
    const badgeW = Math.min(ctx.measureText(st.label).width + 28, cols[3].w - 20);
    roundRect(ctx, x0 + 12, ry + 10, badgeW, 26, 6);
    ctx.fillStyle = st.bg; ctx.fill();
    ctx.fillStyle = st.text; ctx.font = 'bold 17px "Segoe UI", Arial, sans-serif';
    ctx.fillText(st.label, x0 + 26, ry + 29);
    x0 += cols[3].w;

    ctx.fillStyle = '#8b8fa3'; ctx.font = '20px "Segoe UI", Arial, sans-serif';
    ctx.fillText(formatDate(m.joined), x0 + 16, ty);
    x0 += cols[4].w;

    ctx.fillStyle = '#6b7280'; ctx.font = '19px "Segoe UI", Arial, sans-serif';
    ctx.fillText(truncate(ctx, m.feedback || '—', cols[5].w - 32), x0 + 16, ty);
  });

  roundRect(ctx, margin, tableTop, usable, colHeaderH + totalRows * rowH, 12);
  ctx.strokeStyle = 'rgba(90,106,128,0.25)'; ctx.lineWidth = 2; ctx.stroke();

  const footY = tableTop + colHeaderH + totalRows * rowH + 28;
  ctx.fillStyle = '#3d4150'; ctx.font = '20px "Segoe UI", Arial, sans-serif';
  ctx.fillText(`Generated by Moonlight Soldiers Dashboard  •  ${new Date().toLocaleString()}`, margin + 8, footY + 24);

  canvas.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'moonlight_soldiers_members.png'; a.click();
    URL.revokeObjectURL(url);
  }, 'image/png');

  return allMembers.length;
}

function roundRect(ctx, x, y, w, h, r) {
  if (typeof r === 'number') r = [r, r, r, r];
  ctx.beginPath();
  ctx.moveTo(x + r[0], y);
  ctx.lineTo(x + w - r[1], y);
  ctx.arcTo(x + w, y, x + w, y + r[1], r[1]);
  ctx.lineTo(x + w, y + h - r[2]);
  ctx.arcTo(x + w, y + h, x + w - r[2], y + h, r[2]);
  ctx.lineTo(x + r[3], y + h);
  ctx.arcTo(x, y + h, x, y + h - r[3], r[3]);
  ctx.lineTo(x, y + r[0]);
  ctx.arcTo(x, y, x + r[0], y, r[0]);
  ctx.closePath();
}

function truncate(ctx, text, maxW) {
  if (!text) return '—';
  if (ctx.measureText(text).width <= maxW) return text;
  while (text.length > 0 && ctx.measureText(text + '…').width > maxW) text = text.slice(0, -1);
  return text + '…';
}
