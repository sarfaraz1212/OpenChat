import type { Goal, GoalEdge, GoalNode, Task } from "../db/types"

/**
 * The stable first words of each system prompt; test fakes use them to tell
 * planning, review and task execution apart.
 */
export const GOAL_MANAGER_ROLE = "goal manager"
export const VERIFIER_ROLE = "independent reviewer"

const JSON_ONLY = "Respond with ONLY a JSON object and no other text."

export function managerSystem(): string {
  return [
    `You are the ${GOAL_MANAGER_ROLE} for OpenChat. You plan how a team of assistants reaches a goal by proposing tasks, one round at a time, and you decide when the finished work is ready to be checked.`,
    "Each round you see the goal, what counts as done, the budget, and the task graph so far with results. Choose ONE action:",
    [
      '- "tasks": propose 1 to 10 new tasks. Each has a title, a self-contained description (the assistant sees only that description, the goal, and the results of the tasks it depends on) and an optional "dependsOn": ids of existing tasks, or 0-based positions of EARLIER tasks in this same list. Tasks with no dependencies run in parallel. Do not repeat work that is already delivered.',
      '- "verify": ask an independent reviewer to check the delivered work against the requirement. Choose it only when the delivered results should satisfy the requirement. If the latest verification failed, plan the corrective tasks first.',
      '- "escalate": stop and ask a person, with a concrete reason, when you are blocked or the goal is unclear.',
    ].join("\n"),
    `${JSON_ONLY} Shapes: {"action": "tasks", "reason": string, "tasks": [{"title": string, "description": string, "dependsOn": [number | string]}]} | {"action": "verify", "reason": string} | {"action": "escalate", "reason": string}`,
  ].join("\n\n")
}

export type Snapshot = {
  goal: Goal
  nodes: GoalNode[]
  edges: GoalEdge[]
  tasks: Task[]
  /** Notes people left when resolving gates. */
  guidance: string[]
  /** Why the previous plan was refused, if it was. */
  rejection: string | null
}

const excerpt = (text: string | null, max = 400) =>
  !text ? "" : text.length > max ? `${text.slice(0, max)}…` : text

export function managerUser(snapshot: Snapshot): string {
  const { goal, nodes, edges, tasks } = snapshot
  const taskOf = new Map(tasks.map((task) => [task.id, task]))
  const lines = nodes.map((node) => {
    const dependsOn = edges
      .filter((edge) => edge.sourceNodeId === node.id)
      .map((edge) => edge.targetNodeId)
    const task = node.taskId ? taskOf.get(node.taskId) : undefined
    return [
      `- id=${node.id} [${node.kind}, ${node.status}${node.verdict ? `, verdict ${node.verdict}` : ""}] ${node.title}`,
      dependsOn.length ? `  depends on: ${dependsOn.join(", ")}` : "",
      task?.result ? `  result: ${excerpt(task.result)}` : "",
    ]
      .filter(Boolean)
      .join("\n")
  })
  const maxTurns = goal.config.maxManagerTurns ?? 12
  return [
    `Goal: ${goal.title}`,
    `Requirement (what counts as done): ${goal.requirement || "(none stated)"}`,
    `Budget: planning round ${goal.rounds} of ${goal.maxRounds} used; planning turn ${goal.managerTurns} of ${maxTurns} used.`,
    snapshot.guidance.length
      ? `Guidance from the person in charge:\n${snapshot.guidance.map((note) => `- ${note}`).join("\n")}`
      : "",
    snapshot.rejection
      ? `Your previous plan was refused: ${snapshot.rejection} Fix that and answer again.`
      : "",
    `Task graph so far:\n${lines.length ? lines.join("\n") : "(empty: nothing planned yet)"}`,
  ]
    .filter(Boolean)
    .join("\n\n")
}

const clip = (text: string | null, max = 2000) =>
  !text ? "" : text.length > max ? `${text.slice(0, max)}…` : text

/** What a task's executor is asked to do; its first line is `Task: <title>`. */
export function executorUser(params: {
  goal: Goal
  title: string
  description: string | null
  prerequisites: Array<{ title: string; result: string | null }>
}): string {
  return [
    `Task: ${params.title}`,
    params.description ?? "",
    `Goal: ${params.goal.title}\nRequirement: ${params.goal.requirement || "(none stated)"}`,
    params.prerequisites.length
      ? "Results of the tasks this one depends on:\n" +
        params.prerequisites
          .map((task) => `### ${task.title}\n${clip(task.result)}`)
          .join("\n\n")
      : "",
    "Do the task and reply with its result only.",
  ]
    .filter(Boolean)
    .join("\n\n")
}

export function verifierSystem(): string {
  return [
    `You are an ${VERIFIER_ROLE}. Decide whether the delivered work satisfies the requirement of the goal. Judge against the stated requirement only; be strict but fair.`,
    `${JSON_ONLY} Shape: {"verdict": "pass" | "fail", "reason": string}`,
  ].join("\n\n")
}

export function verifierUser(params: {
  goal: Goal
  delivered: Array<{ title: string; result: string | null }>
}): string {
  return [
    `Verify: ${params.goal.title}`,
    `Requirement: ${params.goal.requirement || "(none stated)"}`,
    "Delivered work:\n" +
      params.delivered
        .map((task) => `### ${task.title}\n${clip(task.result)}`)
        .join("\n\n"),
  ].join("\n\n")
}
