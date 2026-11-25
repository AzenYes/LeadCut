export function createObservableValue<T>(initialValue: T) {
	let value = initialValue;
	const subscribers = new Set<() => void>();
	return {
		get: () => value,
		set(next: T) {
			if (Object.is(value, next)) return;
			value = next;
			for (const subscriber of subscribers) subscriber();
		},
		subscribe(subscriber: () => void) {
			subscribers.add(subscriber);
			return () => { subscribers.delete(subscriber); };
		},
	};
}
