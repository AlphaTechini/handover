// Theme preference: 'light' | 'dark' forced via html[data-theme], or system when unset.
// localStorage access is wrapped: it can throw in private windows or sandboxed frames.
export type Theme = 'light' | 'dark';
const KEY = 'handover:theme';

export const theme = $state<{ value: Theme }>({ value: 'light' });

function systemTheme(): Theme {
	try {
		return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
	} catch {
		return 'light';
	}
}

export function initTheme(): void {
	let stored: string | null = null;
	try {
		stored = localStorage.getItem(KEY);
	} catch {
		/* storage unavailable */
	}
	if (stored === 'light' || stored === 'dark') {
		document.documentElement.dataset.theme = stored;
		theme.value = stored;
	} else {
		theme.value = systemTheme();
	}
	try {
		window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
			if (!document.documentElement.dataset.theme) theme.value = systemTheme();
		});
	} catch {
		/* old browsers */
	}
}

export function setTheme(next: Theme): void {
	theme.value = next;
	document.documentElement.dataset.theme = next;
	try {
		localStorage.setItem(KEY, next);
	} catch {
		/* storage unavailable: preference lasts for this page view */
	}
}
