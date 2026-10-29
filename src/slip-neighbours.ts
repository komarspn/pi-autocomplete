// Ported from oh-my-pi, crates/pi-predict/src/ngram/hygiene.rs (`for_each_neighbour`), commit 0b5c27ab.
//
// MIT License
//
// Copyright (c) 2025 Mario Zechner
// Copyright (c) 2025-2026 Can Bölük
// Copyright (c) 2026 Stencil Labs, Inc.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

const ALPHABET = "abcdefghijklmnopqrstuvwxyz";

/**
 * The Damerau edit-distance-1 neighbours of `word` that look like typing slips: deletes, adjacent
 * transposes, substitutions and inserts over a to z, except
 * - edits of the last letter (`subagents`/`subagent`, `truncates`/`truncated` are inflections);
 * - edits of the first letter other than a transposition (`gcloud`/`cloud`, `oauth`/`auth` are distinct words);
 * - edits touching an apostrophe (`we're`/`were`, `don't`/`dont`).
 * May yield a neighbour more than once.
 */
export function* slipNeighbours(word: string): Generator<string> {
	// By code point, as omp's chars, so an edit never splits a surrogate pair.
	const chars = [...word];
	const n = chars.length;
	// heads[i] is the first i characters and tails[i] the rest, so each neighbour is two concatenations.
	const heads = [""];
	for (const c of chars) heads.push((heads.at(-1) ?? "") + c);
	const tails = heads.map((head) => word.slice(head.length));
	for (let i = 0; i < n - 1; i++) {
		const c = chars[i] ?? "";
		const next = chars[i + 1] ?? "";
		if (i > 0 && c !== "'") yield heads[i] + (tails[i + 1] ?? "");
		if (c !== next && c !== "'" && next !== "'") yield heads[i] + next + c + (tails[i + 2] ?? "");
	}
	for (let i = 1; i < n - 1; i++) {
		const c = chars[i] ?? "";
		if (c === "'") continue;
		for (const letter of ALPHABET) {
			if (letter !== c) yield heads[i] + letter + (tails[i + 1] ?? "");
		}
	}
	for (let i = 1; i < n; i++) {
		for (const letter of ALPHABET) yield heads[i] + letter + (tails[i] ?? "");
	}
}
