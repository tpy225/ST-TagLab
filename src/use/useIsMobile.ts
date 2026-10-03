import { onUnmounted, ref } from 'vue';

/**
 * UA 平台判定(對齊 ST 自身 isMobile() 口徑:mobile/tablet)。
 * 安卓 Chrome 勾選「桌面版網站」只改 viewport(約 980px)與部分 UA token,
 * 多數情況下 Android 標識仍在;作為純媒體查詢之外的保險。
 */
export function uaIsMobile(): boolean {
  if (typeof navigator === 'undefined' || !navigator.userAgent) return false;
  return /android|iphone|ipad|ipod|windows phone|mobile|tablet/i.test(navigator.userAgent);
}

/**
 * 移動端判定(三條保險,任一命中即移動佈局):
 * - 窄屏 ≤760:豎屏手機
 * - 觸控 ≤1024:安卓「桌面版網站」viewport≈980,純 max-width:760 會漏接
 * - 觸控橫屏(高 ≤480)
 * - UA mobile/tablet
 * 必須由 JS matchMedia 驅動:面板定位是 JS 內聯樣式,不能只靠 CSS @media 覆寫。
 */
export const MOBILE_MEDIA =
  '(max-width: 760px), (pointer: coarse) and (max-width: 1024px), (pointer: coarse) and (max-height: 480px)';

export function useIsMobile() {
  const mq = window.matchMedia(MOBILE_MEDIA);
  const evalMobile = (): boolean => mq.matches || uaIsMobile();
  const isMobile = ref(evalMobile());
  const onChange = (): void => {
    isMobile.value = evalMobile();
  };
  mq.addEventListener('change', onChange);
  onUnmounted(() => mq.removeEventListener('change', onChange));
  return isMobile;
}
