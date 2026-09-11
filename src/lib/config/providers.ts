// Generic integration registry — spec: "create a generic integration/secret
// architecture rather than hardcoding every provider." Adding a provider
// means adding one entry here, not touching the orchestration/UI code.
//
// Detection is a plain keyword scan over the user's own prompt text. This is
// an app-level heuristic, not a v0-signaled event: v0's SDK exposes message
// `type` values like `added-environment-variables`/`added-integration` and a
// `resolveTask` flow that suggest a more precise mechanism might exist, but
// that hasn't been verified live, so this doesn't depend on it. A missed or
// over-eager keyword match only affects whether the Integrations panel shows
// up — it never blocks or changes what v0 actually builds.

export interface ProviderEnvVar {
  key: string;
  label: string;
  secret: boolean;
  placeholder?: string;
}

export interface ProviderDefinition {
  id: string;
  label: string;
  description: string;
  whereToGetUrl: string;
  keywords: string[];
  envVars: ProviderEnvVar[];
}

export const PROVIDERS: ProviderDefinition[] = [
  {
    id: "paystack",
    label: "Paystack",
    description: "Required to process real payments.",
    whereToGetUrl: "https://dashboard.paystack.com/#/settings/developer",
    keywords: ["paystack"],
    envVars: [
      { key: "PAYSTACK_SECRET_KEY", label: "Secret key", secret: true },
      {
        key: "NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY",
        label: "Public key",
        secret: false,
      },
    ],
  },
  {
    id: "stripe",
    label: "Stripe",
    description: "Required to process real payments.",
    whereToGetUrl: "https://dashboard.stripe.com/apikeys",
    keywords: ["stripe"],
    envVars: [
      { key: "STRIPE_SECRET_KEY", label: "Secret key", secret: true },
      {
        key: "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
        label: "Publishable key",
        secret: false,
      },
    ],
  },
  {
    id: "supabase",
    label: "Supabase",
    description: "Required for the app's own database and authentication.",
    whereToGetUrl: "https://supabase.com/dashboard/project/_/settings/api",
    keywords: ["supabase"],
    envVars: [
      { key: "NEXT_PUBLIC_SUPABASE_URL", label: "Project URL", secret: false },
      {
        key: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        label: "Anon key",
        secret: false,
      },
      {
        key: "SUPABASE_SERVICE_ROLE_KEY",
        label: "Service role key",
        secret: true,
      },
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    description: "Required for AI features to use a real model.",
    whereToGetUrl: "https://platform.openai.com/api-keys",
    keywords: ["openai", "gpt-4", "gpt-5", "chatgpt"],
    envVars: [{ key: "OPENAI_API_KEY", label: "API key", secret: true }],
  },
  {
    id: "twilio",
    label: "Twilio",
    description: "Required to send real SMS/calls.",
    whereToGetUrl: "https://console.twilio.com",
    keywords: ["twilio", "sms"],
    envVars: [
      { key: "TWILIO_ACCOUNT_SID", label: "Account SID", secret: false },
      { key: "TWILIO_AUTH_TOKEN", label: "Auth token", secret: true },
    ],
  },
  {
    id: "elevenlabs",
    label: "ElevenLabs",
    description: "Required for real text-to-speech generation.",
    whereToGetUrl: "https://elevenlabs.io/app/settings/api-keys",
    keywords: ["elevenlabs", "eleven labs", "text-to-speech", "text to speech"],
    envVars: [{ key: "ELEVENLABS_API_KEY", label: "API key", secret: true }],
  },
];

export function detectProviders(text: string): ProviderDefinition[] {
  const lower = text.toLowerCase();
  return PROVIDERS.filter((provider) =>
    provider.keywords.some((keyword) => lower.includes(keyword)),
  );
}

export function getProvider(id: string): ProviderDefinition | undefined {
  return PROVIDERS.find((provider) => provider.id === id);
}
