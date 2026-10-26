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
		provider.getWordCompletion(["a ".repeat(1500), "say wor"], 1, 7);
		const call = fake.calls[0];
		assert.ok(call);
		assert.equal(call.before.length, 2000);
		assert.ok(call.before.endsWith("a \nsay "));
	});

	it("never starts the capped context on a low surrogate", () => {
		const fake = fakeBackend(() => null);
		const provider = new WordCompletionProvider(fake.backend, () => {});
		// 2 + 1994 + 1 + 4 = 2001 units, so a plain cut would start on the emoji's low half.
		provider.getWordCompletion([`😀${"a".repeat(1994)}`, "say wor"], 1, 7);
		const call = fake.calls[0];
		assert.ok(call);
		assert.equal(call.before.length, 1999);
		assert.ok(call.before.startsWith("a"));
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

	describe("prose gate", () => {
		function asks(lines: readonly string[], line = lines.length - 1): boolean {
			const fake = fakeBackend(() => null);
			const provider = new WordCompletionProvider(fake.backend, () => {});
			const text = lines[line];
			assert.ok(text !== undefined);
			provider.getWordCompletion(lines, line, text.length);
			return fake.calls.length > 0;
		}

		it("asks for a plain prose word", () => {
			assert.equal(asks(["please wor"]), true);
			assert.equal(asks(["it's don't"]), true);
			assert.equal(asks(["zażółć gęś"]), true);
		});

		it("skips tokens with code characters", () => {
			for (const char of "\\/@_=:{}[]<>") assert.equal(asks([`see a${char}wor`]), false, char);
			assert.equal(asks(["see a-wor"]), true);
		});

		it("skips camelCase tokens and tokens with digits", () => {
			assert.equal(asks(["call myVar"]), false);
			assert.equal(asks(["call abc1def"]), false);
			assert.equal(asks(["call Myvar"]), true);
		});

		it("skips lines that start with /, -> or =>", () => {
			assert.equal(asks(["/model gpt"]), false);
			assert.equal(asks(["  /skill wor"]), false);
			assert.equal(asks(["-> next wor"]), false);
			assert.equal(asks(["=> next wor"]), false);
			assert.equal(asks(["go -> next wor"]), true);
		});

		it("skips a word in the middle of a word", () => {
			const fake = fakeBackend(() => "lo");
			const provider = new WordCompletionProvider(fake.backend, () => {});
			assert.equal(provider.getWordCompletion(["hello"], 0, 3), null);
			assert.equal(fake.calls.length, 0);
		});

		it("skips words inside inline code, including a span still being typed", () => {
			assert.equal(asks(["see `code", "more wor", "end`"], 1), false);
			assert.equal(asks(["run `npm ins"]), false);
			assert.equal(asks(["run `npm` and ins"]), true);
			assert.equal(asks(["run `npm", "test wor"]), false);
			assert.equal(asks(["run `npm", "test` and wor"]), true);
			assert.equal(asks(["a stray ` here", "", "new paragraph wor"]), true);
		});

		it("skips words inside HTML or XML", () => {
			assert.equal(asks(["<div>", "inner wor", "</div>"], 1), false);
			assert.equal(asks(["<div>", "inner wor"], 1), true);
		});

		it("skips every line inside a fenced block that spans lines", () => {
			const lines = ["text", "```", "inside wor", "more cod", "```", "after wor"];
			assert.equal(asks(lines, 2), false);
			assert.equal(asks(lines, 3), false);
			assert.equal(asks(lines, 5), true);
			assert.equal(asks(["~~~", "tilde wor"], 1), false);
		});

		it("skips buffers over 20,000 and lines over 1,000 UTF-16 units", () => {
			assert.equal(asks(["x".repeat(19_996), "wor"]), true);
			assert.equal(asks(["x".repeat(19_996), "word"]), false);
			assert.equal(asks([`${"a".repeat(997)} wo`]), true);
			assert.equal(asks([`${"a".repeat(997)} wor`]), false);
		});
	});

	it("forwards feedback with the query context", () => {
		const fake = fakeBackend(() => "lo");
		const provider = new WordCompletionProvider(fake.backend, () => {});
		provider.wordCompletionFeedback(["say hel"], 0, 7, "lo", true);
		assert.deepEqual(fake.feedback, [{ before: "say ", prefix: "hel", suggestion: "lo", accepted: true }]);
	});
});
