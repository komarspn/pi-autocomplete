// Benchmarks NgramBackend.complete on a model trained with synthetic prompts.
// Run: node --expose-gc scripts/bench-ngram.ts [prompts]
// Without --expose-gc the heap figure includes garbage and varies from run to run.
import { performance } from "node:perf_hooks";
import { NgramBackend } from "../src/ngram-backend.ts";

const PROMPTS = Number(process.argv[2] ?? 10_000);
const VOCABULARY = 20_000;
const QUERIES = 5_000;

// Seeded so runs are comparable (mulberry32).
let seed = 42;
function random(): number {
	seed = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function integer(min: number, max: number): number {
	return min + Math.floor(random() * (max - min + 1));
}

const letters = "etaoinshrdlcumwfgypbvkjxqz";
const words = Array.from({ length: VOCABULARY }, () => {
	let word = "";
	// Skewed toward common letters, like English.
	for (let i = integer(2, 10); i > 0; i--) word += letters[Math.floor(random() ** 2 * letters.length)];
	return word;
});

// Zipf word frequencies, as in natural text.
const cumulative: number[] = [];
let mass = 0;
for (let rank = 1; rank <= VOCABULARY; rank++) cumulative.push((mass += 1 / rank ** 1.07));
function zipfWord(): string {
	const target = random() * mass;
	let low = 0;
	let high = cumulative.length - 1;
	while (low < high) {
		const mid = (low + high) >>> 1;
		if (cumulative[mid]! < target) low = mid + 1;
		else high = mid;
	}
	return words[low]!;
}

function prompt(): string[] {
	return Array.from({ length: integer(4, 60) }, zipfWord);
}

const backend = new NgramBackend();
globalThis.gc?.();
const heapBefore = process.memoryUsage().heapUsed;
const trainStart = performance.now();
for (let i = 0; i < PROMPTS; i++) backend.observe(`${prompt().join(" ")}.`);
const trainMs = performance.now() - trainStart;
globalThis.gc?.();
const heapMiB = (process.memoryUsage().heapUsed - heapBefore) / 2 ** 20;

// Queries from unseen prompts: a random cut, with a 1 to 4 letter prefix of the next word.
const queries = Array.from({ length: QUERIES }, () => {
	const sentence = prompt();
	const at = integer(0, sentence.length - 1);
	const word = sentence[at]!;
	const before = sentence.slice(0, at).join(" ");
	return { before: before ? `${before} ` : "", prefix: word.slice(0, integer(1, Math.min(4, word.length))) };
});

for (const { before, prefix } of queries.slice(0, 500)) await backend.complete(before, prefix);
const times: number[] = [];
let shown = 0;
for (const { before, prefix } of queries) {
	const start = performance.now();
	const suffix = await backend.complete(before, prefix);
	times.push(performance.now() - start);
	if (suffix) shown++;
}
times.sort((a, b) => a - b);
const at = (q: number) => times[Math.min(times.length - 1, Math.floor(q * times.length))]!;
const us = (ms: number) => `${(ms * 1000).toFixed(1)} µs`;

console.log(`prompts ${PROMPTS}, training ${trainMs.toFixed(0)} ms, heap +${heapMiB.toFixed(1)} MiB`);
console.log(`complete over ${QUERIES} queries: p50 ${us(at(0.5))}, p90 ${us(at(0.9))}, p99 ${us(at(0.99))}, max ${us(at(1))}`);
console.log(`ghosts shown for ${((shown / QUERIES) * 100).toFixed(1)}% of queries`);
