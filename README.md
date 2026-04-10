# LogScale MCP Server

A Model Context Protocol (MCP) server that enables AI assistants (Cursor, Codex, etc.) to interact with CrowdStrike LogScale for log searching, dashboard management, detection/alert management, and repository discovery.

## What This Does

This MCP server integrates LogScale directly into your IDE, providing **27 tools** across six categories:

- **Query** -- Search logs and run full CQL queries
- **Dashboard Management** -- Create, list, delete, export, and deploy dashboards
- **Detection/Alert Management** -- Full CRUD for filter alerts, aggregate alerts, and scheduled searches
- **Lookup Files** -- List and view lookup file contents
- **Discovery** -- List repositories, check server health
- **Documentation** -- Sync and read CQL/dashboard docs locally

## Quick Setup

### Prerequisites
- Node.js (v18 or later)
- LogScale API token (search) and User API token (GraphQL/management)
- Cursor IDE or any MCP-compatible client

### Installation

1. **Install dependencies**:
```bash
cd /path/to/logscale-mcp
npm install
```

2. **Configure credentials** -- Copy `.env.example` to `.env` and fill in your values:
```bash
LOGSCALE_BASE_URL=https://your-instance.logscale.com
LOGSCALE_API_TOKEN=your_search_api_token
LOGSCALE_USER_API_TOKEN=your_user_api_token
LOGSCALE_REPOSITORY=your_default_repo_or_view
LOG_LEVEL=info
```

- `LOGSCALE_API_TOKEN` -- Used for REST search queries
- `LOGSCALE_USER_API_TOKEN` -- Used for GraphQL operations (dashboards, alerts, repos). Falls back to `LOGSCALE_API_TOKEN` if not set.

3. **Add to Cursor MCP configuration** -- Edit `~/.cursor/mcp.json`.

   **stdio (default)** — Cursor spawns the server as a subprocess:
```json
{
  "mcpServers": {
    "logscale": {
      "command": "node",
      "args": ["/absolute/path/to/logscale-mcp/server.js"],
      "env": {}
    }
  }
}
```

   **Streamable HTTP** — Run the server with HTTP enabled, then point Cursor at the URL.

   Terminal (after configuring `.env`):
```bash
MCP_TRANSPORT=http npm start
```
   Or use `npm run start:http`. Defaults: `127.0.0.1:3333`, path `/mcp`. Override with `MCP_HTTP_HOST`, `MCP_HTTP_PORT`, `MCP_HTTP_PATH` in `.env` or the shell.

   Optional: set `MCP_HTTP_TOKEN` and send `Authorization: Bearer <token>` from clients that support custom headers (otherwise bind to `127.0.0.1` only for local use).

   Cursor `mcp.json`:
```json
{
  "mcpServers": {
    "logscale": {
      "url": "http://127.0.0.1:3333/mcp"
    }
  }
}
```

4. **Restart Cursor** -- The LogScale MCP should appear as connected with 27 tools.

## Available Tools (27)

### Query Tools

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `logscale_search` | Simple text search with head limit | `search_term`, `start_time`, `max_events` |
| `logscale_query` | Full CQL queries | `query`, `start_time`, `end_time` |
| `logscale_cancel_query` | Cancel a running query job | `job_id`, `repository` |

### Dashboard Management Tools

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `logscale_create_dashboard` | Create dashboard with widgets, parameters, and options | `name`, `widgets[]`, `parameters`, `time_settings` |
| `logscale_list_dashboards` | List all dashboards with IDs and URLs | `repository`, `filter` |
| `logscale_delete_dashboard` | Delete by ID or exact name | `dashboard_id` or `name` |
| `logscale_export_dashboard` | Export deployed dashboard as YAML | `dashboard_id` or `name`, `save_to_file` |
| `logscale_deploy_yaml` | Deploy from local YAML template file | `yaml_file`, `replace_existing` |
| `logscale_update_dashboard` | Rename, update description, or replace widgets | `dashboard_id` or `name`, `new_name`, `yaml_template` |

### Detection/Alert Management Tools

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `logscale_list_alerts` | List all detections (filter/aggregate/scheduled) | `type`, `enabled`, `label`, `name_filter` |
| `logscale_get_alert` | Get full details of a specific detection | `alert_id` or `name`, `type` hint |
| `logscale_create_alert` | Create a new detection | `type`, `name`, `query_string`, `actions` |
| `logscale_update_alert` | Update an existing detection | `alert_id` or `name`, fields to update |
| `logscale_delete_alert` | Delete a detection | `alert_id` or `name`, `confirm: true` |
| `logscale_toggle_alert` | Enable/disable a detection | `alert_id` or `name`, `enabled` |
| `logscale_list_actions` | List available notification actions | `repository` |
| `logscale_create_action` | Create a notification action (Slack, Email, Webhook, etc.) | `type`, `name`, action-specific fields |
| `logscale_delete_action` | Delete a notification action | `action_id` or `name`, `confirm: true` |
| `logscale_export_alert` | Export detection as YAML template | `alert_id` or `name`, `save_to_file` |

### Lookup File Tools

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `logscale_list_files` | List all lookup files (CSV/JSON) in a repository | `repository` |
| `logscale_get_file` | View headers and content of a lookup file | `filename`, `filter`, `max_rows` |
| `logscale_upload_file` | Upload or update a CSV lookup file | `filename`, `content` or `local_path` |

### Discovery Tools

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `logscale_list_repos` | List all repositories and views with sizes | (none) |
| `logscale_status` | Health check -- connectivity, config, tokens | (none) |

### Documentation Tools

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `logscale_docs_sync` | Download/refresh CQL and dashboard documentation | `category`, `format`, `refresh` |
| `logscale_docs` | List cached documentation | `category`, `include_content` |
| `logscale_docs_text` | Read documentation as plain text | `category`, `doc_name` |

## Alert Types

LogScale has three detection types:

| Type | Use Case | Key Constraint |
|------|----------|----------------|
| **Filter Alert** | Real-time, per-event detection | No aggregate functions (`count()`, `groupBy()`, etc.) |
| **Aggregate Alert** | Windowed threshold detection | Requires `search_interval_seconds` |
| **Scheduled Search** | Cron-based periodic search | Requires `schedule` (cron) and `search_interval_seconds` |

### Creating a Detection -- Quick Reference

**Filter alert** (fires on each matching event):
```
logscale_create_alert(
  type: "filter",
  name: "suspicious_login",
  query_string: "#type=okta_corp | client.geographicalContext.country!=\"United States\"",
  actions: ["Send to Tines"],
  throttle_seconds: 300
)
```

**Aggregate alert** (fires when threshold is met):
```
logscale_create_alert(
  type: "aggregate",
  name: "brute_force",
  query_string: "#type=okta_corp | outcome.result=\"FAILURE\" | groupBy(actor.alternateId, function=count()) | _count > 10",
  actions: ["Send to Tines"],
  search_interval_seconds: 300,
  throttle_seconds: 600
)
```

**Scheduled search** (runs on cron schedule):
```
logscale_create_alert(
  type: "scheduled",
  name: "daily_report",
  query_string: "#type=okta_corp | groupBy(eventType, function=count()) | sort(_count, order=desc)",
  actions: ["Tines Monitoring"],
  schedule: "0 8 * * *",
  time_zone: "UTC",
  search_interval_seconds: 86400,
  max_wait_seconds: 60
)
```

## Usage Examples

### Log Searching
- *"Search LogScale for failed login attempts in the last 4 hours"*
- *"Run this CQL query: `#repo=cloudtrail | eventName=ConsoleLogin | groupBy(userIdentity.arn)`"*

### Dashboard Management
- *"List all dashboards"*
- *"Create a dashboard for Okta authentication events"*
- *"Deploy the updated Palo Alto dashboard from YAML"*
- *"Export the SOC2 audit evidence dashboard to a file"*

### Detection Management
- *"List all enabled filter alerts"*
- *"Create a filter alert for CrowdStrike malware detections"*
- *"Disable the test_aws_secrets_access alert"*
- *"Show me the details of prod_okta_mfa_push_spamming"*
- *"Export all our Okta detections as YAML for version control"*

### Discovery
- *"What repositories do we have in LogScale?"*
- *"Check the MCP server status"*

## Architecture

- **Node.js MCP Server** (`server.js`) -- MCP over **stdio** (default) or **Streamable HTTP** (`MCP_TRANSPORT=http`), using `@modelcontextprotocol/sdk`
- **REST API** -- Used for log search queries (`LOGSCALE_API_TOKEN`)
- **GraphQL API** -- Used for dashboard/alert management (`LOGSCALE_USER_API_TOKEN`)
- **CQL Docs Cache** (`docs/`) -- Cached CQL and dashboard documentation for AI reference

## Security

- Credentials stored in `.env` file (git-ignored), never logged or exposed in error messages
- Two separate API tokens for least-privilege access (search vs. management)
- Default stdio transport does not open an inbound port; optional Streamable HTTP binds to a configurable host/port (use `127.0.0.1` and `MCP_HTTP_TOKEN` for local hardening)
- Input validation on all user-supplied parameters:
  - Repository names restricted to `[a-zA-Z0-9_.\-]`
  - Job IDs restricted to `[a-zA-Z0-9_\-]`
  - File paths validated against directory traversal (`safePath()`)
  - Numeric parameters bounded (max_events, max_chars)
- API error responses sanitized and truncated before returning to clients
- See [SECURITY.md](SECURITY.md) for full details

## Troubleshooting

**Server not connecting?**
1. Check Node.js is installed: `node --version` (need v18+)
2. Verify `.env` file has correct credentials
3. Check the path in `mcp.json` is absolute
4. Restart your IDE

**Dashboard/alert operations failing?**
1. Ensure `LOGSCALE_USER_API_TOKEN` is set (not just `LOGSCALE_API_TOKEN`)
2. The user token must have dashboard/alert management permissions
3. Check `logscale_status` for connectivity diagnostics

**Alert creation errors?**
- Filter alerts: cannot use aggregate functions (`count()`, `groupBy()`)
- Scheduled searches with `IngestTimestamp`: must set `max_wait_seconds`
- Action names must match exactly (use `logscale_list_actions` to verify)
