const TIER_ORDER = ['flagship', 'performant', 'efficient'];

function formatAvailable(values) {
  return values.length > 0 ? values.join(', ') : 'none';
}

function availableTiers(providerEntry) {
  return TIER_ORDER.filter((tier) => typeof providerEntry?.tiers?.[tier] === 'string');
}

export function resolveModel(registry, providerId, tier) {
  const provider = registry.providers?.[providerId];
  if (!provider) {
    throw new Error(
      `registry: unknown provider "${providerId}" (available: ${formatAvailable(Object.keys(registry.providers ?? {}).sort())})`,
    );
  }

  const familyAlias = provider.tiers?.[tier];
  if (!familyAlias) {
    throw new Error(
      `registry: provider "${providerId}" has no tier "${tier}" (available: ${formatAvailable(availableTiers(provider))})`,
    );
  }

  const model = provider.knownModels?.[familyAlias];
  if (!model) {
    throw new Error(
      `registry: provider "${providerId}" tier "${tier}" points to unknown family alias "${familyAlias}"`,
    );
  }

  return {
    provider: providerId,
    tier,
    familyAlias,
    apiId: model.apiId,
    legacy: false,
  };
}

export function resolveRoleRef(registry, ref) {
  if (typeof ref === 'string') {
    return {
      provider: ref,
      familyAlias: ref,
      apiId: ref,
      legacy: true,
    };
  }

  if (!registry) {
    throw new Error(
      `registry: provider "${ref.provider}" tier "${ref.tier}" requires .vibe/model-registry.json`,
    );
  }

  return resolveModel(registry, ref.provider, ref.tier);
}
