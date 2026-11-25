export const toastState = $state({ msg: '', on: false });

let timer: ReturnType<typeof setTimeout> | undefined;

export function toast(msg: string): void {
  toastState.msg = msg;
  toastState.on = true;
  clearTimeout(timer);
  timer = setTimeout(() => (toastState.on = false), 2400);
}
