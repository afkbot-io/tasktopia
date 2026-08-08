# Open-source AI knowledge bases for Tasktopia

Date: 2026-08-06

## Conclusion

There are mature open-source repositories that can provide document ingestion, hybrid retrieval, citations, agents, and MCP/API integration. None of them should become the source of truth for Tasktopia tasks, permissions, or project relationships. Tasktopia/PostgreSQL should own canonical entities; an AI knowledge engine should maintain a derived, replaceable search index with source IDs and revisions.

## Shortlist

| Project | Best fit | Strengths | Main trade-off |
| --- | --- | --- | --- |
| [Onyx](https://github.com/onyx-dot-app/onyx) | Turnkey team search and AI assistant | 50+ connectors, hybrid retrieval, citations, agents, MCP/actions, self-hosting | Standard deployment is a multi-service stack; some enterprise governance is outside CE |
| [RAGFlow](https://github.com/infiniflow/ragflow) | Complex documents and controlled RAG pipelines | Strong parsing, chunking, retrieval, citations, agents, API and MCP code | Heavier operational footprint than Tasktopia currently needs |
| [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm) | Fast self-hosted prototype | Simple setup, workspaces, document ingestion, citations, developer API, MCP, pgvector support | Less suitable as a deeply permission-aware project context graph |
| [Dify](https://github.com/langgenius/dify) | Building many AI applications and workflows | Visual workflows, RAG pipelines, agents, observability, APIs | Broader than a knowledge subsystem; duplicates product/application concerns |
| [Graphiti](https://github.com/getzep/graphiti) | Temporal memory and relationship graph for agents | Tracks changing facts, provenance and history; hybrid graph/semantic/keyword retrieval; MCP server | Framework, not a turnkey knowledge UI; requires a graph database and custom integration |
| [pgvector](https://github.com/pgvector/pgvector) | Native Tasktopia search layer | Runs inside PostgreSQL, transactional source links, straightforward country-level ACL filtering | Ingestion, chunking, reranking and evaluation must be built |

Haystack and LlamaIndex are useful construction frameworks, but they are libraries rather than ready knowledge products.

## Recommendation for Tasktopia

1. Keep tasks, countries, cities, districts, use cases, decisions, repository links, ACLs and revisions in Tasktopia/PostgreSQL.
2. Implement PostgreSQL full-text search first, then add pgvector and reciprocal-rank fusion for hybrid search. This gives the lowest operational cost and makes permission filtering explicit before retrieval.
3. Evaluate Onyx as an optional external connector/search service when many third-party sources are needed. Evaluate RAGFlow instead when PDF/specification parsing quality is the primary requirement.
4. Prototype Graphiti only for temporal questions such as “what changed, why, and which decision/task superseded it”; do not put canonical task state in the graph.
5. Every returned AI fragment must carry `sourceType`, `sourceId`, `countryId`, `revision`, `updatedAt`, and a clickable citation. Derived indexes must be rebuildable.

## Decision rule

- Need a working demo quickly: AnythingLLM.
- Need enterprise-style multi-source search: Onyx.
- Need document-heavy RAG: RAGFlow.
- Need agent workflows as a product surface: Dify.
- Need evolving relationship memory: Graphiti.
- Need the safest long-term Tasktopia core: PostgreSQL FTS + pgvector, with external engines optional.

## Primary sources

- https://github.com/onyx-dot-app/onyx
- https://github.com/infiniflow/ragflow
- https://github.com/Mintplex-Labs/anything-llm
- https://github.com/langgenius/dify
- https://github.com/getzep/graphiti
- https://github.com/pgvector/pgvector
- https://github.com/deepset-ai/haystack
- https://github.com/run-llama/llama_index
