import type { WordPredictionBackend } from "./word-completion-provider.ts";

// Common English words, roughly most frequent first, so the first match is the likeliest.
// Placeholder until the n-gram engine learns from the user's own prompts.
const DEFAULT_WORDS = `
the and that have for not with you this but his from they say her she will one all would
there their what out about who get which when make can like time just him know take people
into year your good some could them see other than then now look only come its over think
also back after use two how our work first well way even new want because any these give day
most find here thing many tell very through long where much should still before between
something down same while never last might great since against right three under always
another without world again place around however small number different every large often
important really already actually probably please change function variable implement
implementation component configuration directory repository branch commit message request
response error warning problem question answer example instead update create delete remove
replace review explain describe should could would maybe check test tests testing feature
features file files folder project package module interface document documentation
`.trim().split(/\s+/);

/** Completes a prefix from a fixed word list. Ignores context and feedback. */
export class WordListBackend implements WordPredictionBackend {
	private readonly words: readonly string[];

	constructor(words: readonly string[] = DEFAULT_WORDS) {
		this.words = words;
	}

	async complete(_before: string, prefix: string): Promise<string | null> {
		const lower = prefix.toLowerCase();
		const word = this.words.find((w) => w.length > lower.length && w.startsWith(lower));
		return word ? word.slice(prefix.length) : null;
	}

	feedback(_before: string, _prefix: string, _suggestion: string, _accepted: boolean): void {}
}
