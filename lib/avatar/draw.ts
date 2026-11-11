import type { AvatarSpec } from './avatar-spec';

const INK = '#1F2937';

/**
 * Draws `spec` into a square of `size` CSS px on `ctx` (caller sets any device-pixel scaling).
 * Uses only basic path calls (no Path2D / roundRect) so it works on older mobile browsers.
 */
export function drawAvatar(ctx: CanvasRenderingContext2D, spec: AvatarSpec, size: number): void {
  const s = size / 100; // draw in a 100x100 design space
  ctx.save();
  ctx.scale(s, s);
  ctx.clearRect(0, 0, 100, 100);

  // Background disc.
  ctx.fillStyle = spec.background;
  ctx.beginPath();
  ctx.arc(50, 50, 50, 0, Math.PI * 2);
  ctx.fill();

  if (spec.accessory === 'headphones') drawHeadphonesBand(ctx);
  drawFace(ctx, spec);
  drawEyes(ctx, spec);
  drawMouth(ctx, spec);
  drawAccessory(ctx, spec);

  ctx.restore();
}

function drawFace(ctx: CanvasRenderingContext2D, spec: AvatarSpec): void {
  ctx.fillStyle = spec.skin;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  switch (spec.faceShape) {
    case 'round':
      ctx.arc(50, 54, 30, 0, Math.PI * 2);
      break;
    case 'egg':
      ctx.ellipse(50, 55, 26, 32, 0, 0, Math.PI * 2);
      break;
    case 'bean':
      ctx.ellipse(50, 56, 33, 26, 0, 0, Math.PI * 2);
      break;
    case 'squircle': {
      const [x, y, w, h, r] = [21, 25, 58, 58, 20];
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      break;
    }
    case 'blob':
      ctx.moveTo(50, 24);
      ctx.bezierCurveTo(72, 22, 84, 40, 80, 58);
      ctx.bezierCurveTo(77, 76, 64, 86, 48, 85);
      ctx.bezierCurveTo(30, 84, 18, 72, 20, 54);
      ctx.bezierCurveTo(22, 36, 32, 25, 50, 24);
      break;
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Cheeks.
  ctx.fillStyle = 'rgba(244, 114, 182, 0.35)';
  for (const cx of [35, 65]) {
    ctx.beginPath();
    ctx.ellipse(cx, 63, 5, 3, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function arcLine(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, from: number, to: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, from, to);
  ctx.stroke();
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const px = x + rad * Math.cos(a);
    const py = y + rad * Math.sin(a);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

function drawEyes(ctx: CanvasRenderingContext2D, spec: AvatarSpec): void {
  ctx.fillStyle = INK;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  const [lx, rx, y] = [40, 60, 50];
  switch (spec.eyes) {
    case 'dots':
      dot(ctx, lx, y, 3);
      dot(ctx, rx, y, 3);
      break;
    case 'wide':
      for (const x of [lx, rx]) {
        ctx.fillStyle = '#FFFFFF';
        dot(ctx, x, y, 6);
        ctx.stroke();
        ctx.fillStyle = INK;
        dot(ctx, x + 1, y + 1, 2.8);
      }
      break;
    case 'sleepy':
      arcLine(ctx, lx, y - 2, 5, 0.15 * Math.PI, 0.85 * Math.PI);
      arcLine(ctx, rx, y - 2, 5, 0.15 * Math.PI, 0.85 * Math.PI);
      break;
    case 'happy':
      arcLine(ctx, lx, y + 3, 5, 1.15 * Math.PI, 1.85 * Math.PI);
      arcLine(ctx, rx, y + 3, 5, 1.15 * Math.PI, 1.85 * Math.PI);
      break;
    case 'wink':
      dot(ctx, lx, y, 3);
      arcLine(ctx, rx, y + 3, 5, 1.15 * Math.PI, 1.85 * Math.PI);
      break;
    case 'star':
      ctx.fillStyle = '#F59E0B';
      star(ctx, lx, y, 6);
      star(ctx, rx, y, 6);
      break;
  }
}

function drawMouth(ctx: CanvasRenderingContext2D, spec: AvatarSpec): void {
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  const [x, y] = [50, 66];
  switch (spec.mouth) {
    case 'smile':
      arcLine(ctx, x, y - 4, 8, 0.2 * Math.PI, 0.8 * Math.PI);
      break;
    case 'grin':
      ctx.beginPath();
      ctx.arc(x, y - 3, 9, 0, Math.PI);
      ctx.closePath();
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.stroke();
      break;
    case 'open':
      ctx.beginPath();
      ctx.ellipse(x, y + 1, 5, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'flat':
      ctx.beginPath();
      ctx.moveTo(x - 7, y);
      ctx.lineTo(x + 7, y);
      ctx.stroke();
      break;
    case 'tongue':
      arcLine(ctx, x, y - 4, 8, 0.2 * Math.PI, 0.8 * Math.PI);
      ctx.fillStyle = '#F87171';
      ctx.beginPath();
      ctx.ellipse(x + 2, y + 5, 3.5, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'whistle':
      ctx.beginPath();
      ctx.arc(x + 3, y, 3.5, 0, Math.PI * 2);
      ctx.stroke();
      break;
  }
}

function drawHeadphonesBand(ctx: CanvasRenderingContext2D): void {
  ctx.strokeStyle = '#374151';
  ctx.lineWidth = 5;
  arcLine(ctx, 50, 54, 36, 1.05 * Math.PI, 1.95 * Math.PI);
}

function drawAccessory(ctx: CanvasRenderingContext2D, spec: AvatarSpec): void {
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  switch (spec.accessory) {
    case 'none':
      return;
    case 'headphones':
      ctx.fillStyle = '#EF4444';
      for (const x of [16, 76]) {
        ctx.beginPath();
        ctx.ellipse(x + 4, 56, 7, 11, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      return;
    case 'glasses':
      ctx.strokeStyle = '#111827';
      for (const x of [40, 60]) arcLine(ctx, x, 50, 8, 0, Math.PI * 2);
      ctx.beginPath();
      ctx.moveTo(48, 50);
      ctx.lineTo(52, 50);
      ctx.stroke();
      return;
    case 'cap':
      ctx.fillStyle = '#3B82F6';
      ctx.beginPath();
      ctx.arc(50, 34, 22, Math.PI, Math.PI * 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(62, 34, 18, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      return;
    case 'bow':
      ctx.fillStyle = '#EC4899';
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(66, 28);
        ctx.lineTo(66 + dir * 11, 21);
        ctx.lineTo(66 + dir * 11, 35);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      dot(ctx, 66, 28, 3.5);
      return;
    case 'note':
      ctx.fillStyle = '#7C3AED';
      ctx.strokeStyle = '#7C3AED';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(77, 30, 5, 4, -0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(81.5, 29);
      ctx.lineTo(81.5, 12);
      ctx.lineTo(89, 16);
      ctx.stroke();
      return;
    case 'crown':
      ctx.fillStyle = '#FBBF24';
      ctx.beginPath();
      ctx.moveTo(34, 30);
      ctx.lineTo(36, 14);
      ctx.lineTo(43, 23);
      ctx.lineTo(50, 11);
      ctx.lineTo(57, 23);
      ctx.lineTo(64, 14);
      ctx.lineTo(66, 30);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      return;
  }
}
