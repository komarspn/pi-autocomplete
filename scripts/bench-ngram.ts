// Benchmarks NgramBackend.complete on a model trained with synthetic prompts.
// Run: node --expose-gc scripts/bench-ngram.ts [prompts] [--prior]
// --prior loads the shipped web prior first and reports its load time; the heap figure then includes it.
// Without --expose-gc the heap figure includes garbage and varies from run to run.
import { performance } from "node:perf_hooks";
import { NgramBackend } from "../src/ngram-backend.ts";
import { loadWebPrior } from "../src/web-prior.ts";

const args = process.argv.slice(2);
const PROMPTS = Number(args.find((arg) => !arg.startsWith("--")) ?? 10_000);
const USE_PRIOR = args.includes("--prior");
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
if (USE_PRIOR) {
	const loadStart = performance.now();
	const prior = await loadWebPrior();
	const loadMs = performance.now() - loadStart;
	if (!prior) throw new Error("The web prior did not load");
	const useStart = performance.now();
	await backend.usePrior(prior);
	console.log(`prior: ${prior.length} words, load ${loadMs.toFixed(0)} ms, usePrior ${(performance.now() - useStart).toFixed(0)} ms`);
}
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
// Times by prefix length, since one- and two-letter prefixes scan the most words.
const byLength = new Map<number, number[]>();
let shown = 0;
for (const { before, prefix } of queries) {
	const start = performance.now();
	const suffix = await backend.complete(before, prefix);
	const time = performance.now() - start;
	times.push(time);
	byLength.set(prefix.length, [...(byLength.get(prefix.length) ?? []), time]);
	if (suffix) shown++;
}
const us = (ms: number) => `${(ms * 1000).toFixed(1)} µs`;
const summary = (sample: number[]) => {
	sample.sort((a, b) => a - b);
	const at = (q: number) => sample[Math.min(sample.length - 1, Math.floor(q * sample.length))]!;
	return `p50 ${us(at(0.5))}, p90 ${us(at(0.9))}, p99 ${us(at(0.99))}, max ${us(at(1))}`;
};

console.log(`prompts ${PROMPTS}, training ${trainMs.toFixed(0)} ms, heap +${heapMiB.toFixed(1)} MiB`);
console.log(`complete over ${QUERIES} queries: ${summary(times)}`);
for (const length of [1, 2]) {
	const sample = byLength.get(length) ?? [];
	console.log(`  ${length}-letter prefix, ${sample.length} queries: ${summary(sample)}`);
}
console.log(`ghosts shown for ${((shown / QUERIES) * 100).toFixed(1)}% of queries`);
