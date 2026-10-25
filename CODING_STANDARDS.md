# Coding standards

These rules apply to `src/`, `extensions/`, and `test/`. Where a rule matches what `tsc` (with `tsconfig.json`) already enforces, it is listed so you know why the code looks the way it does, not as extra review work.

## TypeScript

### Write only erasable syntax

`pnpm test` runs `node --test` on the `.ts` files directly. Node 24 strips types without compiling, so any TypeScript syntax that emits JavaScript fails with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. Do not use:

- `enum` and `const enum`. Use a union of string literals, or an `as const` object when you need the values at runtime.
- `namespace` with runtime members. Use a module.
- Constructor parameter properties. Declare the field and assign it in the constructor.

```ts
// Bad: fails under node --test.
constructor(private readonly backend: WordPredictionBackend) {}

// Good
private readonly backend: WordPredictionBackend;

constructor(backend: WordPredictionBackend) {
	this.backend = backend;
}
```

### Modules and imports

- Use ES modules only (`"type": "module"`). No `require`.
- Import local files with the `.ts` extension: `import { paintGhost } from "./ghost-text.ts";`. `nodenext` resolution and Node's type stripping both need the real file name.
- Import types with `import type`, or with an inline `type` marker when the same import also brings in values: `import { CURSOR_MARKER, type EditorTheme } from "@earendil-works/pi-tui";`. `verbatimModuleSyntax` rejects a type imported as a value.
- Use named exports in `src/`. The only default export is the extension factory in `extensions/index.ts`, because pi requires it.
- Import pi APIs from the package root (`@earendil-works/pi-tui`, `@earendil-works/pi-coding-agent`), never from `dist/` paths. The package roots are what pi documents, and deep paths can change between releases.
- Order imports: Node built-ins (`node:` prefix), then packages, then local files.

### Naming

- `camelCase` for variables, functions, methods, and fields.
- `PascalCase` for classes, interfaces, and type aliases. No `I` prefix and no `Type` suffix.
- `UPPER_SNAKE_CASE` for module-level constants that hold fixed data: `MAX_BEFORE`, `DEFAULT_WORDS`. Constants that hold objects with behavior, such as `segmenter`, use `camelCase`.
- `kebab-case.ts` for file names. Name the file after its main export: `WordCompletionEditor` lives in `word-completion-editor.ts`.
- Prefix a parameter with `_` when an interface requires it but the implementation does not read it: `complete(_before: string, prefix: string)`.
- Name booleans as questions: `painted`, `isAppKey`, `hasUI`.
- Use the domain terms the code already uses (ghost, suffix, prefix, backend) in names. Do not invent synonyms. Once `GLOSSARY.md` exists, it is the source for these terms.

### Types and interfaces

- Use `interface` for object shapes and for contracts a class implements (`WordPredictionBackend`, `GhostOptions`). This follows the TypeScript handbook's advice to use `interface` until you need a feature only `type` has.
- Use `type` for unions, function types, tuples, and mapped or derived types.
- Annotate the parameters and return types of exported functions and public methods. Let TypeScript infer local variables.
- Mark fields `readonly` unless the class reassigns them, and use `private` for members outside the public API. Use `readonly string[]` for arrays the code does not mutate.
- Write optional fields as `field: T | undefined` when the value is always assigned, and `field?: T` only when callers may leave it out.
- Prefer `satisfies T` to an annotation when you need both the check and the literal type.

### `unknown`, `any`, and assertions

The test rule below (shoehorn instead of `as unknown as T`) is one case of a general rule: never tell the compiler to stop checking a value when you can prove its type instead.

- Do not write `any`, explicitly or through untyped code. For a value of unknown shape, such as parsed JSON or an `event.data` payload, type it `unknown` and narrow it with `typeof`, `in`, `Array.isArray`, or a type guard before use.
- Do not write `as T` or `as unknown as T` in `src/` or `extensions/`. If the type is wrong, fix the type or narrow the value. The allowed cast is `as const`.
- In tests, build stubs with shoehorn as described under [Tests](#tests). The one remaining double cast is the documented `KeybindingsManager` case.
- `tsconfig.json` enables `noUncheckedIndexedAccess`, so `lines[i]` has type `string | undefined`. Handle `undefined`. Use the non-null assertion `!` only on the line directly after a check that proves the value exists, so a reviewer can see the proof:

```ts
const row = lines.findIndex((line) => line.includes(END_CURSOR));
if (row === -1) return unchanged;
const line = lines[row]!;
```

- Write type guards as `function isX(value: unknown): value is X`. Keep the check and the claimed type in sync. A wrong guard is as unsafe as a cast.

### `null` and `undefined`

- Use `undefined` for "absent": optional fields, missing results of internal helpers (`buildQuery` returns `Query | undefined`), and cleared state.
- Use `null` only where an existing contract already uses it. `WordPredictionBackend.complete` resolves to `string | null`, and `WordCompletionProvider.getWordCompletion` returns `string | null`. Do not mix both in one value.
- Use `??` and `?.`, not `||`, when `0` or `""` would be a valid value. Use `||` only when every falsy value should be replaced, and say so in a comment if it is not obvious.

### Errors and async

- Document in the interface whether an async method can reject, as `WordPredictionBackend` does ("`complete` never rejects"). A method that promises not to reject must catch its own errors and resolve to its "no result" value.
- Mark a deliberately unawaited promise with `void` (`void this.backend.complete(...)`), and attach the handling it needs. Never leave a promise floating without `void`.
- Throw `Error` objects (or subclasses), never strings or plain objects. In a `catch`, the error is `unknown`. Check `error instanceof Error` before reading `message`.
- Do not catch an error only to ignore it. If ignoring is correct, write a comment saying why.
- Code that runs in a render path (`render`, `paintGhost`) must not throw for ordinary input. Return the unchanged lines, as `paintGhost` does, instead of failing the whole paint.

### Comments

- Give every exported function, class, and interface a one-line `/** ... */` comment saying what it is or what it guarantees. Document contracts on interface members.
- Use `//` comments to explain why, especially when the code depends on pi internals (`// pi's Editor.render emits exactly this ...`). Do not restate what the code does.

### Formatting

No formatter is configured. Match the existing code:

- Tabs for indentation, double quotes, semicolons.
- Trailing commas in multi-line argument lists, arrays, and objects.
- Lines up to about 130 columns, counting a tab as 4.
- Early returns instead of nested `if` blocks.

## Pi package rules

These come from pi's [Packages](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md), [Extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md), and [Terminal UI](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/tui.md) docs. pi.dev links to the same documents. A local copy ships in `node_modules/@earendil-works/pi-coding-agent/docs/`.

### Manifest and dependencies

- Keep `"pi-package"` in `keywords`, so the package can appear in the [pi package gallery](https://pi.dev/packages), and list entry points under the `pi` key (`"extensions": ["./extensions/index.ts"]`).
- Declare packages that pi provides to extensions in `peerDependencies` with the range `"*"`. They are `@earendil-works/pi-ai`, `@earendil-works/pi-agent-core`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, and `typebox`. Never list them in `dependencies` and never bundle them. A second copy can create duplicate classes and registries, and pi warns about it.
- Pin the same host packages in `devDependencies` (currently `1.4.0`) so `tsc` and the tests run against a known version.
- Put other packages that `src/` or `extensions/` import at runtime in `dependencies`. Test-only tools such as shoehorn go in `devDependencies`.
- Do not rely on another installed pi package sharing a dependency instance with this one. Each package loads with its own module root.

### Extension lifecycle

- `extensions/index.ts` default-exports a factory that receives `ExtensionAPI`. The factory only registers handlers and creates plain objects.
- Do not start processes, sockets, watchers, or timers in the factory. Some invocations load extensions without starting a session. Start long-lived resources in `session_start` or in the command or tool that needs them.
- Release session resources in a `session_shutdown` handler, and make it safe to run more than once.
- Guard UI work. Use `ctx.hasUI` for interactions that interactive and RPC clients both support, and `ctx.mode === "tui"` for terminal-only behavior. `extensions/index.ts` checks only `ctx.hasUI` before `ctx.ui.setEditorComponent`, which is enough because RPC mode ignores that call. Code that does terminal work itself, outside a pi UI call, must check `ctx.mode`.
- After `ctx.reload()`, do not reuse state from the old runtime.

### Editor and rendering

- Extend `CustomEditor` to replace the main editor, and pass keys the editor does not handle to `super.handleInput`. This keeps pi's shortcuts and agent controls working.
- Read configurable keys through the injected `KeybindingsManager`, as `WordCompletionEditor.handleInput` does. Do not hard-code key sequences in `src/`.
- Every line from `render(width)` must fit within `width`. Measure with `visibleWidth()`, and use `truncateToWidth()`, `sliceByColumn()`, or `wrapTextWithAnsi()`. Never use `string.length` for display width, because ANSI codes, wide characters, and combining marks break it.
- Reapply styling on each rendered line. Pi resets styles at line ends.
- Put `CURSOR_MARKER` directly before the visual cursor and wrap the cursor cell in `renderFakeCursor()`. Input method editors use the marker to place their candidate window.
- After state changes outside an input event, such as an async backend answer, call the injected `tui.requestRender()`. Do not create a second terminal renderer.
- Use pi's theme, through `ctx.ui.theme` or the injected `EditorTheme`, for colors. Do not hard-code ANSI color codes in `src/`.

## Tests

### Build stubs with shoehorn, not double casts

Do not write `as unknown as T` in tests. The double cast turns off type checking for the whole object. A misspelled field or a wrong value type compiles, and the test fails at runtime or, worse, passes for the wrong reason.

Use `@total-typescript/shoehorn` (a dev dependency) to build test doubles. Import only from test files, never from `src/` or `extensions/`.

#### Partial stubs: `fromPartial<T>()`

When the code under test reads only a few members of a large type, pass just those members to `fromPartial`. Every field you pass is checked against `T`, and nested objects may be partial too.

```ts
import { fromPartial } from "@total-typescript/shoehorn";

// Bad: typos and wrong types compile.
const tui = { terminal: { rows: 40, columns: 80 }, requestRender: () => renders++ } as unknown as TUI;

// Good: only the fields the editor uses, each one type-checked.
const tui = fromPartial<TUI>({ terminal: { rows: 40, columns: 80 }, requestRender: () => renders++ });
const theme = fromPartial<EditorTheme>({ borderColor: (s: string) => s, selectList: {} });
```

Always write the type argument (`fromPartial<TUI>(...)`) when assigning to a `const`. Without a contextual type, `T` is not inferred and the result is `unknown`. When the stub goes straight into a typed parameter, the type argument can be left out.

A stub covers only the members you listed. If the code under test starts calling a member the stub lacks, the test throws at runtime. Add the member to the stub; do not switch back to a cast.

#### Deliberately wrong data: `fromAny<T, U>()`

When a test passes a value of the wrong type on purpose, for example to check how code handles bad input from a backend, use `fromAny`. It keeps autocomplete for the correct shape and marks the wrong data as intentional.

```ts
import { fromAny } from "@total-typescript/shoehorn";

const backend = fromAny<WordPredictionBackend, unknown>({ complete: () => Promise.resolve(42) });
```

#### Full fixtures: `fromExact<T>()`

Use `fromExact` when the test must pass a complete value. It requires every field of `T`, and it can later be swapped for `fromPartial` without touching the object.

#### When a cast is still allowed

Shoehorn is for plain object literals. It does not apply when the value is a real instance of a related class. In that case keep the cast, and add a comment saying why.

The one case in this repo: tests build a real `KeybindingsManager` from `@earendil-works/pi-tui`, but `WordCompletionEditor` takes pi-coding-agent's `KeybindingsManager`, a subclass with extra members. The base instance behaves correctly for the editor, so the cast is kept:

```ts
// Real pi-tui instance; pi-coding-agent's KeybindingsManager subclass adds only members the editor does not use.
const keybindings = new TuiKeybindingsManager(TUI_KEYBINDINGS) as unknown as KeybindingsManager;
```
