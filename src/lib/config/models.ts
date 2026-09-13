// Single place model choices are named — never hardcode a model string
// anywhere else in the codebase (see planner.ts / build-orchestrator.ts).
export const PLANNER_MODEL = process.env.PLANNER_MODEL || "claude-fable-5-1";
export const REPAIR_MODEL = process.env.REPAIR_MODEL || "claude-sonnet-5";
