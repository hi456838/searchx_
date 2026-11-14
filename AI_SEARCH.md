# AI sky search

Add `OPENAI_API_KEY` as a server-only environment variable in Vercel, then redeploy. For local use, set the same variable in the server environment before running `npm start`. The optional `OPENAI_SEARCH_MODEL` defaults to `gpt-4.1-mini`.

Search checks CDS Sesame first. If that does not return a match, the submitted query goes to the OpenAI Responses API with response storage disabled. AI suggestions only move the map after CDS Sesame resolves their catalog names. General astronomy answers and clarification prompts appear as search status text.

The endpoint is public when configured. Apply deployment-level rate limits and use a dedicated OpenAI project key with usage controls before enabling it on a public deployment.
