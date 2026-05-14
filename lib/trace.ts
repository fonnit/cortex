// v1 noop wrapper for LLM tracing. Swap LangSmith (or any provider) here when
// observability surfaces a need. The signature stays stable so callers don't
// change. See plan: ~/.claude/plans/compressed-wobbling-treehouse.md
//   ### Architecture finding 4B — drop Langfuse from v1

export async function trace<T>(_name: string, fn: () => Promise<T>): Promise<T> {
  return fn()
}
