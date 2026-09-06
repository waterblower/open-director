---
name: open-director-coding
description: Apply Open Director repository coding conventions when writing, editing, or reviewing code in this repository.
---

# Open Director Coding

## Rule 1: No one-line conditional bodies

Always use braces and a multiline body for `if`, `else if`, and `else`, even when the body contains only one statement. This includes guard clauses, error handling, and conditional assignments. Preserve the condition and behavior when expanding existing code.

Do not write:

```ts
if (value instanceof Error) return value;
```

Write:

```ts
if (value instanceof Error) {
    return value;
}
```

For Zod validation:

```ts
if (!parsed.success) {
    return parsed.error;
}
```

Do not compress a braced conditional onto one line either. Check code you add or modify for this rule before finishing; do not rewrite unrelated files solely to enforce it.

## Rule 2: Return handled errors; reserve throw for panic

In this codebase, `throw` strictly means "do not handle" or "panic". If an error needs handling by any caller, including logging, return an `Error` value instead of throwing it. Express that possibility in the return type, and let callers check `instanceof Error` before using the successful result.

```ts
const result = await generate(request, apiKey);
if (result instanceof Error) {
    console.error("Generation failed:", result);
    return result;
}
```

Return an existing error directly, or use `return new Error(message)` to create one. Do not throw an error with the expectation that another layer will catch, log, recover from, or display it.

## Rule 3: Catch native calls only

Never catch calls to functions defined in this codebase, whether with `try/catch` or Promise `.catch()`. Handle their returned `Error` values explicitly. Let intentional throws propagate as panics.

Only catch native calls that can throw or reject, such as Web API and Deno calls. Keep the `try` block narrowly scoped to the native operation; do not wrap repository function calls in it. Convert native failures into returned `Error` values when they need handling.

```ts
let response: Response;
try {
    response = await fetch(url);
} catch (error) {
    return error instanceof Error ? error : new Error(String(error));
}

const result = await parseResponse(response);
if (result instanceof Error) {
    return result;
}
```

## Rule 4: Prefer explicit data branching over function injection

When all data shapes are known, prefer explicit pattern matching on data and branching on discriminated unions, such as provider, model, or content type. Keep each variant's behavior visible in its branch instead of injecting callbacks or OO-style strategies to choose that behavior.

Use ordinary helpers with concrete data arguments for shared operations. Do not add callback-based abstractions for a closed set of known variants. This preference does not prohibit callbacks required by framework APIs or ordinary collection operations.

## Rule 5: Public interface first, private helpers last

Always put exported public code at the top of the file, immediately after imports. Put file-local, non-exported helper functions, types, and constants below the public code. A reader should encounter the module's public interface before its implementation helpers.

Preserve runtime initialization dependencies when reordering declarations; do not introduce access to an uninitialized binding.
