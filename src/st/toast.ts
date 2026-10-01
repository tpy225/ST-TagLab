/**
 * ST 宿主环境工具:toastr 通知(ST 全局自带;缺失时静默降级 console)。
 */

interface ToastrLike {
  success(message: string, title?: string): void;
  info(message: string, title?: string): void;
  warning(message: string, title?: string): void;
  error(message: string, title?: string): void;
}

export function toastr(): ToastrLike | null {
  const t = (window as unknown as { toastr?: ToastrLike }).toastr;
  return t ?? null;
}

export function notify(kind: 'success' | 'info' | 'warning' | 'error', message: string): void {
  toastr()?.[kind](message, 'Tag 实验室');
}
