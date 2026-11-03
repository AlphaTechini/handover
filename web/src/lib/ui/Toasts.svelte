<script lang="ts">
	import { fly, fade } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import Icon, { type IconName } from './Icon.svelte';
	import { dismiss, toasts, type Toast } from './toast.svelte';

	const icons: Record<Toast['tone'], IconName> = {
		neutral: 'info',
		success: 'check',
		error: 'alert-octagon',
		warning: 'alert'
	};

	const timers = new Map<number, { left: number; started: number; handle?: ReturnType<typeof setTimeout> }>();

	function arm(t: Toast) {
		const entry = timers.get(t.id) ?? { left: t.timeout, started: 0 };
		entry.started = Date.now();
		entry.handle = setTimeout(() => {
			timers.delete(t.id);
			dismiss(t.id);
		}, entry.left);
		timers.set(t.id, entry);
	}
	function pause(t: Toast) {
		const e = timers.get(t.id);
		if (!e) return;
		clearTimeout(e.handle);
		e.left = Math.max(1200, e.left - (Date.now() - e.started));
	}

	function auto(node: HTMLElement, t: Toast) {
		arm(t);
		const enter = () => pause(t);
		const leave = () => arm(t);
		node.addEventListener('mouseenter', enter);
		node.addEventListener('mouseleave', leave);
		node.addEventListener('focusin', enter);
		node.addEventListener('focusout', leave);
		return {
			destroy() {
				const e = timers.get(t.id);
				if (e) clearTimeout(e.handle);
				timers.delete(t.id);
			}
		};
	}
</script>

<section class="toasts" aria-label="Notifications" aria-live="polite">
	{#each toasts as t (t.id)}
		<div
			class="toast {t.tone}"
			role={t.tone === 'error' ? 'alert' : 'status'}
			use:auto={t}
			in:fly={{ y: 12, duration: 220 }}
			out:fade={{ duration: 140 }}
			animate:flip={{ duration: 200 }}
		>
			<span class="ico"><Icon name={icons[t.tone]} size={16} stroke={2} /></span>
			<div class="body">
				<p class="title">{t.title}</p>
				{#if t.message}<p class="msg">{t.message}</p>{/if}
				{#if t.href}
					<a class="link lnk" href={t.href} target="_blank" rel="noreferrer noopener">
						{t.linkLabel ?? 'View'}
						<Icon name="arrow-up-right" size={12} />
					</a>
				{/if}
			</div>
			<button class="close" type="button" aria-label="Dismiss notification" onclick={() => dismiss(t.id)}>
				<Icon name="x" size={14} />
			</button>
		</div>
	{/each}
</section>

<style>
	.toasts {
		position: fixed;
		z-index: 80;
		right: 16px;
		bottom: 16px;
		display: grid;
		gap: 8px;
		width: min(380px, calc(100vw - 32px));
		pointer-events: none;
	}
	.toast {
		pointer-events: auto;
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: 10px;
		align-items: start;
		padding: 12px 10px 12px 14px;
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
	}
	.ico {
		margin-top: 1px;
		color: var(--text-3);
	}
	.success .ico {
		color: var(--clean);
	}
	.error .ico {
		color: var(--bad);
	}
	.warning .ico {
		color: var(--dirty);
	}
	.body {
		min-width: 0;
		display: grid;
		gap: 2px;
	}
	.title {
		font-weight: 600;
		font-size: var(--text-sm);
	}
	.msg {
		font-size: var(--text-sm);
		color: var(--text-2);
		overflow-wrap: anywhere;
	}
	.lnk {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		font-size: var(--text-sm);
		margin-top: 2px;
	}
	.close {
		display: grid;
		place-items: center;
		width: 24px;
		height: 24px;
		border-radius: var(--radius-sm);
		color: var(--text-3);
	}
	.close:hover {
		background: var(--surface-sunken);
		color: var(--text);
	}
</style>
