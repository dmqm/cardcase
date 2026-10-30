/**
 * 卡片 2.5D 动态：指针倾斜 + 陀螺仪。
 *
 * 约定：
 * - transform 只写内联样式，统一经 requestAnimationFrame 合并成一个批量 flush，
 *   避免每个指针事件各触发一次重排。
 * - «减少动态效果»（prefers-reduced-motion: reduce）是总闸：开启时不绑指针监听、
 *   陀螺仪拒绝生效，且任何时刻切到 reduce 都立刻清光所有内联 transform。
 */

const MAX_TILT = 8; // deg，倾斜与陀螺仪共用上限

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

const reduceMq =
  typeof matchMedia === 'function'
    ? matchMedia('(prefers-reduced-motion: reduce)')
    : null;

function reduced() {
  return Boolean(reduceMq && reduceMq.matches);
}

/* ---------- rAF 批量写 transform ---------- */

let rootEl = null; // 最近一次 initTilt 的容器（#grid）
let frames = null; // Map card → 'reset' | { rx, ry }：本帧待写或待复位的变换
let rafId = 0;

function schedule() {
  if (!rafId) rafId = requestAnimationFrame(flush);
}

function flush() {
  rafId = 0;
  const batch = frames;
  frames = null;
  if (!batch) return;

  if (reduced()) {
    // 中途切到 reduce：这一帧什么都不写，把待写项全部复位。
    for (const card of batch.keys()) card.style.transform = '';
    return;
  }
  for (const [card, entry] of batch) {
    if (entry === 'reset') card.style.transform = '';
    else card.style.transform = `perspective(600px) rotateX(${entry.rx}deg) rotateY(${entry.ry}deg)`;
  }
}

function queueUpdate(card, entry) {
  frames = frames ?? new Map();
  frames.set(card, entry);
  schedule();
}

function resetCard(card) {
  queueUpdate(card, 'reset');
}

function resetAllCards() {
  for (const card of rootEl?.querySelectorAll('.card') ?? []) {
    card.style.transform = '';
  }
}

/* ---------- 指针倾斜 ---------- */

/**
 * 给 root 内每个 .card 绑指针倾斜。重复调用同一节点不会重复绑定；
 * 卡墙每次重渲染生成新节点，由调用方在渲染后再调 initTilt。
 * @param {HTMLElement} root
 */
export function initTilt(root) {
  rootEl = root ?? null;
  if (!root || reduced()) return;

  for (const card of root.querySelectorAll('.card')) {
    if (card.dataset.tiltBound === '1') continue;
    card.dataset.tiltBound = '1';

    card.addEventListener('pointermove', (event) => {
      if (!event.isPrimary || reduced()) return;
      if (event.pointerType === 'touch') return; // 触摸留给滚动与点击，不抢手势

      const rect = card.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const nx = clamp((event.clientX - rect.left) / rect.width * 2 - 1, -1, 1);
      const ny = clamp((event.clientY - rect.top) / rect.height * 2 - 1, -1, 1);
      queueUpdate(card, { rx: -ny * MAX_TILT, ry: nx * MAX_TILT });
    });

    card.addEventListener('pointerleave', () => resetCard(card));
    card.addEventListener('pointercancel', () => resetCard(card));
  }
}

/* ---------- 陀螺仪 ---------- */

let gyroHandler = null;
let gyroPaused = false;

function onVisibility() {
  if (!gyroHandler) return;
  gyroPaused = document.hidden;
  if (gyroPaused) resetAllCards(); // 切后台时把卡片摆正，回到前台再跟
}

function stopGyroListening() {
  if (!gyroHandler) return;
  window.removeEventListener('deviceorientation', gyroHandler);
  gyroHandler = null;
  gyroPaused = false;
  document.removeEventListener('visibilitychange', onVisibility);
  resetAllCards();
}

/**
 * 用户点「让卡片跟着手机动」时调用。授权成功返回 true；
 * 不支持 / 用户拒绝 / requestPermission 抛错 / reduce 态一律返回 false 且静默。
 */
export async function enableGyro() {
  if (typeof DeviceOrientationEvent === 'undefined' || reduced()) return false;

  try {
    // iOS 13+：必须先向用户要权限；其它平台无此 API 直接监听。
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      const state = await DeviceOrientationEvent.requestPermission();
      if (state !== 'granted') return false;
    }
  } catch {
    return false;
  }

  if (!gyroHandler) {
    gyroHandler = (event) => {
      if (gyroPaused || reduced() || !rootEl) return;
      // gamma：左右倾 → rotateY；beta：前后倾 → rotateX。都限幅 ±MAX_TILT。
      const gamma = clamp(Number(event.gamma ?? 0), -MAX_TILT, MAX_TILT);
      const beta = clamp(Number(event.beta ?? 0), -MAX_TILT, MAX_TILT);
      for (const card of rootEl.querySelectorAll('.card')) {
        queueUpdate(card, { rx: -beta, ry: gamma });
      }
    };
    window.addEventListener('deviceorientation', gyroHandler);
    document.addEventListener('visibilitychange', onVisibility);
  }
  return true;
}

/* ---------- reduce 总闸 ---------- */

reduceMq?.addEventListener?.('change', () => {
  if (!reduceMq.matches) return;
  stopGyroListening();
  frames?.clear?.();
  resetAllCards();
});
