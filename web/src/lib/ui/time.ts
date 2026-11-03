export function relativeTime(date: Date | number, now = Date.now()): string {
	const t = typeof date === 'number' ? date : date.getTime();
	const s = Math.round((now - t) / 1000);
	if (s < 5) return 'just now';
	if (s < 60) return `${s}s ago`;
	const m = Math.round(s / 60);
	if (m < 60) return `${m} min ago`;
	const h = Math.round(m / 60);
	if (h < 24) return `${h} h ago`;
	const d = Math.round(h / 24);
	if (d < 30) return `${d} d ago`;
	return formatDate(t);
}

export function formatDate(date: Date | number): string {
	const d = typeof date === 'number' ? new Date(date) : date;
	return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(date: Date | number): string {
	const d = typeof date === 'number' ? new Date(date) : date;
	return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
