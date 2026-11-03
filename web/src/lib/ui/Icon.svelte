<script lang="ts" module>
	// Hand-drawn 24px stroke icons (1.75 stroke). Kept inline so nothing loads from a CDN.
	const paths = {
		check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
		copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>',
		external: '<path d="M14 5h5v5"/><path d="M19 5l-8 8"/><path d="M17 13.5V18a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 5 18V8.5A1.5 1.5 0 0 1 6.5 7H11"/>',
		'arrow-right': '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
		'arrow-up-right': '<path d="M7 17L17 7"/><path d="M8 7h9v9"/>',
		sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/>',
		moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
		shield: '<path d="M12 3l7.5 3v5.5c0 4.5-3.2 8.3-7.5 9.5-4.3-1.2-7.5-5-7.5-9.5V6L12 3z"/>',
		'shield-check': '<path d="M12 3l7.5 3v5.5c0 4.5-3.2 8.3-7.5 9.5-4.3-1.2-7.5-5-7.5-9.5V6L12 3z"/><path d="M8.75 12.25l2.25 2.25 4.25-4.5"/>',
		alert: '<path d="M12 4.5l8.5 15h-17L12 4.5z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
		'alert-octagon': '<path d="M8.3 3.5h7.4l5.3 5.3v7.4l-5.3 5.3H8.3L3 16.2V8.8z"/><path d="M12 8v5"/><path d="M12 16.2h.01"/>',
		info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><path d="M12 7.75h.01"/>',
		clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
		lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
		unlock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 7.7-1.5"/>',
		key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8.5-8.5"/><path d="M16 7l2.5 2.5"/><path d="M14 9l1.75 1.75"/>',
		wallet: '<path d="M4.5 7.5h14a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18V6.5A2 2 0 0 1 6 4.5h11"/><path d="M16 13.5h.01"/>',
		x: '<path d="M6 6l12 12M18 6L6 18"/>',
		refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/>',
		send: '<path d="M20 4L10.5 13.5"/><path d="M20 4l-6 16-3.5-6.5L4 10l16-6z"/>',
		tag: '<path d="M3.5 12.1V4.5a1 1 0 0 1 1-1h7.6l8.4 8.4a1.5 1.5 0 0 1 0 2.1l-6.5 6.5a1.5 1.5 0 0 1-2.1 0z"/><circle cx="8.25" cy="8.25" r="1.25"/>',
		search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.4-4.4"/>',
		'chevron-down': '<path d="M6 9.5l6 6 6-6"/>',
		'chevron-right': '<path d="M9.5 6l6 6-6 6"/>',
		radio: '<circle cx="12" cy="12" r="2"/><path d="M8.2 8.2a5.4 5.4 0 0 0 0 7.6M15.8 15.8a5.4 5.4 0 0 0 0-7.6"/><path d="M5.4 5.4a9.3 9.3 0 0 0 0 13.2M18.6 18.6a9.3 9.3 0 0 0 0-13.2"/>',
		ban: '<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>',
		plus: '<path d="M12 5v14M5 12h14"/>',
		github: '<path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/>',
		layers: '<path d="M12 3.5l8.5 4.5-8.5 4.5L3.5 8z"/><path d="M3.5 12l8.5 4.5 8.5-4.5"/><path d="M3.5 16l8.5 4.5 8.5-4.5"/>',
		pen: '<path d="M4.5 19.5l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3l-10 10z"/><path d="M13.5 7l3 3"/>',
		snow: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="M9.5 4.5L12 7l2.5-2.5M9.5 19.5L12 17l2.5 2.5"/>',
		swap: '<path d="M7 4.5L3.5 8 7 11.5"/><path d="M3.5 8h13"/><path d="M17 12.5l3.5 3.5-3.5 3.5"/><path d="M20.5 16h-13"/>',
		eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
		hash: '<path d="M5 9h15M4 15h15M10 4L8 20M16 4l-2 16"/>',
		dot: '<circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>',
		menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
		filter: '<path d="M4 5.5h16l-6.25 7.5v5l-3.5 1.5V13z"/>',
		sort: '<path d="M7 4v16M3.5 16.5L7 20l3.5-3.5"/><path d="M17 20V4M13.5 7.5L17 4l3.5 3.5"/>',
		power: '<path d="M12 3.5v8"/><path d="M6.9 6.6a7.5 7.5 0 1 0 10.2 0"/>'
	} as const;

	export type IconName = keyof typeof paths;
</script>

<script lang="ts">
	let {
		name,
		size = 16,
		stroke = 1.75,
		label,
		class: klass = ''
	}: { name: IconName; size?: number; stroke?: number; label?: string; class?: string } = $props();
</script>

<svg
	class="icon {klass}"
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width={stroke}
	stroke-linecap="round"
	stroke-linejoin="round"
	role={label ? 'img' : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : 'true'}
	focusable="false"
>
	{@html paths[name]}
</svg>

<style>
	.icon {
		flex: none;
		display: inline-block;
		vertical-align: middle;
	}
</style>
