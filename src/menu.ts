/**
 * 往 ST 的 #extensionsMenu(魔杖菜单)注入「Tag 实验室」入口。
 * 菜单懒加载,轮询等出现;原生 DOM 实现,不依赖 jQuery。
 */
import { openPanel } from '@/state/ui';

const MENU_ITEM_ID = 'tlb-menu-item';

export function injectMenuButton(): void {
  const tryInject = (): boolean => {
    const menu = document.getElementById('extensionsMenu');
    if (!menu) return false;
    if (document.getElementById(MENU_ITEM_ID)) return true;

    const item = document.createElement('a');
    item.id = MENU_ITEM_ID;
    item.className = 'list-group-item';
    item.href = '#';
    item.title = 'Tag 实验室';
    item.innerHTML =
      '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" '
      + 'stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;margin-right:6px">'
      + '<path d="M10 2v6L4.2 18.5A2 2 0 0 0 6 21.5h12a2 2 0 0 0 1.8-3L14 8V2"/>'
      + '<path d="M8.5 2h7"/><path d="M7 15.5h10"/></svg>'
      + '<span>Tag 实验室</span>';
    item.addEventListener('click', e => {
      e.preventDefault();
      openPanel();
      // 收起魔杖菜单,贴合原生行为
      (menu as HTMLElement).style.display = 'none';
    });
    menu.appendChild(item);
    return true;
  };

  if (tryInject()) return;
  const timer = setInterval(() => {
    if (tryInject()) clearInterval(timer);
  }, 500);
  // 最多等 20s,放弃后不报错(极端主题下没有魔杖菜单)
  setTimeout(() => clearInterval(timer), 20_000);
}
