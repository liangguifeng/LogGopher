# Commenting Conventions

All source-code comments are written in English. Comments document contracts,
constraints, and non-obvious decisions; they do not translate each statement
into prose.

## Go

Use GoDoc comments for every exported type, function, method, variable, and
constant. Start the sentence with the exact exported identifier so `go doc`
and documentation linters can associate it correctly.

```go
// Query executes a normalized log query for an active session.
func (s *Service) Query(input domain.QueryInput) (domain.QueryResult, error) {
    // Implementation omitted.
}
```

Document unexported code only when its purpose, invariant, security boundary,
or workaround is not apparent from its name and implementation. Prefer a
comment that explains why a branch exists over a comment that repeats what it
does.

## React and TypeScript

Use JSDoc for exported components, shared types, reusable hooks, pure helper
functions, and callbacks with non-trivial side effects or keyboard semantics.

```tsx
/** Runs the current editor text against the active logstore. */
async function search(): Promise<void> {
    // Implementation omitted.
}

/** Renders normalized logs in raw and table views. */
export default function LogResults(props: Props) {
    // Implementation omitted.
}
```

Do not comment obvious state setters, JSX markup, or trivial event forwarding.
Use descriptive names instead. Keep implementation comments immediately above
the decision they explain and update them whenever the associated behavior
changes.
