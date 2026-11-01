import { describe, expect, it } from "vitest"
import { TestClient } from "../test/client"
import { goalWorld, taskTitleOf } from "../test/fakes"
import { trpcMutation, trpcQuery } from "../test/helpers"

type Detail = {
  id: string
  title: string
  status: string
  statusReason: string | null
  rounds: number
  managerTurns: number
  nodes: Array<{
    id: string
    kind: string
    status: string
    title: string
    taskId: string | null
    verdict: string | null
    round: number
  }>
  edges: Array<{ sourceNodeId: string; targetNodeId: string }>
  tasks: Array<{
    id: string
    title: string
    status: string
    result: string | null
    error: string | null
    attempts: number
    topicId: string | null
  }>
  decisions: Array<{
    id: string
    nodeId: string
    status: string
    question: string
    options: Array<{ id: string; label: string }>
  }>
  events: Array<{ eventType: string; reason: string | null }>
}

async function createGoal(
  client: TestClient,
  input: Record<string, unknown> = {}
): Promise<string> {
  const created = await trpcMutation<{ id: string }>(client, "goal.create", {
    title: "Explain Workers",
    requirement: "A one-paragraph summary",
    ...input,
  })
  expect(created.response.status).toBe(200)
  return created.data!.id
}

async function detail(client: TestClient, id: string): Promise<Detail> {
  return (await trpcQuery<Detail>(client, "goal.get", { id })).data!
}

const RESEARCH_THEN_WRITE = {
  action: "tasks",
  reason: "Research first, then write it up",
  tasks: [
    { title: "Research the topic", description: "Collect the key facts." },
    {
      title: "Write the summary",
      description: "Summarise the facts.",
      dependsOn: [0],
    },
  ],
}

describe("goals", () => {
  it("decomposes a goal into a task graph, runs it in dependency order and verifies it", async () => {
    const world = await goalWorld({
      plans: [RESEARCH_THEN_WRITE],
      results: { "Research the topic": "Fact: Workers run code at the edge." },
    })
    const id = await createGoal(world.client)

    const started = await trpcMutation(world.client, "goal.start", { id })
    const goal = await detail(world.client, id)

    expect(started.response.status).toBe(200)
    expect(goal).toMatchObject({ status: "achieved", rounds: 1 })
    // Two work nodes and the acceptance node that closes them.
    expect(goal.nodes.map((n) => [n.kind, n.title, n.status])).toEqual([
      ["task", "Research the topic", "delivered"],
      ["task", "Write the summary", "delivered"],
      ["verification", "Verify: Explain Workers", "delivered"],
    ])
    const [research, write, verify] = goal.nodes
    expect(goal.edges).toEqual([
      expect.objectContaining({
        sourceNodeId: write.id,
        targetNodeId: research.id,
      }),
      expect.objectContaining({
        sourceNodeId: verify.id,
        targetNodeId: write.id,
      }),
    ])
    expect(verify.verdict).toBe("pass")

    // Run in dependency order, and the second task was handed the first's result.
    expect(world.taskCalls().map((call) => taskTitleOf(call))).toEqual([
      "Research the topic",
      "Write the summary",
    ])
    expect(
      world.taskCalls()[1].body.messages.at(-1).content as string
    ).toContain("Fact: Workers run code at the edge.")

    // Each task's result is kept, with its conversation for inspection.
    const done = goal.tasks.find((t) => t.title === "Research the topic")!
    expect(done).toMatchObject({
      status: "completed",
      result: "Fact: Workers run code at the edge.",
      attempts: 1,
    })
    const topic = await trpcQuery<{
      messages: Array<{ role: string; content: string }>
    }>(world.client, "topic.get", { id: done.topicId })
    expect(topic.data?.messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
    ])
    expect(topic.data?.messages[1].content).toBe(
      "Fact: Workers run code at the edge."
    )

    expect(goal.events.map((e) => e.eventType)).toEqual(
      expect.arrayContaining([
        "goal_started",
        "plan_applied",
        "node_delivered",
        "goal_achieved",
      ])
    )
  })

  it("keeps task workspaces out of the chat list but open to inspection", async () => {
    const world = await goalWorld({ plans: [RESEARCH_THEN_WRITE] })
    const id = await createGoal(world.client)

    await trpcMutation(world.client, "goal.start", { id })

    const chats = await trpcQuery<unknown[]>(world.client, "topic.list")
    expect(chats.data).toEqual([])
    expect((await detail(world.client, id)).tasks[0].topicId).toEqual(
      expect.any(String)
    )
  })

  it("does not run a task twice when two workflow runs overlap", async () => {
    const world = await goalWorld({ plans: [RESEARCH_THEN_WRITE] })
    world.workflows.autoRun = false // record the run instead of executing it
    const id = await createGoal(world.client)
    await trpcMutation(world.client, "goal.start", { id })

    await Promise.all([world.workflows.replay(), world.workflows.replay()])

    expect((await detail(world.client, id)).status).toBe("achieved")
    expect(world.taskCalls().map((call) => taskTitleOf(call))).toEqual([
      "Research the topic",
      "Write the summary",
    ])
    expect(world.plannerCalls()).toHaveLength(2) // the plan and the verify turn
  })

  it("ignores a second run of a finished goal", async () => {
    const world = await goalWorld({ plans: [RESEARCH_THEN_WRITE] })
    const id = await createGoal(world.client)
    await trpcMutation(world.client, "goal.start", { id })
    const callsBefore = world.ai.chat().length

    await world.workflows.replay()

    expect(world.ai.chat()).toHaveLength(callsBefore)
    expect((await detail(world.client, id)).status).toBe("achieved")
  })
})

const ONE_FLAKY_TASK = {
  action: "tasks",
  reason: "One task",
  tasks: [{ title: "Flaky task", description: "Do the thing." }],
}

describe("failures and human gates", () => {
  it("retries a task that fails once, without bothering anyone", async () => {
    const world = await goalWorld({
      plans: [ONE_FLAKY_TASK],
      failures: { "Flaky task": 1 },
    })
    const id = await createGoal(world.client)

    await trpcMutation(world.client, "goal.start", { id })
    const goal = await detail(world.client, id)

    expect(goal.status).toBe("achieved")
    expect(goal.tasks.find((t) => t.title === "Flaky task")).toMatchObject({
      status: "completed",
      attempts: 2,
    })
    expect(goal.decisions).toEqual([])
    expect(
      goal.events.find((e) => e.eventType === "node_failed")?.reason
    ).toContain("will retry")
  })

  it("pauses on a task that keeps failing and carries on once a person says retry", async () => {
    const world = await goalWorld({
      plans: [ONE_FLAKY_TASK],
      failures: { "Flaky task": 2 },
    })
    const id = await createGoal(world.client)

    await trpcMutation(world.client, "goal.start", { id })
    const paused = await detail(world.client, id)

    expect(paused).toMatchObject({
      status: "paused",
      statusReason: "Waiting for a person to decide what to do next",
    })
    expect(paused.nodes.find((n) => n.title === "Flaky task")?.status).toBe(
      "blocked"
    )
    const [gate] = paused.decisions
    expect(gate).toMatchObject({ status: "pending" })
    expect(gate.question).toContain("Flaky task")
    expect(gate.options.map((o) => o.id)).toEqual(["retry", "retire", "stop"])
    // Resuming is refused while the question is open.
    const early = await trpcMutation(world.client, "goal.resume", { id })
    expect(early.code).toBe("BAD_REQUEST")

    const answered = await trpcMutation(world.client, "goal.resolveDecision", {
      goalId: id,
      decisionId: gate.id,
      optionId: "retry",
    })
    const finished = await detail(world.client, id)

    expect(answered.response.status).toBe(200)
    expect(finished.status).toBe("achieved")
    expect(finished.decisions[0].status).toBe("resolved")
    expect(finished.tasks.find((t) => t.title === "Flaky task")).toMatchObject({
      status: "completed",
      attempts: 1, // a fresh attempt budget
    })
    // A question can only be answered once.
    const again = await trpcMutation(world.client, "goal.resolveDecision", {
      goalId: id,
      decisionId: gate.id,
      optionId: "retry",
    })
    expect(again.code).toBe("BAD_REQUEST")
  })

  it("lets a person skip a task that cannot be done", async () => {
    const world = await goalWorld({
      plans: [ONE_FLAKY_TASK],
      failures: { "Flaky task": 5 },
    })
    const id = await createGoal(world.client)
    await trpcMutation(world.client, "goal.start", { id })
    const [gate] = (await detail(world.client, id)).decisions

    await trpcMutation(world.client, "goal.resolveDecision", {
      goalId: id,
      decisionId: gate.id,
      optionId: "retire",
    })
    const goal = await detail(world.client, id)

    expect(goal.nodes.find((n) => n.title === "Flaky task")?.status).toBe(
      "retired"
    )
    expect(goal.status).toBe("achieved")
  })

  it("rejects an option that is not on offer", async () => {
    const world = await goalWorld({
      plans: [ONE_FLAKY_TASK],
      failures: { "Flaky task": 5 },
    })
    const id = await createGoal(world.client)
    await trpcMutation(world.client, "goal.start", { id })
    const [gate] = (await detail(world.client, id)).decisions

    const bogus = await trpcMutation(world.client, "goal.resolveDecision", {
      goalId: id,
      decisionId: gate.id,
      optionId: "continue",
    })

    expect(bogus.code).toBe("BAD_REQUEST")
  })

  it("pauses when the manager asks for a person, and plans again with their note", async () => {
    const world = await goalWorld({
      plans: [{ action: "escalate", reason: "Which audience is this for?" }],
    })
    const id = await createGoal(world.client)

    await trpcMutation(world.client, "goal.start", { id })
    const paused = await detail(world.client, id)
    const [gate] = paused.decisions
    expect(paused.status).toBe("paused")
    expect(gate.question).toBe("Which audience is this for?")
    expect(gate.options.map((o) => o.id)).toEqual(["continue", "stop"])

    await trpcMutation(world.client, "goal.resolveDecision", {
      goalId: id,
      decisionId: gate.id,
      optionId: "continue",
      note: "Write it for beginners.",
    })

    expect(
      world.plannerCalls().at(-1)!.body.messages.at(-1).content as string
    ).toContain("Write it for beginners.")
    expect((await detail(world.client, id)).status).toBe("achieved")
  })

  it("stops for good on request, withdrawing open work and questions", async () => {
    const world = await goalWorld({
      plans: [ONE_FLAKY_TASK],
      failures: { "Flaky task": 5 },
    })
    const id = await createGoal(world.client)
    await trpcMutation(world.client, "goal.start", { id })
    const [gate] = (await detail(world.client, id)).decisions

    const stopped = await trpcMutation(world.client, "goal.stop", { id })
    const goal = await detail(world.client, id)

    expect(stopped.response.status).toBe(200)
    expect(goal.status).toBe("stopped")
    expect(goal.nodes.every((n) => n.status === "retired")).toBe(true)
    expect(goal.decisions[0].status).toBe("canceled")
    const restart = await trpcMutation(world.client, "goal.start", { id })
    const answer = await trpcMutation(world.client, "goal.resolveDecision", {
      goalId: id,
      decisionId: gate.id,
      optionId: "retry",
    })
    const stopAgain = await trpcMutation(world.client, "goal.stop", { id })
    expect([restart.code, answer.code, stopAgain.code]).toEqual([
      "BAD_REQUEST",
      "BAD_REQUEST",
      "BAD_REQUEST",
    ])
  })
})

const tasks = (...titles: string[]) => ({
  action: "tasks",
  reason: `Do ${titles.join(", ")}`,
  tasks: titles.map((title) => ({ title, description: `${title}.` })),
})

describe("budgets and planning rules", () => {
  it("fails the goal when the round budget runs out, without running the extra round", async () => {
    const world = await goalWorld({
      plans: [tasks("First round"), tasks("Second round")],
    })
    const id = await createGoal(world.client, { maxRounds: 1 })

    await trpcMutation(world.client, "goal.start", { id })
    const goal = await detail(world.client, id)

    expect(goal.status).toBe("failed")
    expect(goal.statusReason).toContain("round budget")
    expect(goal.rounds).toBe(1)
    expect(world.taskCalls().map((c) => taskTitleOf(c))).toEqual([
      "First round",
    ])
  })

  it("fails the goal when the planning-turn budget runs out", async () => {
    const world = await goalWorld({
      plans: [tasks("One"), tasks("Two"), tasks("Three")],
    })
    const id = await createGoal(world.client, { maxManagerTurns: 2 })

    await trpcMutation(world.client, "goal.start", { id })
    const goal = await detail(world.client, id)

    expect(goal).toMatchObject({ status: "failed", managerTurns: 2 })
    expect(goal.statusReason).toContain("planning-turn budget")
    expect(world.plannerCalls()).toHaveLength(2)
  })

  it("refuses a plan with a bad dependency, writes nothing from it, and tells the manager why", async () => {
    const world = await goalWorld({
      plans: [
        {
          action: "tasks",
          reason: "Broken",
          tasks: [
            { title: "Needs the next one", description: "x.", dependsOn: [1] },
            { title: "The next one", description: "y." },
          ],
        },
        {
          action: "tasks",
          reason: "Unknown node",
          tasks: [
            { title: "Ghost", description: "z.", dependsOn: ["no-such-node"] },
          ],
        },
        tasks("Fine"),
      ],
    })
    const id = await createGoal(world.client, { maxManagerTurns: 5 })

    await trpcMutation(world.client, "goal.start", { id })
    const goal = await detail(world.client, id)

    // Two refusals in a row ask a person; nothing from either plan was written.
    expect(goal.status).toBe("paused")
    expect(goal.nodes.filter((n) => n.kind === "task")).toEqual([])
    expect(
      goal.events.filter((e) => e.eventType === "plan_rejected")
    ).toHaveLength(2)
    expect(goal.decisions[0].question).toContain(
      "could not produce a usable plan"
    )
    expect(
      world.plannerCalls()[1].body.messages.at(-1).content as string
    ).toContain("previous plan was refused")

    await trpcMutation(world.client, "goal.resolveDecision", {
      goalId: id,
      decisionId: goal.decisions[0].id,
      optionId: "continue",
    })
    expect((await detail(world.client, id)).status).toBe("achieved")
  })

  it("plans corrective work after a failed review, then verifies again", async () => {
    const world = await goalWorld({
      plans: [
        tasks("Draft"),
        { action: "verify", reason: "Looks done" },
        tasks("Fill the gaps"),
        { action: "verify", reason: "Now done" },
      ],
      verdicts: ["fail", "pass"],
    })
    const id = await createGoal(world.client)

    await trpcMutation(world.client, "goal.start", { id })
    const goal = await detail(world.client, id)

    expect(goal).toMatchObject({ status: "achieved", rounds: 2 })
    const reviews = goal.nodes.filter((n) => n.kind === "verification")
    expect(reviews.map((n) => n.verdict)).toEqual(["fail", "pass"])
    // The manager saw the failed verdict before planning the fix.
    expect(
      world.plannerCalls()[2].body.messages.at(-1).content as string
    ).toContain("verdict fail")
    // The second review covers both the draft and the fix.
    const second = reviews[1]
    const covered = goal.edges
      .filter((e) => e.sourceNodeId === second.id)
      .map((e) => goal.nodes.find((n) => n.id === e.targetNodeId)?.title)
    expect(covered.sort()).toEqual(["Draft", "Fill the gaps"])
  })

  it("runs independent tasks in the same round before the ones that depend on them", async () => {
    const world = await goalWorld({
      plans: [
        {
          action: "tasks",
          reason: "Fan out then join",
          tasks: [
            { title: "Left", description: "l." },
            { title: "Right", description: "r." },
            { title: "Join", description: "j.", dependsOn: [0, 1] },
          ],
        },
      ],
      results: { Left: "L-result", Right: "R-result" },
    })
    const id = await createGoal(world.client)

    await trpcMutation(world.client, "goal.start", { id })

    const order = world.taskCalls().map((c) => taskTitleOf(c))
    expect(order.at(-1)).toBe("Join")
    expect(order.slice(0, 2).sort()).toEqual(["Left", "Right"])
    const join = world.taskCalls().at(-1)!.body.messages.at(-1)
      .content as string
    expect(join).toContain("L-result")
    expect(join).toContain("R-result")
  })
})

describe("goal ownership", () => {
  it("keeps goals private to their owner", async () => {
    const world = await goalWorld({
      plans: [ONE_FLAKY_TASK],
      failures: { "Flaky task": 5 },
    })
    const outsider = await world.newClient()
    const id = await createGoal(world.client)
    await trpcMutation(world.client, "goal.start", { id })
    const [gate] = (await detail(world.client, id)).decisions

    const results = await Promise.all([
      trpcQuery(outsider, "goal.get", { id }),
      trpcMutation(outsider, "goal.start", { id }),
      trpcMutation(outsider, "goal.stop", { id }),
      trpcMutation(outsider, "goal.remove", { id }),
      trpcMutation(outsider, "goal.resolveDecision", {
        goalId: id,
        decisionId: gate.id,
        optionId: "retry",
      }),
    ])

    expect(results.map((r) => r.code)).toEqual(Array(5).fill("NOT_FOUND"))
    expect((await trpcQuery<unknown[]>(outsider, "goal.list")).data).toEqual([])
    expect((await detail(world.client, id)).status).toBe("paused")
  })

  it("only lets a goal use the caller's own agents", async () => {
    const world = await goalWorld()
    const outsider = await world.newClient()
    const theirs = await trpcMutation<{ id: string }>(
      outsider,
      "agent.create",
      {
        title: "Theirs",
      }
    )

    const supervisor = await trpcMutation(world.client, "goal.create", {
      title: "Goal",
      agentId: theirs.data!.id,
    })
    const executor = await trpcMutation(world.client, "goal.create", {
      title: "Goal",
      taskAgentId: theirs.data!.id,
    })

    expect([supervisor.code, executor.code]).toEqual(["NOT_FOUND", "NOT_FOUND"])
  })

  it("deletes a goal with its graph, and requires authentication", async () => {
    const world = await goalWorld({ plans: [RESEARCH_THEN_WRITE] })
    const id = await createGoal(world.client)
    await trpcMutation(world.client, "goal.start", { id })

    const removed = await trpcMutation(world.client, "goal.remove", { id })

    expect(removed.response.status).toBe(200)
    expect((await trpcQuery(world.client, "goal.get", { id })).code).toBe(
      "NOT_FOUND"
    )
    const anonymous = new TestClient()
    await anonymous.bootCsrf()
    expect((await trpcQuery(anonymous, "goal.list")).code).toBe("UNAUTHORIZED")
  })
})
