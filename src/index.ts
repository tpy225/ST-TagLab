/**
 * Tag 实验室 · 入口
 *
 * 挂载方式:host 元素留 ST 的 light DOM,Vue 应用整体活在
 * 它的 shadow root 里;dist/index.css 以 <link> 注入 shadow root,样式双向隔离。
 * 设置存 localStorage('tlb_settings'),不依赖 ST 的 extension_settings
 * (唯一接触点是同步功能,按需读)。
 */
import App from '@/App.vue';
import { injectMenuButton } from '@/menu';
import { settings } from '@/state/settings';
// 这两行让 Vite 把全局样式打进 dist/index.css(随后注入 shadow root)
import '@/styles/base.css';
import '@/styles/theme.css';
import { createApp } from 'vue';

const HOST_ID = 'tlb-app-host';

/**
 * 可继承的排版属性 —— shadow DOM 不隔离继承,这些会透过 host 从 ST 漏进来。
 * 在 host 上用内联 !important 钉死,从根上切断继承链。
 */
const INHERITED_RESET: Record<string, string> = {
  'font-family':
    "'MiSans','HarmonyOS Sans SC','PingFang SC','Microsoft YaHei',-apple-system,BlinkMacSystemFont,'Segoe UI','Inter',system-ui,sans-serif",
  'font-size': '14px',
  'font-weight': '400',
  'font-style': 'normal',
  'font-variant': 'normal',
  'line-height': '1.6',
  'letter-spacing': 'normal',
  'word-spacing': 'normal',
  'text-align': 'left',
  'text-transform': 'none',
  'text-indent': '0',
  'text-shadow': 'none',
  'white-space': 'normal',
  color: '#1c242c',
  direction: 'ltr',
};

/**
 * 掛載前先把像素字載好,否則首屏先用 fallback 字體、字體到位後整屏跳一次字(閃動)。
 * woff2 由 Vite 打包;失敗不阻斷啟動(回落等寬 fallback)。
 */
async function warmPixelFont(): Promise<void> {
  if (!('FontFace' in window)) return;
  try {
    const url = new URL('./assets/fonts/PixelifySans-latin.woff2', import.meta.url).href;
    await Promise.all(
      [400, 700].map(async (weight) => {
        const face = new FontFace('Pixelify Sans', `url(${url})`, { weight: String(weight) });
        await face.load();
        document.fonts.add(face);
      }),
    );
  } catch {
    /* 字型預載失敗時仍正常啟動,由 CSS @font-face 或系統 fallback 處理 */
  }
}

async function mount(): Promise<void> {
  let host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = HOST_ID;
    document.body.appendChild(host);
  }

  // host 不参与布局(窗口内部用 fixed 定位),并切断继承
  host.style.setProperty('display', 'contents', 'important');
  for (const [prop, value] of Object.entries(INHERITED_RESET)) {
    host.style.setProperty(prop, value, 'important');
  }

  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  shadow.textContent = '';

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('./index.css', import.meta.url).href;
  shadow.appendChild(link);

  const container = document.createElement('div');
  shadow.appendChild(container);

  await warmPixelFont();
  createApp(App).mount(container);
}

function boot(attempt = 0): void {
  // body 就绪即可挂;不等 ST getContext(本插件不依赖它启动)
  if (document.body) {
    void mount()
      .then(() => injectMenuButton())
      .then(() => console.log(`[TagLab] 已加载 v${__TLB_VERSION__}(画师串 ${settings.artistPresets.length} 条)`))
      .catch((e: unknown) => console.error('[TagLab] 启动失败', e));
    return;
  }
  if (attempt > 40) return;
  setTimeout(() => boot(attempt + 1), 500);
}

boot();
