export const PACKAGE_TIERS = Object.freeze({
  free_explorer: {
    name: 'Free Explorer',
    price: null,
    limits: {
      research_runs_monthly: 5,
      ai_generations_monthly: 10,
      grant_searches_monthly: 10,
      saved_reports: 5,
    },
    features: {
      basic_research: true,
      basic_grant_finder: true,
      competitor_profiles: true,
      offer_management: true,
      acquisition_planning: true,
      retention_planning: true,
      performance_scorecard: true,
      deep_research: false,
      grant_eligibility_analysis: false,
      advanced_matching: false,
      application_support: false,
    },
  },
  starter: {
    name: 'Starter',
    price: null,
    limits: {
      research_runs_monthly: 30,
      ai_generations_monthly: 100,
      grant_searches_monthly: 50,
      saved_reports: 25,
    },
    features: {
      basic_research: true,
      basic_grant_finder: true,
      competitor_profiles: true,
      offer_management: true,
      acquisition_planning: true,
      retention_planning: true,
      performance_scorecard: true,
      deep_research: false,
      grant_eligibility_analysis: true,
      advanced_matching: false,
      application_support: false,
    },
  },
  professional: {
    name: 'Professional',
    price: null,
    limits: {
      research_runs_monthly: 150,
      ai_generations_monthly: 500,
      grant_searches_monthly: 250,
      saved_reports: 150,
    },
    features: {
      basic_research: true,
      basic_grant_finder: true,
      competitor_profiles: true,
      offer_management: true,
      acquisition_planning: true,
      retention_planning: true,
      performance_scorecard: true,
      deep_research: true,
      grant_eligibility_analysis: true,
      advanced_matching: true,
      application_support: true,
    },
  },
  agency_enterprise: {
    name: 'Agency / Enterprise',
    price: null,
    limits: {
      research_runs_monthly: 1000,
      ai_generations_monthly: 3000,
      grant_searches_monthly: 1500,
      saved_reports: 1000,
    },
    features: {
      basic_research: true,
      basic_grant_finder: true,
      competitor_profiles: true,
      offer_management: true,
      acquisition_planning: true,
      retention_planning: true,
      performance_scorecard: true,
      deep_research: true,
      grant_eligibility_analysis: true,
      advanced_matching: true,
      application_support: true,
    },
  },
});

export const DEFAULT_TRIAL_POLICY = Object.freeze({
  enabled: true,
  duration_days: 7,
  tier_key: 'professional',
  preserve_user_data_on_expiry: true,
});

export const FEATURE_CATALOG = Object.freeze({
  basic_research: 'Basic research',
  basic_grant_finder: 'Basic grant finder',
  competitor_profiles: 'Competitor profiles',
  offer_management: 'Offer management',
  acquisition_planning: 'Acquisition planning',
  retention_planning: 'Retention planning',
  performance_scorecard: 'Performance scorecard',
  deep_research: 'Advanced research',
  grant_eligibility_analysis: 'Grant eligibility analysis',
  advanced_matching: 'Advanced opportunity matching',
  application_support: 'Application support',
});

export function getPackagePolicy(tierKey) {
  return PACKAGE_TIERS[tierKey] ?? PACKAGE_TIERS.free_explorer;
}

export function isTrialActive(trial, now = new Date()) {
  if (!trial?.started_at || !trial?.expires_at) return false;
  if (trial.status && trial.status !== 'active') return false;

  const start = Date.parse(trial.started_at);
  const expiry = Date.parse(trial.expires_at);
  const current = now.getTime();

  return Number.isFinite(start) &&
    Number.isFinite(expiry) &&
    expiry > start &&
    current >= start &&
    current < expiry;
}

export function getEffectivePolicy({
  tierKey = 'free_explorer',
  trial = null,
  overrides = {},
  now = new Date(),
} = {}) {
  const base = getPackagePolicy(tierKey);
  const activeTrial = isTrialActive(trial, now);
  const trialTier = activeTrial
    ? getPackagePolicy(trial.tier_key ?? DEFAULT_TRIAL_POLICY.tier_key)
    : null;

  const features = { ...base.features };
  const limits = { ...base.limits };

  if (activeTrial) {
    Object.assign(features, trialTier.features);
    for (const key of Object.keys(limits)) {
      limits[key] = Math.max(limits[key] ?? 0, trialTier.limits[key] ?? 0);
    }
  }

  Object.assign(features, overrides.features ?? {});
  Object.assign(limits, overrides.limits ?? {});

  return {
    tierKey,
    tierName: base.name,
    trialActive: activeTrial,
    features,
    limits,
  };
}

export function canUseFeature(policy, featureKey) {
  return policy?.features?.[featureKey] === true;
}

export function isWithinUsageLimit(policy, usageKey, used = 0) {
  const limit = policy?.limits?.[usageKey];
  if (!Number.isFinite(limit) || limit < 0) return false;
  return Number.isFinite(used) && used >= 0 && used < limit;
}
