type Rgb255 = { r: number; g: number; b: number };

const blkThrs = 0.022;
const blkClmp = 1.414;
const deltaYmin = 0.0005;
const scaleBoW = 1.14;
const scaleWoB = 1.14;
const normBG = 0.56;
const normTXT = 0.57;
const revBG = 0.65;
const revTXT = 0.62;
const loClip = 0.1;
const loBoWoffset = 0.027;
const loWoBoffset = 0.027;

function parseHex255(hex: string): Rgb255 {
  const s = hex.trim();
  const short = /^#([0-9a-fA-F]{3})$/.exec(s);
  if (short) {
    const [r, g, b] = short[1].split("").map((ch) => Number.parseInt(ch + ch, 16));
    return { r, g, b };
  }

  const long = /^#([0-9a-fA-F]{6})$/.exec(s);
  if (long) {
    return {
      r: Number.parseInt(long[1].slice(0, 2), 16),
      g: Number.parseInt(long[1].slice(2, 4), 16),
      b: Number.parseInt(long[1].slice(4, 6), 16),
    };
  }

  throw new Error(`Invalid hex color: ${hex}`);
}

function apcaY(hex: string): number {
  const { r, g, b } = parseHex255(hex);
  const y =
    0.2126729 * Math.pow(r / 255, 2.4) +
    0.7151522 * Math.pow(g / 255, 2.4) +
    0.072175 * Math.pow(b / 255, 2.4);
  return y < blkThrs ? y + Math.pow(blkThrs - y, blkClmp) : y;
}

export function apcaLc(textHex: string, bgHex: string): number {
  const txtY = apcaY(textHex);
  const bgY = apcaY(bgHex);

  if (Math.abs(bgY - txtY) < deltaYmin) {
    return 0;
  }

  if (bgY > txtY) {
    const sapc = (Math.pow(bgY, normBG) - Math.pow(txtY, normTXT)) * scaleBoW;
    return (sapc < loClip ? 0 : sapc - loBoWoffset) * 100;
  }

  const sapc = (Math.pow(bgY, revBG) - Math.pow(txtY, revTXT)) * scaleWoB;
  return (sapc > -loClip ? 0 : sapc + loWoBoffset) * 100;
}
