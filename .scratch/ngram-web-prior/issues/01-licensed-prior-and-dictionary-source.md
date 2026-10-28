# 01: Choose a licensed source for the web prior and the dictionary

**What to build:** A recorded decision on where the n-gram engine's built-in word knowledge comes from, so the package can ship it legally. Two sources are needed: word and two-word counts for the web prior, and a dictionary of real spellings for the `min_count` rule and misspelling folding.

Candidates:

- Norvig's `count_1w.txt` and `count_2w.txt`, which omp uses. Norvig's page licenses only his code as MIT. The data is derived from the Google Web Trillion Word Corpus (Web 1T 5-gram), distributed by the Linguistic Data Consortium, and the page gives no license for it.
- Google Books Ngram datasets, believed to be CC BY 3.0. Not yet verified. The raw files are very large.
- For the dictionary: SCOWL, or no dictionary, treating a word as real when its web count is at least 200,000 (omp's `TRUSTED_WEB_COUNT`). omp reads `/usr/share/dict/words` at build time, which is absent on the maintainer's machine.

Reference: `docs/omp-word-completion.md`, Engines; `docs/word-completion-architecture.md`, open questions.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] License terms of each candidate quoted from the primary source, with links, under Comments
- [x] Chosen word-count source recorded, including whether it covers two-word counts
- [x] Chosen dictionary source recorded, or the decision to use the web-count rule alone
- [x] Attribution text the package must ship written down

## Comments

### License terms (checked 2026-10-28)

**Norvig `count_1w.txt`, `count_2w.txt`.** <https://norvig.com/ngrams/> says: "Data files are derived from the _Google Web Trillion Word Corpus_ ... and distributed by the Linguistic Data Consortium. Code copyright (c) 2008-2009 by Peter Norvig. You are free to use this code under the MIT license." The page grants nothing for the data.

The corpus is LDC2006T13, Web 1T 5-gram Version 1 (<https://catalog.ldc.upenn.edu/LDC2006T13>). Its user agreement (<https://catalog.ldc.upenn.edu/license/web-1t-5-gram-version-1.pdf>) says:

> 1.1. The Data may only be used for linguistic education and research ...
> 1.2. User shall not publish, retransmit, display, redistribute, reproduce or commercially exploit the Data in any form, except that User may include limited excerpts from the Data in articles, reports and other documents describing the results of User's linguistic education and research.
> 2.1. The Data is the property of Google Inc. and is protected by applicable copyright law.

Rejected. Shipping counts derived from Web 1T in an npm package is redistribution, which 1.2 forbids.

**Google Books Ngram, version 20200217.** The export index (<https://storage.googleapis.com/books/ngrams/books/datasetsv3.html>) and the English 1-gram page (<https://storage.googleapis.com/books/ngrams/books/20200217/eng/eng-1-ngrams_exports.html>) both say:

> **Usage**: This compilation is licensed under a Creative Commons Attribution 3.0 Unported License.

The Ngram Viewer FAQ (<https://books.google.com/ngrams/info>) adds: "Ngram Viewer graphs and data may be freely used for any purpose, although acknowledgement of Google Books Ngram Viewer as the source, and inclusion of a link to https://books.google.com/ngrams, would be appreciated."

CC BY 3.0 section 4(b) (<https://creativecommons.org/licenses/by/3.0/legalcode>) requires, when distributing an adaptation: keep copyright notices intact, name the author or attribution party, give the title and the licensor's URI, and credit the use of the work in the adaptation. Section 4(a) requires a copy or the URI of the license.

Size: English 1-grams are 24 files and 2-grams are 589 files, each about 600 MB gzipped (`Content-Length` of `1-00010-of-00024.gz` is 601,722,860 and of `2-00300-of-00589.gz` is 600,148,503). That is about 14 GB for 1-grams and about 350 GB for 2-grams. The export index also links a public BigQuery copy (<https://console.cloud.google.com/marketplace/product/bigquery-public-data/google-books-ngrams-2020>).

**wordfreq** (considered, not in the original list). README (<https://github.com/rspeer/wordfreq>): code is Apache, data "may be redistributed under a Creative Commons Attribution-ShareAlike 4.0 license". The author asks people not to convert it to CSV or similar flat files. It has single-word frequencies only. Rejected: share-alike terms, no two-word counts, and the conversion request.

**SCOWL / ESDB (SCOWLv2).** README (<https://github.com/en-wl/wordlist/blob/v2/README.md>): "ESDB is derived from many sources under a BSD compatible license. The combined work is freely available under an MIT-like license." The `Copyright` file (<https://github.com/en-wl/wordlist/blob/v2/Copyright>) says:

> Permission to use, copy, modify, distribute, and sell any part of the English Speller Database (ESDB, previously known as SCOWLv2), or word lists created from it, is hereby granted without fee, provided that the above copyright notice appears in all copies and that both the above copyright notice and this notice appear in supporting documentation.
>
> If you are using an official speller dictionary created by ESDB that is not Australian English, then no additional copyright applies and including the notice before the === is sufficient.
>
> If you are using a generated word list larger than 80, the copyright after '=== UKACD' applies.

An American list at size 60 needs only the first notice. The AU and UKACD clauses do not apply.

### Decision

**Word counts:** Google Books Ngram, English, version 20200217, under CC BY 3.0. It covers both single words (1-grams) and two-word counts (2-grams), so tickets 03 and 04 use the same source.

Notes for the build script in ticket 03:

- Counts are split by year. Sum `match_count` over all years for each ngram.
- Tokens can carry part-of-speech suffixes such as `_NOUN`, and some files hold tag-only ngrams such as `_ADJ_`. Drop tagged forms and keep the plain token, so tagged and untagged counts are not added twice.
- Keep `_START_`. The FAQ says it marks the start of a sentence, and 2-grams that begin with it give ticket 04 its sentence-start context. Drop `_END_` and the other tag-only tokens.
- The FAQ does not say how v3 tokenizes contractions. Check whether words like `don't` appear whole or split before relying on them, since the engine and ticket 06 keep apostrophes inside words.
- Lowercase and merge case variants, then keep the top N words and pairs.
- Reading all 2-grams streams about 350 GB once. Running the query on BigQuery instead avoids the download. Either way this runs at build time, and only the trimmed prior ships.
- omp's `TRUSTED_WEB_COUNT = 200,000` was set for Web 1T counts. Nothing here shows that it transfers to Books counts. Ticket 05 picks the threshold by measuring Books counts, and this ticket leaves that choice open.

**Dictionary:** ESDB (SCOWLv2) size 60, American English (`./scowl word-list 60 A 1`), from <https://github.com/en-wl/wordlist> branch `v2`. The build script pins the commit it used. The list ships with ticket 05.

### Attribution the package must ship

Put this in a `NOTICE` file at the package root, include it in the published package, and link it from the README.

```text
This package includes word and two-word counts derived from the Google Books
Ngram dataset, English, version 20200217, by Google Books
(https://books.google.com/ngrams). The source data is licensed under the
Creative Commons Attribution 3.0 Unported License
(https://creativecommons.org/licenses/by/3.0/). Source data © 2019 Google.
The counts were summed over
years, lowercased, stripped of part-of-speech tags and cut to the most frequent
entries. Google does not endorse this package.

This package includes a word list generated from the English Speller Database
(ESDB, previously known as SCOWLv2), size 60, American English
(https://github.com/en-wl/wordlist).

Copyright 2000-2026 by Kevin Atkinson

Permission to use, copy, modify, distribute, and sell any part of the English
Speller Database (ESDB, previously known as SCOWLv2), or word lists
created from it, is hereby granted without fee, provided that the above
copyright notice appears in all copies and that both the above copyright
notice and this notice appear in supporting documentation.  Kevin Atkinson
makes no representations about the suitability of this database for any
purpose.  It is provided "as is" without express or implied warranty.
```

The ESDB notice must also sit at the top of the shipped word-list file, because the license asks for it "in all copies". If the pinned ESDB commit shows a different copyright year, copy the notice from that commit word for word.
