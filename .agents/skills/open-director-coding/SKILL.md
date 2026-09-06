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
