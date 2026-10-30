/**
 * 分享海报渲染：把一张卡片画成 1080×1920 的 PNG。
 * 深色展厅底 + 顶部暖光；卡片居中带阴影；下方系列/角色/款式/日期；底部站点名与免责声明。
 * 隐藏款在卡片后方加金色光晕。只画一张图就收工，不碰 DOM。
 */

const W = 1080;
const H = 1920;
const MARGIN = 96; // 卡片四周留边
const BG = '#0B0B0D';
const GOLD = '#C8A96A';
const GOLD_SECRET = '#E8C87A';
const TEXT = '#EDE9E3';
const MUTED = '#8C8780';

// 只用系统字体（站点令牌同款字体族），中文回退到系统 CJK 字形，不引外部字体。
const SANS = '"PingFang SC", "Noto Sans SC", sans-serif';
const SERIF = '"Songti SC", "Noto Serif SC", STSong, serif';

/** 本地日期 'YYYY-MM-DD' → '2026 年 10 月 29 日'；不合法时原样返回。 */
function formatDateCn(date) {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(date ?? ''));
  if (!match) return String(date ?? '');
  return `${Number(match[1])} 年 ${Number(match[2])} 月 ${Number(match[3])} 日`;
}

/** 解码图片 Blob（失败返回 null，由调用方统一抛错）。 */
async function decodeImage(blob) {
  try {
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}

/** 有 letterSpacing 能力就用（大字距的效果）；否则原地保持默认。 */
function setLetterSpacing(ctx, value) {
  try {
    ctx.letterSpacing = value;
  } catch {
    /* 不支持就默认字距 */
  }
}

/**
 * 系列名逐级缩字号，保证不溢出内容区。
 * @returns {{ text: string, size: number }}
 */
function fitSeries(ctx, series, maxWidth) {
  let size = 56;
  for (;;) {
    ctx.font = `600 ${size}px ${SERIF}`;
    if (ctx.measureText(series).width <= maxWidth || size <= 32) {
      return { text: series, size };
    }
    size -= 4;
  }
}

/**
 * 渲染一张分享海报。
 * @param {object} card - Card 元数据（series / character / style / pulledAt）
 * @param {Blob} imageBlob - 卡片图
 * @returns {Promise<Blob>} 1080×1920 PNG
 * @throws {Error} 生成失败抛「海报生成失败」
 */
export function renderPoster(card, imageBlob) {
  return doRender(card, imageBlob).catch((error) => {
    if (error instanceof Error && error.message === '海报生成失败') throw error;
    throw new Error('海报生成失败');
  });
}

async function doRender(card, imageBlob) {
  if (!card || !(imageBlob instanceof Blob)) {
    throw new Error('海报生成失败');
  }

  const bitmap = await decodeImage(imageBlob);
  if (!bitmap) {
    throw new Error('海报生成失败');
  }

  try {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('海报生成失败');

    const centerX = W / 2;
    const contentWidth = W - MARGIN * 2; // 888

    // ---- 底色 + 顶部暖光 ----
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    const warm = ctx.createRadialGradient(centerX, -180, 0, centerX, -180, 1150);
    warm.addColorStop(0, 'rgba(200, 169, 106, .18)');
    warm.addColorStop(1, 'rgba(200, 169, 106, 0)');
    ctx.fillStyle = warm;
    ctx.fillRect(0, 0, W, H);

    // ---- 卡片：等比缩放、居中、留 96px 边距 ----
    const CARD_TOP = 150;
    const CARD_MAX_H = 880; // 卡片区底 ≈ 1030，给下方文字留出空间
    const scale = Math.min(contentWidth / bitmap.width, CARD_MAX_H / bitmap.height);
    const dw = bitmap.width * scale;
    const dh = bitmap.height * scale;
    const dx = (W - dw) / 2;
    const dy = CARD_TOP + (CARD_MAX_H - dh) / 2;

    // 隐藏款：卡片后方的金色光晕（按卡片比例的椭圆径向渐变）
    if (card.style === 'secret') {
      const gx = dx + dw / 2;
      const gy = dy + dh / 2;
      ctx.save();
      ctx.translate(gx, gy);
      ctx.scale(dw * 0.95, dh * 0.85 + 90);
      const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      glow.addColorStop(0, 'rgba(232, 200, 122, .45)');
      glow.addColorStop(0.35, 'rgba(232, 200, 122, .2)');
      glow.addColorStop(1, 'rgba(232, 200, 122, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(-1, -1, 2, 2);
      ctx.restore();
    }

    // 阴影铺底：先用带阴影的底衬投出柔和影，再把图裁圆角画上去
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, .55)';
    ctx.shadowBlur = 48;
    ctx.shadowOffsetY = 24;
    ctx.fillStyle = '#141417';
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(dx, dy, dw, dh, 24);
      ctx.fill();
    } else {
      ctx.fillRect(dx, dy, dw, dh);
    }
    ctx.restore();

    ctx.save();
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(dx, dy, dw, dh, 24);
      ctx.clip();
    }
    ctx.drawImage(bitmap, dx, dy, dw, dh);
    ctx.restore();

    // ---- 文字 ----
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    // 系列：衬线、大字距
    const series = String(card.series ?? '').trim() || '未填写';
    const fitted = fitSeries(ctx, series, contentWidth);
    ctx.font = `600 ${fitted.size}px ${SERIF}`;
    setLetterSpacing(ctx, '14px');
    ctx.fillStyle = GOLD;
    ctx.fillText(fitted.text, centerX + 7, 1184); // +7 补回末字符字距的偏移
    setLetterSpacing(ctx, '0px');

    // 角色：空则「未填写」
    const character = String(card.character ?? '').trim() || '未填写';
    ctx.font = `400 40px ${SANS}`;
    ctx.fillStyle = TEXT;
    ctx.fillText(character, centerX, 1268);

    // 款式
    const label = card.style === 'secret' ? '隐藏款' : card.style === 'special' ? '特别版' : '常规款';
    ctx.font = `400 32px ${SANS}`;
    ctx.fillStyle = card.style === 'secret' ? GOLD_SECRET : MUTED;
    ctx.fillText(`款式 · ${label}`, centerX, 1330);

    // 日期
    ctx.font = `400 32px ${SANS}`;
    ctx.fillStyle = MUTED;
    ctx.fillText(formatDateCn(card.pulledAt), centerX, 1388);

    // ---- 底部：站点名 + 免责声明 ----
    ctx.font = `600 34px ${SERIF}`;
    setLetterSpacing(ctx, '6px');
    ctx.fillStyle = GOLD;
    ctx.fillText('卡柜 Cardcase', centerX + 3, 1748);
    setLetterSpacing(ctx, '0px');

    ctx.font = `400 26px ${SANS}`;
    ctx.fillStyle = MUTED;
    ctx.fillText('非官方粉丝项目，与泡泡玛特无关', centerX, 1800);

    // ---- 导出 ----
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error('海报生成失败'))),
        'image/png',
      );
    });
    return blob;
  } finally {
    bitmap.close();
  }
}
