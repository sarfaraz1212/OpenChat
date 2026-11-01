import { describe, expect, it } from "vitest"
import { TestClient } from "../test/client"
import { signedInClient, trpcMutation, trpcQuery } from "../test/helpers"

type Agent = { id: string; title: string }

type Group = {
  id: string
  title: string | null
  description: string | null
  avatar: string | null
  backgroundColor: string | null
  pinned: boolean
  members: Array<{
    id: string
    title: string | null
    avatar: string | null
    enabled: boolean
    role: string
  }>
}

async function agent(client: TestClient, title: string): Promise<Agent> {
  const created = await trpcMutation<Agent>(client, "agent.create", { title })
  return created.data!
}

async function group(
  client: TestClient,
  input: Record<string, unknown>
): Promise<Group> {
  const created = await trpcMutation<Group>(client, "agentGroup.create", input)
  expect(created.response.status).toBe(200)
  return created.data!
}

const memberTitles = (g: Group | undefined) => g?.members.map((m) => m.title)

describe("agent groups", () => {
  it("creates a group of agents and lists its members in the order given", async () => {
    const client = await signedInClient()
    const writer = await agent(client, "Writer")
    const editor = await agent(client, "Editor")

    const created = await group(client, {
      title: "Newsroom",
      description: "Drafts and edits",
      avatar: "📰",
      agentIds: [editor.id, writer.id],
    })

    expect(created).toMatchObject({
      title: "Newsroom",
      description: "Drafts and edits",
      avatar: "📰",
      pinned: false,
    })
    expect(memberTitles(created)).toEqual(["Editor", "Writer"])
    const loaded = await trpcQuery<Group>(client, "agentGroup.get", {
      id: created.id,
    })
    expect(loaded.data).toEqual(created)
    const list = await trpcQuery<Group[]>(client, "agentGroup.list")
    expect(list.data).toEqual([created])
  })

  it("adds and removes members, ignoring duplicates", async () => {
    const client = await signedInClient()
    const a = await agent(client, "A")
    const b = await agent(client, "B")
    const c = await agent(client, "C")
    const created = await group(client, { title: "Team", agentIds: [a.id] })

    await trpcMutation(client, "agentGroup.addAgents", {
      id: created.id,
      agentIds: [b.id, a.id, c.id],
    })
    const afterAdd = await trpcQuery<Group>(client, "agentGroup.get", {
      id: created.id,
    })
    await trpcMutation(client, "agentGroup.removeAgent", {
      id: created.id,
      agentId: b.id,
    })
    const afterRemove = await trpcQuery<Group>(client, "agentGroup.get", {
      id: created.id,
    })

    expect(memberTitles(afterAdd.data)).toEqual(["A", "B", "C"])
    expect(memberTitles(afterRemove.data)).toEqual(["A", "C"])
  })

  it("edits and pins a group", async () => {
    const client = await signedInClient()
    const created = await group(client, { title: "Old name" })

    const updated = await trpcMutation<Group>(client, "agentGroup.update", {
      id: created.id,
      title: "New name",
      description: "Now with a description",
      pinned: true,
    })

    expect(updated.data).toMatchObject({
      title: "New name",
      description: "Now with a description",
      pinned: true,
    })
  })

  it("keeps agents when their group is deleted, and drops a deleted agent from its groups", async () => {
    const client = await signedInClient()
    const kept = await agent(client, "Kept")
    const doomed = await agent(client, "Doomed")
    const teamA = await group(client, {
      title: "A",
      agentIds: [kept.id, doomed.id],
    })
    const teamB = await group(client, { title: "B", agentIds: [kept.id] })

    await trpcMutation(client, "agent.remove", { id: doomed.id })
    const afterAgentDelete = await trpcQuery<Group>(client, "agentGroup.get", {
      id: teamA.id,
    })
    const removed = await trpcMutation(client, "agentGroup.remove", {
      id: teamB.id,
    })
    const stillThere = await trpcQuery<Agent>(client, "agent.get", {
      id: kept.id,
    })

    expect(memberTitles(afterAgentDelete.data)).toEqual(["Kept"])
    expect(removed.response.status).toBe(200)
    expect(stillThere.data?.title).toBe("Kept")
    const list = await trpcQuery<Group[]>(client, "agentGroup.list")
    expect(list.data?.map((g) => g.id)).toEqual([teamA.id])
  })

  it("refuses to add another user's agent, and adds nothing when it does", async () => {
    const owner = await signedInClient()
    const outsider = await signedInClient()
    const mine = await agent(owner, "Mine")
    const theirs = await agent(outsider, "Theirs")

    const rejected = await trpcMutation(owner, "agentGroup.create", {
      title: "Sneaky",
      agentIds: [mine.id, theirs.id],
    })
    const created = await group(owner, { title: "Fine", agentIds: [mine.id] })
    const rejectedAdd = await trpcMutation(owner, "agentGroup.addAgents", {
      id: created.id,
      agentIds: [theirs.id],
    })

    expect(rejected.code).toBe("NOT_FOUND")
    expect(rejectedAdd.code).toBe("NOT_FOUND")
    const list = await trpcQuery<Group[]>(owner, "agentGroup.list")
    expect(list.data?.map((g) => g.title)).toEqual(["Fine"])
    expect(memberTitles(list.data?.[0])).toEqual(["Mine"])
  })

  it("keeps groups private to their owner", async () => {
    const owner = await signedInClient()
    const outsider = await signedInClient()
    const created = await group(owner, { title: "Private" })

    const read = await trpcQuery(outsider, "agentGroup.get", { id: created.id })
    const update = await trpcMutation(outsider, "agentGroup.update", {
      id: created.id,
      title: "Hijacked",
    })
    const remove = await trpcMutation(outsider, "agentGroup.remove", {
      id: created.id,
    })
    const list = await trpcQuery<Group[]>(outsider, "agentGroup.list")

    expect([read.code, update.code, remove.code]).toEqual([
      "NOT_FOUND",
      "NOT_FOUND",
      "NOT_FOUND",
    ])
    expect(list.data).toEqual([])
  })

  it("requires authentication", async () => {
    const anonymous = new TestClient()
    await anonymous.bootCsrf()

    const list = await trpcQuery(anonymous, "agentGroup.list")

    expect(list.code).toBe("UNAUTHORIZED")
  })
})
