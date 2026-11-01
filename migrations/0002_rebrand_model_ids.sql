-- Maps the raw Workers AI model ids stored before the catalog was rebranded
-- onto the face that now runs on the same (or nearest) backend. Without this,
-- every existing chat falls back to MODEL_DEFAULT in app/api/chat/route.ts.
--
-- Retired backends map to the face whose backend is closest in capability:
--   llama-4-scout / mistral-small-3.1  → claude-sonnet-5  (fast + vision + tools)
--   llama-3.3-70b / llama-3.1-8b       → claude-haiku-4-5 (fast, small)
--   qwen2.5-coder / glm-5.2            → claude-opus-5    (coding + agentic)
--   qwen3-30b / r1-distill             → gpt-5-6-terra    (mid reasoning)
--   nemotron-3 (now 429-only)          → gpt-5-6-sol      (agentic)

UPDATE chats SET model = CASE model
  WHEN '@cf/zai-org/glm-5.3'                        THEN 'claude-opus-5'
  WHEN '@cf/zai-org/glm-5.3-flash'                  THEN 'claude-sonnet-5'
  WHEN '@cf/deepseek-ai/deepseek-v4-pro-0813'       THEN 'deepseek-v4-pro'
  WHEN '@cf/deepseek-ai/deepseek-v4-flash-0731'     THEN 'deepseek-v4-flash'
  WHEN '@cf/moonshotai/kimi-k2.7-code'              THEN 'gemini-3-1-pro'
  WHEN '@cf/moonshotai/kimi-k2.6'                   THEN 'gemini-3-1-pro'
  WHEN '@cf/google/gemma-4-26b-a4b-it'              THEN 'gemini-3-8-flash'
  WHEN '@cf/qwen/qwen3.8-27b'                       THEN 'gemini-3-7-flash'
  WHEN '@cf/openai/gpt-oss-120b'                    THEN 'gpt-5-6-terra'
  WHEN '@cf/openai/gpt-oss-20b'                     THEN 'gpt-5-6-luna'
  WHEN '@cf/nvidia/nemotron-3-120b-a12b'            THEN 'gpt-5-6-sol'
  WHEN '@cf/meta/llama-4-scout-17b-16e-instruct'    THEN 'claude-sonnet-5'
  WHEN '@cf/mistralai/mistral-small-3.1-24b-instruct' THEN 'claude-sonnet-5'
  WHEN '@cf/meta/llama-3.3-70b-instruct-fp8-fast'   THEN 'claude-haiku-4-5'
  WHEN '@cf/meta/llama-3.1-8b-instruct-fp8'         THEN 'claude-haiku-4-5'
  WHEN '@cf/qwen/qwen2.5-coder-32b-instruct'        THEN 'claude-opus-5'
  WHEN '@cf/zai-org/glm-5.2'                        THEN 'claude-opus-5'
  WHEN '@cf/qwen/qwen3-30b-a3b-fp8'                 THEN 'gpt-5-6-terra'
  WHEN '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b' THEN 'gpt-5-6-terra'
  ELSE model
END
WHERE model LIKE '@cf/%';

-- Favourite and hidden lists are JSON arrays of the same ids. Rewriting JSON in
-- SQLite is not worth it for a handful of dev rows, and both degrade cleanly:
-- favourites fall back to MODEL_DEFAULT, hidden falls back to showing everything.
UPDATE users
SET favorite_models = NULL
WHERE favorite_models LIKE '%@cf/%';

UPDATE user_preferences
SET hidden_models = '[]'
WHERE hidden_models LIKE '%@cf/%';
