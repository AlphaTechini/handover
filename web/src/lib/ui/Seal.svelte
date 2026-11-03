<script lang="ts">
	import { sealSpec } from './seal';

	let {
		tokenId,
		address = null,
		mini = false,
		class: klass = ''
	}: { tokenId: string; address?: string | null; mini?: boolean; class?: string } = $props();

	const uid = $props.id();
	const spec = $derived(sealSpec(tokenId, address));
	const labelSize = $derived(spec.label.length <= 3 ? 11 : spec.label.length <= 5 ? 9 : 7);
	const ringText = $derived(`HANDOVER · SEPOLIA WALLET · TOKEN ${tokenId} · `);
</script>

<svg
	class="seal {klass}"
	viewBox="0 0 200 200"
	role="img"
	aria-label="Generated seal for Handover wallet #{tokenId}"
	preserveAspectRatio="xMidYMid slice"
>
	<defs>
		<radialGradient id="{uid}-bg" cx="50%" cy="40%" r="78%">
			<stop offset="0%" stop-color={spec.bg0} />
			<stop offset="100%" stop-color={spec.bg1} />
		</radialGradient>
		<radialGradient id="{uid}-glow" cx="50%" cy="50%" r="50%">
			<stop offset="0%" stop-color={spec.ink} stop-opacity="0.16" />
			<stop offset="70%" stop-color={spec.ink} stop-opacity="0" />
		</radialGradient>
		{#each spec.bands as b, i (i)}
			<path id="{uid}-b{i}" d={b.d} />
		{/each}
		<path id="{uid}-tp" d="M100 100 m-80 0 a80 80 0 1 1 160 0 a80 80 0 1 1 -160 0" />
	</defs>

	<rect width="200" height="200" fill="url(#{uid}-bg)" />
	<circle cx="100" cy="100" r="92" fill="url(#{uid}-glow)" />

	<g fill="none" stroke={spec.ink}>
		<circle cx="100" cy="100" r="96" stroke-width="0.6" opacity="0.5" />
		<circle cx="100" cy="100" r="85" stroke-width="0.4" opacity="0.35" />
	</g>

	{#each spec.bands as b, i (i)}
		<g fill="none" stroke={b.stroke} stroke-width={b.width} opacity={b.opacity}>
			{#each { length: mini ? Math.ceil(b.copies / 2) : b.copies } as _, k (k)}
				<use href="#{uid}-b{i}" transform="rotate({k * b.step * (mini ? 2 : 1)} 100 100)" />
			{/each}
		</g>
	{/each}

	<g class="ticks" stroke={spec.ink} stroke-width="1.1" stroke-linecap="round" opacity="0.75">
		{#each spec.ticks as t, i (i)}
			<line x1="100" y1="6" x2="100" y2={6 + t.len} transform="rotate({t.a} 100 100)" />
		{/each}
	</g>

	{#if !mini}
		<text class="ring-text" fill={spec.ink} opacity="0.62">
			<textPath href="#{uid}-tp" textLength="500" lengthAdjust="spacing">{ringText}{ringText}</textPath>
		</text>
	{/if}

	<circle cx="100" cy="100" r="17" fill={spec.bg1} stroke={spec.ink} stroke-width="0.6" stroke-opacity="0.6" />
	<text
		x="100"
		y="100"
		class="label"
		fill={spec.ink}
		font-size={labelSize}
		text-anchor="middle"
		dominant-baseline="central">{spec.label}</text
	>
</svg>

<style>
	.seal {
		width: 100%;
		height: auto;
		aspect-ratio: 1;
		display: block;
		user-select: none;
	}
	.ring-text {
		font-family: var(--font-mono);
		font-size: 5.6px;
		letter-spacing: 1.6px;
		font-weight: 500;
	}
	.label {
		font-family: var(--font-mono);
		font-weight: 500;
		letter-spacing: -0.02em;
	}
	.ticks line {
		transition: all var(--dur-3) var(--ease-out);
	}
</style>
