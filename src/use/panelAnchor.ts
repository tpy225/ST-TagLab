/**
 * 彈窗對齊浮動面板:實測 .tlb-panel 的視覺矩形,讓彈窗在視窗縮放/頁面 zoom
 * 時仍貼齊面板,不會因 layout viewport 偏移(同 PreviewModal 做法)。
 *
 * 用法:
 *   const { backdropEl, anchorStyle } = usePanelAnchor(openRef);
 *   <div ref="backdropEl" class="backdrop"><div class="stage" :style="anchorStyle">…</div></div>
 */
import { computed, nextTick, onUnmounted, ref, watch, type Ref } from 'vue';

const MARGIN = 10;

export function usePanelAnchor(open: Ref<unknown>) {
  const backdropEl = ref<HTMLElement | null>(null);
  const rect = ref({ x: MARGIN, y: MARGIN, w: 0, h: 0 });

  let ro: ResizeObserver | null = null;
  let rafQueued = false;

  function measure(): void {
    const root = backdropEl.value?.getRootNode();
    const panel =
      root instanceof ShadowRoot ? (root.querySelector('.tlb-panel') as HTMLElement | null) : null;
    const r = panel?.getBoundingClientRect();
    if (r && r.width > 80 && r.height > 120) {
      rect.value = {
        x: r.left + MARGIN,
        y: r.top + MARGIN,
        w: r.width - MARGIN * 2,
        h: r.height - MARGIN * 2,
      };
    } else {
      rect.value = {
        x: MARGIN,
        y: MARGIN,
        w: window.innerWidth - MARGIN * 2,
        h: window.innerHeight - MARGIN * 2,
      };
    }
  }

  function queueMeasure(): void {
    if (rafQueued) return;
    rafQueued = true;
    requestAnimationFrame(() => {
      rafQueued = false;
      measure();
    });
  }

  function start(): void {
    stop();
    const root = backdropEl.value?.getRootNode();
    const panel =
      root instanceof ShadowRoot ? (root.querySelector('.tlb-panel') as HTMLElement | null) : null;
    ro = new ResizeObserver(queueMeasure);
    if (panel) ro.observe(panel);
    window.addEventListener('resize', queueMeasure);
    measure();
  }

  function stop(): void {
    ro?.disconnect();
    ro = null;
    window.removeEventListener('resize', queueMeasure);
  }

  watch(
    open,
    (v) => {
      if (v) void nextTick(start);
      else stop();
    },
    { immediate: true },
  );
  onUnmounted(stop);

  const anchorStyle = computed(() => ({
    left: `${rect.value.x}px`,
    top: `${rect.value.y}px`,
    width: `${rect.value.w}px`,
    height: `${rect.value.h}px`,
  }));

  return { backdropEl, anchorStyle };
}
