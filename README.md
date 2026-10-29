# pi-word-completion

A [pi](https://pi.dev) extension that completes the word under the cursor. While you type prose in the prompt editor, the rest of the likeliest word appears in dim text after the cursor.

- Tab accepts it and adds a space.
- Right accepts it without a space, so `'s` or `-based` can follow.
- Typing anything else ignores it.

Ghosts appear only at the end of a line, one word at a time. Code blocks, inline code, paths, identifiers, camelCase, words with digits and slash-command lines get none.

## Install

```sh
pi install npm:pi-word-completion
```

To try it without installing:

```sh
pi -e npm:pi-word-completion
```

## How it learns

A word trigram model ranks the words under the prefix you typed. It starts with built-in counts of the 150,000 most common English words, so common words complete on a fresh install. It then learns from the prompts you submit and from your past pi sessions. Words you use often win over more common English words.

A word that is neither a common English word nor in the built-in dictionary is suggested only after you have used it twice, so a typo you made once does not come back as a ghost.

A slip such as `isntead` or `cannonical` counts as the word you meant, when that word is one typing edit away and is either a real spelling or a word you type at least 3 times as often. A real spelling is a dictionary word or a very common English word. The fold applies to words of 5 or more letters, and never touches an apostrophe or changes the first or last letter, except by swapping it with its neighbour, so `oauth`, `subagents` and `we're` stay as typed. Once you have typed a spelling 3 times, it no longer folds into a common word and is learned as itself, unless you type the other word 3 times as often.

On first start, if `~/.claude/history.jsonl` or `~/.codex/history.jsonl` exists (or the same file under `CLAUDE_CONFIG_DIR` or `CODEX_HOME`), the extension asks once whether to learn from those prompts too. Nothing is read before you agree.

Everything stays on your machine. Learned counts are saved to `word-completion/ngram.json` in pi's agent directory (`~/.pi/agent` by default). Deleting that file resets what was learned. The next start reads your pi sessions again.

## Settings

`/word-completion` sets the method. Without an argument it shows a picker.

| Value | Effect |
|---|---|
| `auto` | Default. Uses the best engine available, which is `ngram` |
| `ngram` | The word trigram model |
| `off` | No ghosts, and nothing is learned |

The choice is saved and applies to later sessions.

## Data and license

The code is MIT licensed.

The built-in word counts are derived from the Google Books Ngram dataset, English, version 20200217, licensed under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). `scripts/build-web-prior.ts` rebuilds them from the source.

The built-in dictionary is a word list generated from the English Speller Database (ESDB, previously SCOWLv2), size 60, American English, under its MIT-like license. `scripts/build-dictionary.ts` rebuilds it.

The misspelling folding is ported from [oh-my-pi](https://github.com/can1357/oh-my-pi) under the MIT License.

See [NOTICE](NOTICE) for the full attribution.
