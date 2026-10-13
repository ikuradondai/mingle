// 「画像を保存」「送る」: トリセツを canvas でその場で PNG にする。通信はしない。
// canvas.toBlob -> 共有シート（使えれば）または ダウンロード。サーバーには何も送らない。
import { COPY } from './data/torisetsu-content.js';

const WIDTH = 1080;
const MARGIN = 64;
const FONT = 'system-ui, "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif';
const INK = '#14213d';
const MUTED = '#667085';
const BLUE = '#1769e8';
const NO_LINE_START = new Set(['、', '。', '，', '．', '」', '』', '）', '！', '？', 'ー', '…']);

function wrapLines(ctx, text, maxWidth) {
  const lines = [];
  let line = '';
  for (const char of Array.from(text)) {
    const next = line + char;
    if (line && ctx.measureText(next).width > maxWidth && !NO_LINE_START.has(char)) { lines.push(line); line = char; }
    else line = next;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

// 描画命令の列を作る（高さを先に決めるため、測ってから描く）。
function layout(ctx, manual) {
  const ops = [];
  let y = 0;
  const bodyWidth = WIDTH - MARGIN * 2;
  // 表紙帯
  ctx.font = `800 62px ${FONT}`;
  const titleLines = wrapLines(ctx, manual.title, bodyWidth - 40).slice(0, 2);
  const bandHeight = 120 + titleLines.length * 76;
  ops.push({ type: 'band', height: bandHeight, titleLines });
  y = bandHeight + 52;
  const meta = manual.version;
  ctx.font = `600 30px ${FONT}`;
  for (const line of wrapLines(ctx, meta, bodyWidth)) { ops.push({ type: 'text', text: line, x: MARGIN, y, font: `600 30px ${FONT}`, color: MUTED }); y += 46; }
  y += 20;
  let skipped = 0;
  for (const section of manual.sections) {
    if (section.state === 'hidden') continue;
    if (section.state !== 'filled') { skipped += 1; continue; } // 空欄・未調査の欄は画像に出さない
    ops.push({ type: 'dash', y });
    y += 38;
    ops.push({ type: 'heading', y: y + 20, number: section.number, text: section.title, lamp: section.id === 'warning' });
    y += 70;
    ctx.font = `500 31px ${FONT}`;
    for (const line of section.lines) {
      const sub = line.kind === 'sub';
      const font = sub ? `800 30px ${FONT}` : `500 31px ${FONT}`;
      ctx.font = font;
      const rows = wrapLines(ctx, line.kind === 'bullet' ? `・${line.text}` : line.text, bodyWidth - 24);
      rows.forEach((row) => {
        ops.push({ type: 'text', text: row, x: MARGIN + 12, y: y + 31, font, color: sub ? MUTED : INK });
        y += 47;
      });
      ctx.font = `500 31px ${FONT}`;
      y += 6;
    }
    y += 14;
  }
  y += 10;
  ops.push({ type: 'dash', y });
  y += 40;
  ctx.font = `600 30px ${FONT}`;
  ops.push({ type: 'center', text: manual.warranty, y: y + 30, font: `600 30px ${FONT}`, color: MUTED });
  y += 64;
  if (skipped > 0) { ops.push({ type: 'center', text: COPY.imageRest, y: y + 30, font: `600 28px ${FONT}`, color: MUTED }); y += 56; }
  ops.push({ type: 'brand', y: y + 24 });
  y += 80;
  return { ops, height: Math.max(1350, Math.ceil(y)) };
}

function paint(ctx, plan) {
  ctx.fillStyle = '#fffdf8';
  ctx.fillRect(0, 0, WIDTH, plan.height);
  ctx.textBaseline = 'alphabetic';
  for (const op of plan.ops) {
    if (op.type === 'band') {
      ctx.fillStyle = BLUE; ctx.fillRect(0, 0, WIDTH, op.height);
      ctx.fillStyle = '#ffffff'; ctx.font = `700 30px ${FONT}`; ctx.textAlign = 'left'; ctx.fillText('取扱説明書', MARGIN, 76);
      ctx.font = `800 62px ${FONT}`;
      op.titleLines.forEach((line, index) => ctx.fillText(line, MARGIN, 150 + index * 76));
    } else if (op.type === 'text') {
      ctx.fillStyle = op.color; ctx.font = op.font; ctx.textAlign = 'left'; ctx.fillText(op.text, op.x, op.y);
    } else if (op.type === 'center') {
      ctx.fillStyle = op.color; ctx.font = op.font; ctx.textAlign = 'center'; ctx.fillText(op.text, WIDTH / 2, op.y);
    } else if (op.type === 'dash') {
      ctx.strokeStyle = '#cfc6b6'; ctx.lineWidth = 3; ctx.setLineDash([12, 10]);
      ctx.beginPath(); ctx.moveTo(MARGIN, op.y); ctx.lineTo(WIDTH - MARGIN, op.y); ctx.stroke(); ctx.setLineDash([]);
    } else if (op.type === 'heading') {
      ctx.strokeStyle = BLUE; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(MARGIN + 28, op.y + 6, 28, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = BLUE; ctx.font = `800 32px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText(String(op.number), MARGIN + 28, op.y + 18);
      ctx.fillStyle = INK; ctx.font = `800 42px ${FONT}`; ctx.textAlign = 'left'; ctx.fillText(op.text, MARGIN + 80, op.y + 20);
      if (op.lamp) { const width = ctx.measureText(op.text).width; ctx.fillStyle = '#e9b62f'; ctx.beginPath(); ctx.arc(MARGIN + 80 + width + 28, op.y + 6, 10, 0, Math.PI * 2); ctx.fill(); }
    } else if (op.type === 'brand') {
      ctx.fillStyle = MUTED; ctx.font = `700 26px ${FONT}`; ctx.textAlign = 'right'; ctx.fillText('Mingle.Cards', WIDTH - MARGIN, op.y);
    }
  }
}

export async function renderTorisetsuImage(manual) {
  if (typeof document === 'undefined') throw new Error('no-canvas');
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH; canvas.height = 2400;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no-canvas');
  const plan = layout(ctx, manual);
  canvas.height = plan.height; // 高さを変えるとコンテキストがリセットされるので、描画は後
  const draw = canvas.getContext('2d');
  paint(draw, plan);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('no-blob'))), 'image/png'));
}

function downloadBlob(blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = 'my-torisetsu.png'; link.rel = 'noopener'; link.style.display = 'none';
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}

// mode 'save'（既定）: 共有シートは出さず、必ず端末へ保存する。mode 'share': 共有シートを開く（失敗時は保存）。
export async function exportTorisetsuImage(manual, mode = 'save') {
  const blob = await renderTorisetsuImage(manual);
  if (mode === 'share') {
    const file = typeof File === 'function' ? new File([blob], 'my-torisetsu.png', { type: 'image/png' }) : null;
    if (file && typeof navigator !== 'undefined' && typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'わたしのトリセツ' });
        return 'shared';
      } catch (error) {
        if (error?.name === 'AbortError') throw error; // 共有をやめた。ダウンロードには進まない。
        // 共有できなかった（操作の有効期限切れなど）。ダウンロードに切り替える。
      }
    }
  }
  return downloadBlob(blob);
}
