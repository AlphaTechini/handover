// Minimal toast queue. Components push; <Toasts /> in the root layout renders.
export type ToastTone = 'neutral' | 'success' | 'error' | 'warning';

export interface Toast {
	id: number;
	tone: ToastTone;
	title: string;
	message?: string;
	href?: string;
	linkLabel?: string;
	timeout: number;
}

let seq = 0;
export const toasts: Toast[] = $state([]);

export function toast(t: Omit<Toast, 'id' | 'timeout'> & { timeout?: number }): number {
	const id = ++seq;
	const timeout = t.timeout ?? (t.tone === 'error' ? 9000 : 5500);
	toasts.push({ ...t, id, timeout });
	if (toasts.length > 4) toasts.splice(0, toasts.length - 4);
	return id;
}

export function dismiss(id: number): void {
	const i = toasts.findIndex((t) => t.id === id);
	if (i >= 0) toasts.splice(i, 1);
}
