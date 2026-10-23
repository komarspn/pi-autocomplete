import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type WordPredictionBackend, WordCompletionProvider } from "../src/word-completion-provider.ts";

function fakeBackend(answer: (before: string, prefix: string) => string | null) {
	const calls: Array<{ before: string; prefix: string }> = [];
	const feedback: Array<{ before: string; prefix: string; suggestion: string; accepted: boolean }> = [];
	const pending: Array<() => void> = [];
	const backend: WordPredictionBackend = {
		complete(before, prefix) {
			calls.push({ before, prefix });
			return new Promise((resolve) => pending.push(() => resolve(answer(before, prefix))));
		},
		feedback(before, prefix, suggestion, accepted) {
			feedback.push({ before, prefix, suggestion, accepted });
		},
	};
	const flush = async () => {
		for (const resolve of pending.splice(0)) resolve();
		await new Promise((resolve) => setImmediate(resolve));
	};
	return { backend, calls, feedback, flush };
}

describe("WordCompletionProvider", () => {
	it("returns null on a miss, asks the backend, then serves the cached answer", async () => {
		const fake = fakeBackend(() => "lo");
		let updates = 0;
		const provider = new WordCompletionProvider(fake.backend, () => updates++);

		assert.equal(provider.getWordCompletion(["say hel"], 0, 7), null);
		assert.deepEqual(fake.calls, [{ before: "say ", prefix: "hel" }]);

		await fake.flush();
		assert.equal(updates, 1);
		assert.equal(provider.getWordCompletion(["say hel"], 0, 7), "lo");
		assert.equal(fake.calls.length, 1);
	});

	it("does not repeat a request while one for the same query is pending", () => {
		const fake = fakeBackend(() => "lo");
		const provider = new WordCompletionProvider(fake.backend, () => {});
		provider.getWordCompletion(["hel"], 0, 3);
		provider.getWordCompletion(["hel"], 0, 3);
		assert.equal(fake.calls.length, 1);
	});

	it("does not request a repaint for a null answer", async () => {
		const fake = fakeBackend(() => null);
		let updates = 0;
		const provider = new WordCompletionProvider(fake.backend, () => updates++);
		provider.getWordCompletion(["zzz"], 0, 3);
		await fake.flush();
		assert.equal(updates, 0);
		assert.equal(provider.getWordCompletion(["zzz"], 0, 3), null);
		assert.equal(fake.calls.length, 1);
	});

	it("includes earlier lines in the context before the word", () => {
		const fake = fakeBackend(() => null);
		const provider = new WordCompletionProvider(fake.backend, () => {});
		provider.getWordCompletion(["first line", "and sec"], 1, 7);
		assert.deepEqual(fake.calls, [{ before: "first line\nand ", prefix: "sec" }]);
	});

	it("caps the context at 2,000 UTF-16 units", () => {
		const fake = fakeBackend(() => null);
		const provider = new WordCompletionProvider(fake.backend, () => {});
		provider.getWordCompletion([`${"a ".repeat(1500)}wor`], 0, 3003);
		assert.equal(fake.calls[0]!.before.length, 2000);
	});

	it("asks nothing when the cursor is not at the end of its line", () => {
		const fake = fakeBackend(() => "lo");
		const provider = new WordCompletionProvider(fake.backend, () => {});
		assert.equal(provider.getWordCompletion(["hel world"], 0, 3), null);
		assert.equal(fake.calls.length, 0);
	});

	it("asks nothing when the text before the cursor does not end in a word", () => {
		const fake = fakeBackend(() => "lo");
		const provider = new WordCompletionProvider(fake.backend, () => {});
		assert.equal(provider.getWordCompletion(["hello "], 0, 6), null);
		assert.equal(provider.getWordCompletion([""], 0, 0), null);
		assert.equal(fake.calls.length, 0);
	});

	it("forwards feedback with the query context", () => {
		const fake = fakeBackend(() => "lo");
		const provider = new WordCompletionProvider(fake.backend, () => {});
		provider.wordCompletionFeedback(["say hel"], 0, 7, "lo", true);
		assert.deepEqual(fake.feedback, [{ before: "say ", prefix: "hel", suggestion: "lo", accepted: true }]);
	});
});
