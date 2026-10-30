/**
 * 导入流程三步全屏层：拍照/选图 → 四点透视校正 → 表单 → 入柜。
 * 只在最后一步保存成功才写库；中途关闭 / Esc 一律不动数据。
 */

import { decodeFile, warpToBlob, outputSize } from './image.js';
import { createCard, formatLocalDate } from './model.js';
import { saveCard, StorageQuotaError } from './db.js';
import { toast } from './ui.js';
import { computeHomography, applyHomography } from './geom.js';

const SERIES_SUGGESTIONS = [
  'MOLLY', 'DIMOO', 'SKULLPANDA', 'THE MONSTERS',
  'HIRONO', 'CRYBABY', '小野', '星星人',
];

const STEP_TITLES = {
  pick: '选一张卡的照片',
  crop: '对齐卡片四角',
  form: '填写卡片信息',
};

/** 按朝向取的比例（宽/高）与小字文案。 */
const ASPECT = { portrait: 63 / 88, landscape: 88 / 63 };
const RATIO_LABEL = { portrait: '竖向卡 · 63:88', landscape: '横向卡 · 88:63' };

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 朝向：宽度 = 左/右对边中点距离，高度 = 上/下对边中点距离，宽大于高判横向。 */
export function detectOrientation(corners) {
  const w = distance(midpoint(corners[0], corners[3]), midpoint(corners[1], corners[2]));
  const h = distance(midpoint(corners[0], corners[1]), midpoint(corners[3], corners[2]));
  return w > h ? 'landscape' : 'portrait';
}

let state = null; // { bitmap, corners, onSaved, escHandler }

/** 四角默认位置：贴边内缩 6%，覆盖卡面常见外框。 */
function defaultCorners(bitmap) {
  const ix = bitmap.width * 0.06;
  const iy = bitmap.height * 0.06;
  return [
    { x: ix, y: iy },
    { x: bitmap.width - ix, y: iy },
    { x: bitmap.width - ix, y: bitmap.height - iy },
    { x: ix, y: bitmap.height - iy },
  ];
}

/**
 * 打开导入弹层。repeat 调用被忽略；只有 onSaved 在保存成功后触发。
 * @param {{ onSaved?: () => void }} [options]
 */
export function openImport({ onSaved = null } = {}) {
  if (state) return; // 已有流程在跑，别叠层
  const host = document.getElementById('import-root') ?? document.body;

  const overlay = document.createElement('div');
  overlay.id = 'import-overlay';
  overlay.className = 'import-overlay';
  overlay.innerHTML = `
    <div class="import-inner" role="dialog" aria-modal="true" aria-labelledby="import-title">
      <header class="import-head">
        <strong class="import-title" id="import-title">${STEP_TITLES.pick}</strong>
        <button type="button" class="import-close" data-import-action="close" aria-label="关闭">×</button>
      </header>

      <div class="import-step" data-step="pick">
        <input type="file" accept="image/*" capture="environment" class="visually-hidden" data-import-input="camera" tabindex="-1" aria-hidden="true">
        <input type="file" accept="image/*" class="visually-hidden" data-import-input="album" tabindex="-1" aria-hidden="true">
        <div class="import-pick">
          <button type="button" class="btn btn-primary import-pick-btn" data-import-pick="camera">拍照</button>
          <button type="button" class="btn import-pick-btn" data-import-pick="album">从相册选</button>
          <p class="import-hint">尽量让卡片占满画面、四个角都在画面里。</p>
        </div>
      </div>

      <div class="import-step" data-step="crop" hidden>
        <div class="crop-stage"></div>
        <div class="crop-tools">
          <span class="card-ratio" data-ratio aria-live="polite"></span>
          <button type="button" class="btn" data-import-action="back-pick">重选</button>
          <button type="button" class="btn" data-import-action="rotate">旋转 90°</button>
          <button type="button" class="btn btn-primary" data-import-action="confirm-crop">下一步</button>
        </div>
      </div>

      <div class="import-step" data-step="form" hidden>
        <form class="import-form" novalidate>
          <p class="card-ratio" data-ratio></p>
          <label class="import-field">
            <span class="import-label">系列 <em class="req" aria-hidden="true">*</em></span>
            <input name="series" list="import-series-list" autocomplete="off" placeholder="如 MOLLY" required>
            <datalist id="import-series-list">
              ${SERIES_SUGGESTIONS.map((name) => `<option value="${name}"></option>`).join('')}
            </datalist>
          </label>
          <label class="import-field">
            <span class="import-label">角色</span>
            <input name="character" autocomplete="off" placeholder="如 Tau Tau">
          </label>
          <fieldset class="import-field import-style">
            <legend class="import-label">款式</legend>
            <label class="style-opt"><input type="radio" name="style" value="regular" checked>常规</label>
            <label class="style-opt"><input type="radio" name="style" value="secret">隐藏</label>
            <label class="style-opt"><input type="radio" name="style" value="special">特别版</label>
          </fieldset>
          <label class="import-field">
            <span class="import-label">抽中日期</span>
            <input type="date" name="pulledAt">
          </label>
          <label class="import-field">
            <span class="import-label">备注</span>
            <textarea name="note" rows="2" placeholder="可选"></textarea>
          </label>
          <div class="import-actions">
            <button type="button" class="btn" data-import-action="back-crop">上一步</button>
            <button type="button" class="btn btn-primary" data-import-action="save" disabled>存入卡柜</button>
          </div>
        </form>
      </div>
    </div>`;
  host.append(overlay);
  document.body.classList.add('import-open');

  state = { bitmap: null, corners: null, onSaved, escHandler: null, saving: false };

  const stepEls = new Map(
    [...overlay.querySelectorAll('.import-step')].map((el) => [el.dataset.step, el]),
  );
  const titleEl = overlay.querySelector('#import-title');
  const albumInput = overlay.querySelector('[data-import-input="album"]');
  const cameraInput = overlay.querySelector('[data-import-input="camera"]');
  const form = overlay.querySelector('.import-form');
  const saveBtn = overlay.querySelector('[data-import-action="save"]');

  function setStep(name) {
    for (const [key, el] of stepEls) el.hidden = key !== name;
    titleEl.textContent = STEP_TITLES[name] ?? '';
  }

  function teardown() {
    overlay.remove();
    document.body.classList.remove('import-open');
    if (state?.escHandler) document.removeEventListener('keydown', state.escHandler);
    state?.bitmap?.close?.();
    state = null;
  }

  state.escHandler = (event) => {
    if (event.key === 'Escape') teardown();
  };
  document.addEventListener('keydown', state.escHandler);

  /* ---------- 第一步：选图 ---------- */

  async function onFilePicked(file) {
    if (!file) return;
    let bitmap;
    try {
      bitmap = await decodeFile(file);
    } catch (error) {
      toast(error?.message ?? '这张图读不出来，换一张试试');
      return;
    }
    state.bitmap = bitmap;
    state.orientation = null;
    state.corners = defaultCorners(bitmap);
    setStep('crop');
    renderCrop();
    updateRatioLine();
  }

  /* ---------- 第二步：校正 ---------- */

  const cropStage = overlay.querySelector('.crop-stage');

  function renderCrop() {
    const { bitmap, corners } = state;
    if (!bitmap || !corners) return;

    const availW = cropStage.clientWidth || window.innerWidth - 32;
    const availH = (cropStage.clientHeight || window.innerHeight - 200) - 16;
    const scale = Math.min(availW / bitmap.width, Math.max(availH, 120) / bitmap.height, 2);
    const dispW = Math.round(bitmap.width * scale);
    const dispH = Math.round(bitmap.height * scale);

    cropStage.innerHTML = `
      <div class="crop-board" style="width:${dispW}px;height:${dispH}px">
        <canvas width="${bitmap.width}" height="${bitmap.height}" style="width:${dispW}px;height:${dispH}px"></canvas>
        <div class="crop-grid" aria-hidden="true"></div>
        ${corners.map((_, i) => `
          <button type="button" class="crop-handle" data-index="${i}" aria-label="角 ${i + 1}">
            <span>${i + 1}</span>
          </button>`).join('')}
      </div>`;

    const canvas = cropStage.querySelector('canvas');
    canvas.getContext('2d').drawImage(bitmap, 0, 0);

    const board = cropStage.querySelector('.crop-board');
    for (const handle of cropStage.querySelectorAll('.crop-handle')) {
      const index = Number(handle.dataset.index);
      const move = () => {
        const p = state.corners[index];
        handle.style.left = `${(p.x + 0.5) * scale}px`;
        handle.style.top = `${(p.y + 0.5) * scale}px`;
      };
      move();
      handle.addEventListener('pointerdown', (event) => {
        handle.setPointerCapture(event.pointerId);
        event.preventDefault();
      });
      handle.addEventListener('pointermove', (event) => {
        if (!handle.hasPointerCapture?.(event.pointerId)) return;
        const rect = board.getBoundingClientRect();
        const x = Math.min(Math.max(event.clientX - rect.left, 0) / scale, bitmap.width - 1);
        const y = Math.min(Math.max(event.clientY - rect.top, 0) / scale, bitmap.height - 1);
        state.corners[index] = { x, y };
        move();
      });
      handle.addEventListener('pointerup', updateRatioLine);
      handle.addEventListener('pointercancel', updateRatioLine);
    }
  }

  /** 校正步的实时小字：随当前四角判定朝向并显示。 */
  function updateRatioLine() {
    if (!state?.corners) return;
    const line = overlay.querySelector('.crop-tools [data-ratio]');
    if (line) line.textContent = RATIO_LABEL[detectOrientation(state.corners)];
  }

  /** 四点绕图片中心顺时针转 90°，并按新方位重排，保持编号贴着画面方位。 */
  function rotate90() {
    const { bitmap, corners } = state;
    const cx = bitmap.width / 2;
    const cy = bitmap.height / 2;
    const rotated = corners.map((p) => ({
      x: cx - (p.y - cy),
      y: cy + (p.x - cx),
    }));
    state.corners = [rotated[3], rotated[0], rotated[1], rotated[2]];
    for (const p of state.corners) {
      p.x = Math.min(Math.max(p.x, 0), bitmap.width - 1);
      p.y = Math.min(Math.max(p.y, 0), bitmap.height - 1);
    }
    renderCrop();
    updateRatioLine();
  }

  /** 校正有效才放行：单应矩阵非退化，四角双向映射都是有限值。目标尺寸随朝向的比例取。 */
  function validateCorners() {
    const out = outputSize(1000, ASPECT[state.orientation]);
    const src = state.corners.map((p) => [p.x, p.y]);
    const target = [[0, 0], [out.width - 1, 0], [out.width - 1, out.height - 1], [0, out.height - 1]];
    const forward = computeHomography(src, target);
    const backward = computeHomography(target, src);
    if (!forward || !backward) return false;
    for (const [matrix, points] of [[forward, src], [backward, target]]) {
      for (const [x, y] of points) {
        const mapped = applyHomography(matrix, x, y);
        if (!Number.isFinite(mapped.x) || !Number.isFinite(mapped.y)) return false;
      }
    }
    return true;
  }

  function confirmCrop() {
    if (!state.bitmap) {
      toast('先选一张卡的照片');
      setStep('pick');
      return;
    }
    state.orientation = detectOrientation(state.corners);
    for (const line of overlay.querySelectorAll('[data-ratio]')) {
      line.textContent = RATIO_LABEL[state.orientation];
    }
    if (!validateCorners()) {
      toast('四个角没摆好，重新对一下');
      setStep('crop');
      return;
    }
    setStep('form');
    if (!form.pulledAt.value) {
      form.pulledAt.value = formatLocalDate(new Date());
    }
    form.series.focus({ preventScroll: true });
  }

  /* ---------- 第三步：表单 ---------- */

  function refreshSaveState() {
    saveBtn.disabled = state.saving || !form.series.value.trim();
  }
  form.addEventListener('input', refreshSaveState);
  form.addEventListener('change', refreshSaveState);

  async function save() {
    const series = form.series.value.trim();
    if (!series || state.saving) return;
    state.saving = true;
    saveBtn.disabled = true;
    saveBtn.textContent = '存入中…';
    try {
      const out = outputSize(1000, ASPECT[state.orientation]);
      const card = createCard({
        series,
        character: form.character.value,
        style: form.querySelector('input[name="style"]:checked')?.value ?? 'regular',
        pulledAt: form.pulledAt.value || undefined,
        note: form.note.value,
        width: out.width,
        height: out.height,
      });
      const blob = await warpToBlob(
        state.bitmap,
        state.corners.map((p) => [p.x, p.y]),
        1000,
        ASPECT[state.orientation],
      );
      await saveCard(card, blob);
      const { onSaved } = state;
      teardown();
      onSaved?.();
      toast('已入柜');
    } catch (error) {
      // 配额不足或校正出错：层保持打开，数据一条没写。
      toast(error instanceof StorageQuotaError ? error.message : error?.message ?? '保存失败，再试一次');
      state.saving = false;
      refreshSaveState();
      saveBtn.textContent = '存入卡柜';
    }
  }

  /* ---------- 事件委派 ---------- */

  overlay.addEventListener('click', (event) => {
    const pick = event.target.closest('[data-import-pick]')?.dataset.importPick;
    if (pick === 'camera') cameraInput.click();
    if (pick === 'album') albumInput.click();

    const action = event.target.closest('[data-import-action]')?.dataset.importAction;
    if (action === 'close') teardown();
    if (action === 'back-pick') setStep('pick');
    if (action === 'rotate') rotate90();
    if (action === 'confirm-crop') confirmCrop();
    if (action === 'back-crop') {
      setStep('crop');
      requestAnimationFrame(renderCrop); // 布局稳定后重算缩放与手柄
    }
    if (action === 'save') save();
  });

  for (const input of [cameraInput, albumInput]) {
    input.addEventListener('change', () => {
      onFilePicked(input.files?.[0]);
      input.value = ''; // 允许重复选同一文件
    });
  }
}
