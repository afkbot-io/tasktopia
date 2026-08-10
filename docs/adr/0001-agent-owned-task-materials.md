# Task materials are agent-owned documents

Task implementation materials and checklist state are normalized task-owned records updated through MCP, while the web task card is a read-only projection. This keeps one automation write path with an audit trail, supports additional Markdown documents without schema changes, and prevents manual UI edits from drifting away from the AI agent's active plan; binary evidence and repository links remain separate artifacts.
