import {
  CHAT_MODEL_INFOS,
  PROVIDERS,
  type ProviderId,
} from "../../shared/models"
import type { AppBindings } from "../env"
import * as aiInfra from "./db/ai-infra"

/**
 * The static model catalog merged with one user's enable/disable overrides.
 * Routers call these; they never touch the override tables directly.
 */

export function isProviderConfigured(env: AppBindings): boolean {
  return Boolean(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN)
}

export async function listModels(
  db: D1Database,
  userId: string,
  providerId: ProviderId
) {
  const overrides = await aiInfra.listModelOverrides(db, userId, providerId)
  return CHAT_MODEL_INFOS.map((model) => ({
    id: model.id,
    providerId,
    displayName: model.name,
    organization: model.author,
    bestFor: model.bestFor,
    type: "chat" as const,
    enabled: overrides.get(model.id) ?? true,
    abilities: model.abilities,
    contextWindowTokens: model.contextWindowTokens,
  }))
}

export async function listProviders(
  db: D1Database,
  env: AppBindings,
  userId: string
) {
  const overrides = await aiInfra.listProviderOverrides(db, userId)
  return Promise.all(
    PROVIDERS.map(async (provider) => {
      const models = await listModels(db, userId, provider.id)
      return {
        id: provider.id,
        name: provider.name,
        description: provider.description,
        enabled: overrides.get(provider.id) ?? true,
        configured: isProviderConfigured(env),
        modelCount: models.length,
        enabledModelCount: models.filter((model) => model.enabled).length,
      }
    })
  )
}

/** What the model switcher offers: enabled models of enabled providers. */
export async function runtimeState(db: D1Database, userId: string) {
  const overrides = await aiInfra.listProviderOverrides(db, userId)
  const offered = await Promise.all(
    PROVIDERS.filter((provider) => overrides.get(provider.id) ?? true).map(
      async (provider) => ({
        id: provider.id,
        name: provider.name,
        models: (await listModels(db, userId, provider.id)).filter(
          (model) => model.enabled
        ),
      })
    )
  )
  return { providers: offered.filter((provider) => provider.models.length > 0) }
}
