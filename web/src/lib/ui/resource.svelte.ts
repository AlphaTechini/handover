// A small async state holder: every chain read goes through one of these so
// loading, empty and error states are always handled the same way.
export class Resource<T> {
	data = $state.raw<T | undefined>(undefined);
	error = $state.raw<unknown>(null);
	loading = $state(false);
	loadedAt = $state(0);
	#seq = 0;
	#fn: () => Promise<T>;

	constructor(fn: () => Promise<T>) {
		this.#fn = fn;
	}

	get ready(): boolean {
		return this.data !== undefined && !this.error;
	}

	/** Reload. Keeps previous data visible while refreshing (no flash to skeleton). */
	async load(): Promise<T | undefined> {
		const my = ++this.#seq;
		this.loading = true;
		this.error = null;
		try {
			const d = await this.#fn();
			if (my === this.#seq) {
				this.data = d;
				this.loadedAt = Date.now();
			}
			return d;
		} catch (e) {
			if (my === this.#seq) this.error = e;
			return undefined;
		} finally {
			if (my === this.#seq) this.loading = false;
		}
	}

	reset(): void {
		this.#seq++;
		this.data = undefined;
		this.error = null;
		this.loading = false;
	}
}
