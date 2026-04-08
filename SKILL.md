---
name: logscale-mcp
description: Use the LogScale MCP to query SIEM logs with CQL, manage dashboards and detections, upload lookup files, and browse CQL documentation. Trigger this skill when the user asks about logs, events, alerts, detections, dashboards, SIEM data, or anything related to CrowdStrike LogScale. Also trigger when the user mentions LogScale, Humio, CQL, log search, detections, or security event queries.
---

# LogScale MCP

Use this skill when querying SIEM logs, managing dashboards, creating or managing detections/alerts, working with lookup files, or browsing CQL documentation in CrowdStrike LogScale.

## MCP Tools Available

### Query Tools

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `logscale_search` | Simple text/keyword search | `search_term`, `start_time`, `max_events` (1-1000) |
| `logscale_query` | Full CQL queries with pipes and aggregations | `query`, `start_time`, `end_time`, `max_events` (1-10000) |
| `logscale_cancel_query` | Cancel a running query job | `job_id`, `repository` |

### Dashboard Management

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `logscale_create_dashboard` | Create dashboard with widgets, parameters, time settings | `name`, `widgets[]`, `parameters`, `time_settings` |
| `logscale_list_dashboards` | List all dashboards with IDs and URLs | `repository`, `filter` |
| `logscale_delete_dashboard` | Delete by ID or exact name match | `dashboard_id` or `name` |
| `logscale_export_dashboard` | Export deployed dashboard as YAML | `dashboard_id` or `name`, `save_to_file` |
| `logscale_deploy_yaml` | Deploy from local YAML template file | `yaml_file`, `replace_existing` |
| `logscale_update_dashboard` | Rename, update description, or replace widgets | `dashboard_id` or `name`, `new_name`, `yaml_template` |

### Detection/Alert Management

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `logscale_list_alerts` | List detections (filter/aggregate/scheduled) | `type`, `enabled`, `label`, `name_filter` |
| `logscale_get_alert` | Full detection details | `alert_id` or `name`, `type` hint |
| `logscale_create_alert` | Create a new detection | `type`, `name`, `query_string`, `actions` |
| `logscale_update_alert` | Update an existing detection | `alert_id` or `name`, fields to change |
| `logscale_delete_alert` | Delete a detection | `alert_id` or `name`, `confirm: true` |
| `logscale_toggle_alert` | Enable/disable without full update | `alert_id` or `name`, `enabled` |
| `logscale_list_actions` | List notification actions | `repository` |
| `logscale_create_action` | Create notification action (Slack, Email, Webhook, PagerDuty) | `type`, `name`, action-specific fields |
| `logscale_delete_action` | Delete notification action | `action_id` or `name`, `confirm: true` |
| `logscale_export_alert` | Export detection as YAML | `alert_id` or `name`, `save_to_file` |

### Lookup Files

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `logscale_list_files` | List all lookup files (CSV/JSON) | `repository` |
| `logscale_get_file` | View headers and content | `filename`, `filter`, `max_rows` |
| `logscale_upload_file` | Upload or update a CSV lookup file | `filename`, `content` |

### Discovery and Documentation

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `logscale_list_repos` | List all repositories and views with sizes | (none) |
| `logscale_status` | Health check: connectivity, tokens, config | (none) |
| `logscale_docs_sync` | Download/refresh CQL docs from LogScale | `category`, `format`, `refresh` |
| `logscale_docs` | List cached documentation | `category`, `include_content` |
| `logscale_docs_text` | Read documentation as plain text | `category`, `doc_name` |

## Tool Selection Decision Tree

```
Need to search logs?
├─ Simple text/keyword lookup → logscale_search
│   (e.g., "search for error", "find events with chrome")
└─ Query with pipes, aggregations, regex, or field selection → logscale_query
    (e.g., groupBy, count, top, timeChart, select, table, case, regex)

Need dashboard work?
├─ Simple dashboard (2-4 widgets) → logscale_create_dashboard
├─ Complex/version-controlled dashboard → logscale_deploy_yaml (from YAML template)
└─ Export for backup/review → logscale_export_dashboard

Need to create a detection?
├─ Real-time per-event → type: "filter" (NO aggregate functions allowed)
├─ Threshold-based → type: "aggregate" (REQUIRES search_interval_seconds)
└─ Cron-based periodic → type: "scheduled" (REQUIRES schedule + search_interval_seconds)

Before creating ANY alert:
1. logscale_list_actions → get exact action names (they must match exactly)
2. logscale_query → test the query first to verify results
3. Choose the correct type (see Detection Types below)
```

## CQL (CrowdStrike Query Language) Reference

CQL is pipe-based: `filter | transform | aggregate`

### Critical Rules

1. **Always set the repository**: `#repo=okta_corp` — never omit it
2. **Always set `start_time`**: default is only `1h` — use `24h`, `7d`, `30d` for investigations
3. **Filter early, aggregate late**: put filters before `groupBy`/`count` to reduce data scanned
4. **Sample first**: use `head(5)` before expensive queries across large time ranges
5. **Field values are case-sensitive**: use regex with `/i` flag for case-insensitive matching

### Query Patterns

**Filtering:**
```cql
#repo=okta_corp eventType="user.session.start"
#repo=okta_corp eventType="user.session.start" outcome.result="FAILURE"
#repo=fltr-crowdstrike_data event_simpleName=ProcessRollup2 ComputerName=LAPTOP01
```

**Regex and wildcards:**
```cql
#repo=okta_corp actor.alternateId = /.*@liveramp\.com/
#repo=fltr-crowdstrike_data ImageFileName = /.*chrome.*/i
```

**Negation:**
```cql
#repo=okta_corp eventType != "user.session.heartbeat"
```

**Aggregation:**
```cql
#repo=okta_corp | groupBy(eventType, function=count()) | sort(_count, order=desc, limit=20)
#repo=netskope_api | top(app, limit=25)
#repo=fltr-crowdstrike_data | timeChart(span=1h, function=count())
```

**Field selection:**
```cql
#repo=okta_corp | select([actor.alternateId, eventType, outcome.result, client.ipAddress])
#repo=fltr-crowdstrike_data | table([ComputerName, ImageFileName, CommandLine, timestamp])
```

**Conditional logic:**
```cql
#repo=okta_corp | case {
  outcome.result="FAILURE" | severity := "high";
  outcome.result="SUCCESS" | severity := "low";
  * | severity := "unknown";
}
```

**Lookups:**
```cql
#repo=okta_corp | readFile("okta_groups.csv", field=[actor.alternateId], include=[group_name])
```

## Available Repositories

| Repo | Data Source | Key Fields |
|------|-------------|------------|
| `fltr-crowdstrike_data` | CrowdStrike EDR | `event_simpleName`, `ComputerName`, `UserName`, `ImageFileName`, `CommandLine`, `SHA256HashData`, `aid` |
| `netskope_api` | Netskope cloud security | `user`, `app`, `hostname`, `domain`, `category`, `action`, `srcip`, `dstip` |
| `okta_corp` | Okta corporate IdP | `eventType`, `actor.alternateId`, `outcome.result`, `client.ipAddress`, `client.geographicalContext.*` |
| `okta_customer` | Okta customer IdP | Same schema as `okta_corp` |
| `cloudtrail` | AWS CloudTrail | `eventName`, `eventSource`, `sourceIPAddress`, `userIdentity.arn`, `awsRegion` |
| `gcp_cloudaudit` | GCP Cloud Audit | `protoPayload.methodName`, `protoPayload.authenticationInfo.principalEmail`, `resource.type` |
| `gcp_scc` | GCP Security Command Center | `finding.*`, `resource.*` |
| `github_audit` | GitHub Enterprise audit | `action`, `actor`, `org`, `repo`, `transport_protocol_name` |
| `google_workspace` | Google Workspace | `login.is_suspicious`, `login.login_type` |
| `gmail` | Gmail logs | `gmail.message_info.subject`, `gmail.message_info.source.address`, `gmail.message_info.destination[].address` |
| `proofpoint_ondemand` | Proofpoint email | `sm.to[]`, `sm.stat`, `sm.relay`, `sm.qid` |
| `proofpoint_tap` | Proofpoint TAP threats | `spamScore`, `phishScore`, `subject`, `sender`, `recipient[]`, `senderIP` |
| `paloalto_firewall` | Palo Alto NGFW | Raw syslog in `message` — parse inline |
| `securityhub` | AWS Security Hub | `detail.findings[]`, `source`, `account`, `region` |
| `macie` | AWS Macie | `severity`, `resourcesAffected`, `category` |
| `one_password` | 1Password audit | `action`, `actor_details.email`, `object_type`, `session.ip` |
| `singlestore` | SingleStore DB audit | `username`, `event_type`, `success_or_failure`, `remote_host` |
| `snowflake` | Snowflake audit | `message`, `message_type`, `task` |
| `windows_events` | Windows Security logs | Raw in `message` — parse inline |
| `switches` | Network switches | Raw syslog in `message` |

## CrowdStrike Event Names (`event_simpleName`)

| Event | Meaning |
|-------|---------|
| `ProcessRollup2` | Process creation (primary telemetry) |
| `SyntheticProcessRollup2` | Synthetic process events |
| `DnsRequest` | DNS queries from endpoints |
| `NetworkConnectIP4` / `NetworkConnectIP6` | Network connections |
| `UserLogon` / `UserLogoff` | Session activity |
| `FileWritten` | File writes |
| `AsepValueUpdate` | Persistence mechanisms |
| `EndOfProcess` | Process termination |
| `Event_ExternalApiEvent` | Console audit events (IOA changes, policy updates, user management) |

### CrowdStrike Audit Events (`OperationName` for `Event_ExternalApiEvent`)

| OperationName | Meaning |
|---------------|---------|
| `update_rule`, `create_rule`, `delete_rule` | Custom IOA rules |
| `update_policy` | Prevention/sensor policy changes |
| `update_group` | Host group membership changes |
| `grantUserRoles` | Role assignments |
| `CreateAPIClient`, `UpdateAPIClient`, `DeleteAPIClients` | API client management |
| `containment_requested`, `lift_containment_requested` | Host containment |
| `saml2Assert`, `userAuthenticate` | Admin authentication |

## Detection Types (Critical — Choose Correctly)

### Filter Alert — Real-time, per-event

Fires on **every** matching event. **CANNOT** use aggregate functions (`count()`, `groupBy()`, `top()`).

```
logscale_create_alert(
  type: "filter",
  name: "suspicious_geo_login",
  query_string: "#repo=okta_corp eventType=user.session.start | client.geographicalContext.country != \"United States\"",
  actions: ["Send to Tines"],
  throttle_seconds: 300
)
```

### Aggregate Alert — Windowed threshold

Fires when aggregation returns results within a window. **REQUIRES** `search_interval_seconds`.

```
logscale_create_alert(
  type: "aggregate",
  name: "brute_force_detection",
  query_string: "#repo=okta_corp outcome.result=FAILURE | groupBy(actor.alternateId, function=count()) | _count > 10",
  actions: ["Send to Tines"],
  search_interval_seconds: 300,
  throttle_seconds: 600
)
```

### Scheduled Search — Cron-based

Runs on cron schedule. **REQUIRES** `schedule` + `search_interval_seconds`. With `IngestTimestamp`, also set `max_wait_seconds`.

```
logscale_create_alert(
  type: "scheduled",
  name: "daily_auth_summary",
  query_string: "#repo=okta_corp | groupBy(eventType, function=count()) | sort(_count, order=desc)",
  actions: ["Email SOC"],
  schedule: "0 8 * * *",
  search_interval_seconds: 86400,
  max_wait_seconds: 60
)
```

## Common Investigation Workflows

### Investigate a User

```
# 1. Okta auth events
logscale_query(query: "#repo=okta_corp actor.alternateId=\"user@liveramp.com\" | select([eventType, outcome.result, client.ipAddress, client.geographicalContext.city]) | sort(@timestamp)", start_time: "7d")

# 2. Endpoint activity
logscale_query(query: "#repo=fltr-crowdstrike_data UserName=\"user\" event_simpleName=ProcessRollup2 | table([ComputerName, ImageFileName, CommandLine, timestamp])", start_time: "7d")

# 3. Cloud app usage
logscale_query(query: "#repo=netskope_api user=\"user@liveramp.com\" | top(app, limit=20)", start_time: "7d")

# 4. 1Password vault activity
logscale_query(query: "#repo=one_password actor_details.email=\"user@liveramp.com\" | select([action, object_type, session.ip, @timestamp])", start_time: "7d")
```

### Investigate an Endpoint

```
# 1. Process activity
logscale_query(query: "#repo=fltr-crowdstrike_data ComputerName=\"HOSTNAME\" event_simpleName=ProcessRollup2 | table([ImageFileName, CommandLine, UserName, timestamp])", start_time: "24h")

# 2. Network connections
logscale_query(query: "#repo=fltr-crowdstrike_data ComputerName=\"HOSTNAME\" event_simpleName=NetworkConnectIP4 | table([RemoteAddressIP4, RemotePort, ImageFileName, timestamp])", start_time: "24h")

# 3. DNS requests
logscale_query(query: "#repo=fltr-crowdstrike_data ComputerName=\"HOSTNAME\" event_simpleName=DnsRequest | top(DomainName, limit=30)", start_time: "24h")
```

### Find Anomalous Activity

```
# Failed logins by geo
logscale_query(query: "#repo=okta_corp outcome.result=FAILURE | groupBy(client.geographicalContext.country, function=count()) | sort(_count, order=desc)", start_time: "24h")

# Unusual/rare processes (low count = potentially suspicious)
logscale_query(query: "#repo=fltr-crowdstrike_data event_simpleName=ProcessRollup2 | groupBy(ImageFileName, function=count()) | sort(_count, order=asc, limit=20)", start_time: "24h")

# Shadow IT — top cloud apps by user count
logscale_query(query: "#repo=netskope_api | groupBy([app, user], function=count()) | groupBy(app, function=count()) | sort(_count, order=desc, limit=30)", start_time: "7d")
```

### Export Detections for Version Control

```
# List all enabled filter alerts
logscale_list_alerts(type: "filter", enabled: true)

# Export specific detection
logscale_export_alert(name: "suspicious_geo_login", type: "filter", save_to_file: "alerts/suspicious_geo_login.yaml")
```

### Lookup File Enrichment

```
# List available lookup files
logscale_list_files()

# Inspect a lookup file
logscale_get_file(filename: "known_bad_ips.csv", max_rows: 20)

# Upload/update a lookup file
logscale_upload_file(filename: "vip_users.csv", content: "email,department,vip_level\nceo@company.com,Executive,critical\ncfo@company.com,Finance,high")

# Use in a query
logscale_query(query: "#repo=okta_corp | readFile(\"vip_users.csv\", field=[actor.alternateId], include=[vip_level]) | vip_level=*", start_time: "24h")
```

## Dashboard Creation

### From Code (simple dashboards, 2-4 widgets)

```
logscale_create_dashboard(
  name: "Okta Auth Overview",
  widgets: [
    {
      title: "Failed Logins Over Time",
      query: "#repo=okta_corp outcome.result=FAILURE | timeChart(span=1h, function=count())",
      visualization: "time-chart",
      width: 12, height: 5, x: 0, y: 0,
      time_range: "24h"
    },
    {
      title: "Top Failed Users",
      query: "#repo=okta_corp outcome.result=FAILURE | top(actor.alternateId, limit=10)",
      visualization: "bar-chart",
      width: 6, height: 4, x: 0, y: 5,
      time_range: "24h"
    },
    {
      title: "Login by Country",
      query: "#repo=okta_corp eventType=user.session.start | top(client.geographicalContext.country, limit=10)",
      visualization: "pie-chart",
      width: 6, height: 4, x: 6, y: 5,
      time_range: "24h"
    }
  ]
)
```

### From YAML (complex dashboards with parameters)

```
logscale_deploy_yaml(yaml_file: "dashboards/okta-auth.yaml", replace_existing: true)
```

### Dashboard Grid System

- **Width**: 1-12 columns (12 = full width)
- **Position**: `x` (0-11 column), `y` (row offset)
- Two `width: 6` widgets side by side = full row
- Three `width: 4` widgets = full row

### Visualization Types

`table-view` (default), `bar-chart`, `pie-chart`, `time-chart`, `xy-chart`, `single-value`, `simple-gauge`, `world-map`, `sankey`, `scatter-chart`, `raw`

## Integration with Tines

The LogScale MCP works alongside the Tines MCP. Common pattern:

1. `logscale_query` — investigate a detection
2. `tines_run_story` — trigger the response playbook
3. `tines_create_case` — track the incident
4. `tines_update_case` — update status as investigation progresses

The central alert router is **Logscale Alerting** (Tines story ID: 126815), which dispatches LogScale alerts to playbooks via SendToStory.

## Instance Context

- **Instance:** `liveramp.logscale.us-1.crowdstrike.com`
- **Default Repository:** configured in `.env` (`LOGSCALE_REPOSITORY`)
- **Two API tokens:** `LOGSCALE_API_TOKEN` (search) and `LOGSCALE_USER_API_TOKEN` (dashboard/alert management)
- **Key credential in Tines:** `humio` / `logscale` for LogScale API access

## API Gotchas

- **Alert action names must match exactly** — always verify with `logscale_list_actions` first
- **Filter alerts reject aggregate functions** — `count()`, `groupBy()`, `top()` cause creation to fail
- **Scheduled searches with `IngestTimestamp`** — must set `max_wait_seconds` or creation fails
- **Default time range is only 1 hour** — always set `start_time` explicitly
- **`logscale_search` max is 1000 events** — use `logscale_query` (up to 10000) for larger result sets
- **Aggregate queries in `logscale_query`** — omit `max_events` to return all aggregation results
- **Repository parameter is optional** — omit it to use the default from `.env`
- **CQL docs may not be cached locally** — run `logscale_docs_sync` first if `logscale_docs_text` returns empty
