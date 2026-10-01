/**
 * Tag 实验室 · 入口
 *
 * 与柏宝绘同构的挂载方式:host 元素留 ST 的 light DOM,Vue 应用整体活在
 * 它的 shadow root 里;dist/index.css 以 <link> 注入 shadow root,样式双向隔离。
 * 设置存 localStorage('tlb_settings'),不依赖 ST 的 extension_settings
 * (唯一接触点是「从柏宝绘同步」按钮,按需读)。
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

function mount(): void {
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

  createApp(App).mount(container);
}

function boot(attempt = 0): void {
  // body 就绪即可挂;不等 ST getContext(本插件不依赖它启动)
  if (document.body) {
    try {
      mount();
      injectMenuButton();
      console.log(`[TagLab] 已加载 v${__TLB_VERSION__}(画师串 ${settings.artistPresets.length} 条)`);
    } catch (e) {
      console.error('[TagLab] 启动失败', e);
    }
    return;
  }
  if (attempt > 40) return;
  setTimeout(() => boot(attempt + 1), 500);
}

boot();
