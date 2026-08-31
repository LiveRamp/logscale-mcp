#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  isInitializeRequest,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import cors from 'cors';
import express from 'express';
import dotenv from 'dotenv';
import yaml from 'js-yaml';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdir, readdir, readFile, stat, writeFile } from 'fs/promises';
import { randomUUID } from 'node:crypto';
import {
  setLogLevel,
  log,
  parseTimeInput,
  normalizeMaxEvents,
  normalizeMaxChars,
  normalizeDocFormat,
  formatBytes,
  formatTimestamp as formatTimestampUtil,
  validateRepoName,
  validateJobId,
  assertNoViewTag,
  sanitizeErrorText,
  safePath,
  htmlToText,
  htmlToMarkdown,
  parseCSVLine,
  fileExists,
  safeReadDir,
} from './lib/utils.js';

// Load environment variables from .env file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '.env') });

// Read version from package.json
const require = createRequire(import.meta.url);
const pkg = require('./package.json');
const VERSION = pkg.version;

const API_TOKEN = process.env.LOGSCALE_API_TOKEN;
const USER_API_TOKEN = process.env.LOGSCALE_USER_API_TOKEN || API_TOKEN;
const BASE_URL = process.env.LOGSCALE_BASE_URL;
const REPOSITORY = process.env.LOGSCALE_REPOSITORY;
const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();
const DOCS_DIR = join(__dirname, 'docs');
const CQL_DOCS_DIR = join(DOCS_DIR, 'cql');
const DASHBOARD_DOCS_DIR = join(DOCS_DIR, 'dashboards');
const DASHBOARD_YAML_DIR = __dirname;

// Parse a positive-integer env var, falling back to the default on missing/garbage values
const intEnv = (name, fallback) => {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const FETCH_TIMEOUT_MS = intEnv('LOGSCALE_REQUEST_TIMEOUT_MS', 30000);
// Wall-clock budget for a query job (the Query Jobs API supports long-running jobs;
// jobs only self-delete server-side after 90s without polls)
const QUERY_TIMEOUT_MS = intEnv('LOGSCALE_QUERY_TIMEOUT_MS', 120000);
// Fallback poll interval when the poll response doesn't supply pollAfter
const QUERY_POLL_INTERVAL_MS = intEnv('LOGSCALE_QUERY_POLL_INTERVAL_MS', 500);
// Cap on rendered query-result text (events beyond this are elided, not lost server-side)
const MAX_RESULT_CHARS = intEnv('LOGSCALE_MAX_RESULT_CHARS', 100000);
const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1000;
const DASHBOARD_SCHEMA_VERSION = process.env.LOGSCALE_DASHBOARD_SCHEMA_VERSION || 'v0.23.0';

const ALERT_TYPE_LABELS = {
  filter: 'Filter Alert',
  aggregate: 'Aggregate Alert',
  scheduled: 'Scheduled Search',
};

const CQL_DOCS_SOURCES = [
  {
    name: 'syntax',
    title: 'Query Language Syntax',
    url: 'https://library.humio.com/data-analysis/syntax.html',
    filename: 'query-language-syntax.html',
    category: 'cql',
  },
  {
    name: 'training',
    title: 'CQL Overview',
    url: 'https://library.humio.com/training/queries-filter-transform-aggregate.html',
    filename: 'cql-overview.html',
    category: 'cql',
  },
  {
    name: 'grammar',
    title: 'Grammar Subset',
    url: 'https://library.humio.com/lql-grammar/syntax-grammar-guide.html',
    filename: 'cql-grammar-subset.html',
    category: 'cql',
  },
  {
    name: 'regex',
    title: 'Regex Syntax',
    url: 'https://library.humio.com/data-analysis-1.189/syntax-regex.html',
    filename: 'cql-regex-syntax.html',
    category: 'cql',
  },
];

const DASHBOARD_DOCS_SOURCES = [
  {
    name: 'dashboards-overview',
    title: 'Dashboards Overview',
    url: 'https://library.humio.com/data-analysis/dashboards.html',
    filename: 'dashboards-overview.html',
    category: 'dashboard',
  },
  {
    name: 'dashboards-create',
    title: 'Create Dashboards',
    url: 'https://library.humio.com/data-analysis/dashboards-create.html',
    filename: 'dashboards-create.html',
    category: 'dashboard',
  },
  {
    name: 'dashboards-widgets',
    title: 'Dashboard Widgets',
    url: 'https://library.humio.com/data-analysis/dashboards-allwidgets.html',
    filename: 'dashboards-widgets.html',
    category: 'dashboard',
  },
  {
    name: 'widgets-timechart',
    title: 'Time Chart Widget',
    url: 'https://library.humio.com/data-analysis/widgets-timechart.html',
    filename: 'widgets-timechart.html',
    category: 'dashboard',
  },
  {
    name: 'widgets-table',
    title: 'Table Widget',
    url: 'https://library.humio.com/data-analysis/widgets-table.html',
    filename: 'widgets-table.html',
    category: 'dashboard',
  },
  {
    name: 'widgets-piechart',
    title: 'Pie Chart Widget',
    url: 'https://library.humio.com/data-analysis/widgets-piechart.html',
    filename: 'widgets-piechart.html',
    category: 'dashboard',
  },
  {
    name: 'widgets-barchart',
    title: 'Bar Chart Widget',
    url: 'https://library.humio.com/data-analysis/widgets-barchart.html',
    filename: 'widgets-barchart.html',
    category: 'dashboard',
  },
  {
    name: 'widgets-gauge',
    title: 'Gauge Widget',
    url: 'https://library.humio.com/data-analysis/widgets-gauge.html',
    filename: 'widgets-gauge.html',
    category: 'dashboard',
  },
  {
    name: 'widgets-singlevalue',
    title: 'Single Value Widget',
    url: 'https://library.humio.com/data-analysis/widgets-single-value.html',
    filename: 'widgets-single-value.html',
    category: 'dashboard',
  },
  {
    name: 'widgets-worldmap',
    title: 'World Map Widget',
    url: 'https://library.humio.com/data-analysis/widgets-worldmap.html',
    filename: 'widgets-worldmap.html',
    category: 'dashboard',
  },
  {
    name: 'widgets-sankey',
    title: 'Sankey Diagram Widget',
    url: 'https://library.humio.com/data-analysis/widgets-sankey.html',
    filename: 'widgets-sankey.html',
    category: 'dashboard',
  },
  {
    name: 'widgets-scatter',
    title: 'Scatter Chart Widget',
    url: 'https://library.humio.com/data-analysis/widgets-scatter.html',
    filename: 'widgets-scatter.html',
    category: 'dashboard',
  },
  {
    name: 'widgets-note',
    title: 'Note Widget',
    url: 'https://library.humio.com/data-analysis/widgets-note.html',
    filename: 'widgets-note.html',
    category: 'dashboard',
  },
  {
    name: 'graphql-dashboard-api',
    title: 'GraphQL Dashboard API',
    url: 'https://library.humio.com/kb/kb-graphql-create-dashboard.html',
    filename: 'graphql-dashboard-api.html',
    category: 'dashboard',
  },
];

const DOCS_SOURCES = [...CQL_DOCS_SOURCES, ...DASHBOARD_DOCS_SOURCES];

setLogLevel(LOG_LEVEL);

log('info', '🔍 LogScale MCP Server Starting...');
log('info', `📊 Base URL: ${BASE_URL || 'NOT SET'}`);
log('info', `📂 Repository: ${REPOSITORY || 'NOT SET'}`);

if (!API_TOKEN || !BASE_URL || !REPOSITORY) {
  log('error', '❌ Missing required environment variables:');
  log('error', '   LOGSCALE_API_TOKEN, LOGSCALE_BASE_URL, LOGSCALE_REPOSITORY');
  log('error', '   Please check your .env file');
  process.exit(1);
}

function createLogscaleMcpServer() {
  const server = new Server({
    name: 'logscale-mcp-server',
    version: VERSION,
  }, {
    capabilities: {
      tools: {},
    },
  });

// ============================================================================
// Tool Definitions
// ============================================================================
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      // --- Query Tools ---
      {
        name: 'logscale_search',
        description: 'Search LogScale logs with a query string and time range',
        inputSchema: {
          type: 'object',
          properties: {
            search_term: {
              type: 'string',
              description: 'Search query (e.g., "error", "status_code=500"). Note: #view= is not valid CQL — to search a view, pass its name in the repository parameter.',
            },
            repository: {
              type: 'string',
              description: 'Repository or view name to query (overrides default from .env). View names (SOC, detections, ...) go here — never as a CQL tag.',
            },
            start_time: {
              type: 'string',
              description: 'Start time (e.g., "1h", "24h", "2025-01-01T00:00:00Z")',
              default: '1h',
            },
            max_events: {
              type: 'number',
              description: 'Maximum number of events to return (1-1000)',
              default: 100,
              minimum: 1,
              maximum: 1000,
            },
            end_time: {
              type: 'string',
              description: 'End time (defaults to now)',
            },
          },
          required: ['search_term'],
        },
      },
      {
        name: 'logscale_query',
        description: 'Execute a LogScale query with LogScale Query Language',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'LogScale Query Language (CQL) query. #repo=<repo> is the only tag filter — #view= does not exist and silently matches nothing. To query a view, pass its name in the repository parameter; use #repo= only with raw repository names (view names never match #repo=).',
            },
            repository: {
              type: 'string',
              description: 'Repository or view name to query (overrides default from .env). View names (SOC, detections, ...) go here — never as a CQL tag.',
            },
            start_time: {
              type: 'string',
              description: 'Start time (e.g., "1h", "24h", "2025-01-01T00:00:00Z")',
              default: '1h',
            },
            end_time: {
              type: 'string',
              description: 'End time (defaults to now)',
            },
            max_events: {
              type: 'number',
              description: 'Maximum number of events to return (1-10000). Only applied to non-aggregate queries. If omitted, LogScale\'s own default limit applies (~200 events for filter queries) — set this or use an explicit head()/tail() to control result size.',
              minimum: 1,
              maximum: 10000,
            },
          },
          required: ['query'],
        },
      },

      {
        name: 'logscale_cancel_query',
        description: 'Cancel a running LogScale query job by its ID',
        inputSchema: {
          type: 'object',
          properties: {
            job_id: {
              type: 'string',
              description: 'Query job ID to cancel',
            },
            repository: {
              type: 'string',
              description: 'Repository or view name (overrides default from .env)',
            },
          },
          required: ['job_id'],
        },
      },

      // --- Dashboard Management Tools ---
      {
        name: 'logscale_create_dashboard',
        description: 'Create a new LogScale dashboard with widgets, parameters (filters), and options',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Dashboard name',
            },
            description: {
              type: 'string',
              description: 'Dashboard description',
            },
            repository: {
              type: 'string',
              description: 'Repository or view name (overrides .env default)',
            },
            widgets: {
              type: 'array',
              description: 'Array of widget configurations',
              items: {
                type: 'object',
                properties: {
                  title: {
                    type: 'string',
                    description: 'Widget title',
                  },
                  query: {
                    type: 'string',
                    description: 'LogScale query for the widget',
                  },
                  visualization: {
                    type: 'string',
                    description: 'Widget type',
                    enum: ['bar-chart', 'pie-chart', 'table-view', 'time-chart', 'xy-chart', 'raw', 'single-value', 'simple-gauge', 'world-map', 'sankey', 'scatter-chart'],
                    default: 'table-view',
                  },
                  x: {
                    type: 'integer',
                    description: 'X position (0-11)',
                    minimum: 0,
                    maximum: 11,
                  },
                  y: {
                    type: 'integer',
                    description: 'Y position',
                  },
                  width: {
                    type: 'integer',
                    description: 'Widget width (1-12)',
                    minimum: 1,
                    maximum: 12,
                    default: 6,
                  },
                  height: {
                    type: 'integer',
                    description: 'Widget height',
                    default: 4,
                  },
                  time_range: {
                    type: 'string',
                    description: 'Time range for widget (e.g., "24h", "7d")',
                    default: '24h',
                  },
                  options: {
                    type: 'object',
                    description: 'Widget-specific options (e.g., {"cell-overflow":"wrap-text","row-numbers-enabled":false})',
                  },
                },
                required: ['title', 'query'],
              },
            },
            parameters: {
              type: 'object',
              description: 'Dashboard filter parameters. Keys are param names, values are objects with: label, order, type ("text" or "list"), defaultValue, width, and values (array, for list type)',
            },
            time_settings: {
              type: 'object',
              description: 'Shared time settings for dashboard',
              properties: {
                enabled: {
                  type: 'boolean',
                  default: false,
                },
                is_live: {
                  type: 'boolean',
                  default: false,
                },
                start: {
                  type: 'string',
                  default: '1d',
                },
              },
            },
          },
          required: ['name', 'widgets'],
        },
      },
      {
        name: 'logscale_list_dashboards',
        description: 'List all dashboards in a LogScale repository with their IDs and URLs',
        inputSchema: {
          type: 'object',
          properties: {
            repository: {
              type: 'string',
              description: 'Repository or view name (overrides .env default)',
            },
            filter: {
              type: 'string',
              description: 'Optional name filter (case-insensitive substring match)',
            },
          },
        },
      },
      {
        name: 'logscale_delete_dashboard',
        description: 'Delete a LogScale dashboard by ID or by name (searches for exact match)',
        inputSchema: {
          type: 'object',
          properties: {
            dashboard_id: {
              type: 'string',
              description: 'Dashboard ID to delete (takes priority over name)',
            },
            name: {
              type: 'string',
              description: 'Dashboard name to delete (exact match, used if dashboard_id not provided)',
            },
            repository: {
              type: 'string',
              description: 'Repository or view name (overrides .env default)',
            },
          },
        },
      },
      {
        name: 'logscale_export_dashboard',
        description: 'Export a deployed LogScale dashboard as YAML template',
        inputSchema: {
          type: 'object',
          properties: {
            dashboard_id: {
              type: 'string',
              description: 'Dashboard ID to export',
            },
            name: {
              type: 'string',
              description: 'Dashboard name to export (used if dashboard_id not provided)',
            },
            repository: {
              type: 'string',
              description: 'Repository or view name (overrides .env default)',
            },
            save_to_file: {
              type: 'string',
              description: 'Optional filename to save the YAML (saved in the logscale_mcp directory)',
            },
          },
        },
      },
      {
        name: 'logscale_deploy_yaml',
        description: 'Deploy a dashboard from a local YAML template file. Optionally delete existing dashboard with same name first.',
        inputSchema: {
          type: 'object',
          properties: {
            yaml_file: {
              type: 'string',
              description: 'YAML filename (in logscale_mcp directory) or absolute path',
            },
            name_override: {
              type: 'string',
              description: 'Override the dashboard name from the YAML file',
            },
            repository: {
              type: 'string',
              description: 'Repository or view name (overrides .env default)',
            },
            replace_existing: {
              type: 'boolean',
              description: 'If true, delete any existing dashboard with the same name before deploying',
              default: false,
            },
          },
          required: ['yaml_file'],
        },
      },

      {
        name: 'logscale_update_dashboard',
        description: 'Update an existing LogScale dashboard (rename, update description, or replace widgets via YAML template)',
        inputSchema: {
          type: 'object',
          properties: {
            dashboard_id: {
              type: 'string',
              description: 'Dashboard ID to update (takes priority over name)',
            },
            name: {
              type: 'string',
              description: 'Dashboard name to find (used if dashboard_id not provided)',
            },
            repository: {
              type: 'string',
              description: 'Repository or view name (overrides .env default)',
            },
            new_name: {
              type: 'string',
              description: 'New dashboard name',
            },
            description: {
              type: 'string',
              description: 'New dashboard description',
            },
            yaml_template: {
              type: 'string',
              description: 'Full YAML/JSON template to replace the dashboard content (widgets, parameters, etc.)',
            },
          },
        },
      },

      // --- Detection/Alert Management Tools ---
      {
        name: 'logscale_list_alerts',
        description: 'List all detections (filter alerts, aggregate alerts, scheduled searches) in a repository',
        inputSchema: {
          type: 'object',
          properties: {
            repository: {
              type: 'string',
              description: 'Repository or view name (overrides .env default)',
            },
            type: {
              type: 'string',
              description: 'Filter by alert type',
              enum: ['filter', 'aggregate', 'scheduled', 'all'],
              default: 'all',
            },
            enabled: {
              type: 'boolean',
              description: 'Filter by enabled status (omit to show all)',
            },
            label: {
              type: 'string',
              description: 'Filter by label (case-insensitive substring match)',
            },
            name_filter: {
              type: 'string',
              description: 'Filter by name (case-insensitive substring match)',
            },
          },
        },
      },
      {
        name: 'logscale_get_alert',
        description: 'Get full details of a specific detection (filter alert, aggregate alert, or scheduled search)',
        inputSchema: {
          type: 'object',
          properties: {
            alert_id: {
              type: 'string',
              description: 'Alert ID (takes priority over name)',
            },
            name: {
              type: 'string',
              description: 'Alert name (used if alert_id not provided)',
            },
            type: {
              type: 'string',
              description: 'Alert type hint to narrow search',
              enum: ['filter', 'aggregate', 'scheduled'],
            },
            repository: {
              type: 'string',
              description: 'Repository or view name (overrides .env default)',
            },
          },
        },
      },
      {
        name: 'logscale_create_alert',
        description: 'Create a new detection (filter alert, aggregate alert, or scheduled search)',
        inputSchema: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              description: 'Alert type to create',
              enum: ['filter', 'aggregate', 'scheduled'],
            },
            name: {
              type: 'string',
              description: 'Alert name',
            },
            query_string: {
              type: 'string',
              description: 'LogScale query for the detection',
            },
            actions: {
              type: 'array',
              description: 'Action names or IDs to trigger when alert fires',
              items: { type: 'string' },
            },
            description: {
              type: 'string',
              description: 'Alert description',
            },
            labels: {
              type: 'array',
              description: 'Labels for organizing alerts (max 10, max 60 chars each)',
              items: { type: 'string' },
            },
            enabled: {
              type: 'boolean',
              description: 'Whether the alert is enabled (default: true)',
              default: true,
            },
            repository: {
              type: 'string',
              description: 'Repository or view name (overrides .env default)',
            },
            query_ownership_type: {
              type: 'string',
              description: 'Query ownership type',
              enum: ['User', 'Organization'],
              default: 'Organization',
            },
            // Filter alert specific
            throttle_seconds: {
              type: 'number',
              description: 'Throttle time in seconds (filter/aggregate alerts)',
            },
            throttle_fields: {
              type: 'array',
              description: 'Fields to throttle on (filter/aggregate alerts)',
              items: { type: 'string' },
            },
            // Aggregate alert specific
            search_interval_seconds: {
              type: 'number',
              description: 'Search interval in seconds (aggregate alerts, scheduled searches)',
            },
            query_timestamp_type: {
              type: 'string',
              description: 'Timestamp type for query (aggregate alerts, scheduled searches)',
              enum: ['EventTimestamp', 'IngestTimestamp'],
              default: 'IngestTimestamp',
            },
            trigger_mode: {
              type: 'string',
              description: 'Trigger mode (aggregate alerts only)',
              enum: ['CompleteMode', 'ImmediateMode'],
              default: 'CompleteMode',
            },
            // Scheduled search specific
            max_wait_seconds: {
              type: 'number',
              description: 'Max wait time in seconds for ingest delay (scheduled searches with IngestTimestamp, e.g., 60)',
            },
            schedule: {
              type: 'string',
              description: 'Cron schedule expression (scheduled searches only, e.g., "0 * * * *" for hourly)',
            },
            time_zone: {
              type: 'string',
              description: 'Time zone for schedule (scheduled searches only, e.g., "America/Los_Angeles")',
              default: 'UTC',
            },
            backfill_limit: {
              type: 'number',
              description: 'Backfill limit (scheduled searches only)',
            },
            trigger_on_empty: {
              type: 'boolean',
              description: 'Trigger on empty result (scheduled searches only)',
              default: false,
            },
          },
          required: ['type', 'name', 'query_string', 'actions'],
        },
      },
      {
        name: 'logscale_update_alert',
        description: 'Update an existing detection (filter alert, aggregate alert, or scheduled search)',
        inputSchema: {
          type: 'object',
          properties: {
            alert_id: {
              type: 'string',
              description: 'Alert ID (takes priority over name)',
            },
            name: {
              type: 'string',
              description: 'Alert name to find (used if alert_id not provided)',
            },
            type: {
              type: 'string',
              description: 'Alert type (required if using name lookup)',
              enum: ['filter', 'aggregate', 'scheduled'],
            },
            repository: {
              type: 'string',
              description: 'Repository or view name (overrides .env default)',
            },
            // Fields to update (all optional)
            new_name: {
              type: 'string',
              description: 'New alert name',
            },
            query_string: {
              type: 'string',
              description: 'New query string',
            },
            description: {
              type: 'string',
              description: 'New description',
            },
            actions: {
              type: 'array',
              description: 'New action names or IDs',
              items: { type: 'string' },
            },
            labels: {
              type: 'array',
              description: 'New labels',
              items: { type: 'string' },
            },
            enabled: {
              type: 'boolean',
              description: 'Enable/disable the alert',
            },
            query_ownership_type: {
              type: 'string',
              enum: ['User', 'Organization'],
            },
            throttle_seconds: { type: 'number' },
            throttle_fields: { type: 'array', items: { type: 'string' } },
            search_interval_seconds: { type: 'number' },
            query_timestamp_type: { type: 'string', enum: ['EventTimestamp', 'IngestTimestamp'] },
            trigger_mode: { type: 'string', enum: ['CompleteMode', 'ImmediateMode'] },
            schedule: { type: 'string' },
            time_zone: { type: 'string' },
            max_wait_seconds: { type: 'number' },
            backfill_limit: { type: 'number' },
            trigger_on_empty: { type: 'boolean' },
          },
        },
      },
      {
        name: 'logscale_delete_alert',
        description: 'Delete a detection (filter alert, aggregate alert, or scheduled search)',
        inputSchema: {
          type: 'object',
          properties: {
            alert_id: {
              type: 'string',
              description: 'Alert ID (takes priority over name)',
            },
            name: {
              type: 'string',
              description: 'Alert name to delete (used if alert_id not provided)',
            },
            type: {
              type: 'string',
              description: 'Alert type hint to narrow search',
              enum: ['filter', 'aggregate', 'scheduled'],
            },
            repository: {
              type: 'string',
              description: 'Repository or view name (overrides .env default)',
            },
            confirm: {
              type: 'boolean',
              description: 'Must be true to confirm deletion',
            },
          },
          required: ['confirm'],
        },
      },
      {
        name: 'logscale_toggle_alert',
        description: 'Enable or disable a detection without needing full update',
        inputSchema: {
          type: 'object',
          properties: {
            alert_id: {
              type: 'string',
              description: 'Alert ID (takes priority over name)',
            },
            name: {
              type: 'string',
              description: 'Alert name (used if alert_id not provided)',
            },
            type: {
              type: 'string',
              description: 'Alert type hint to narrow search',
              enum: ['filter', 'aggregate', 'scheduled'],
            },
            enabled: {
              type: 'boolean',
              description: 'Set to true to enable, false to disable',
            },
            repository: {
              type: 'string',
              description: 'Repository or view name (overrides .env default)',
            },
          },
          required: ['enabled'],
        },
      },
      {
        name: 'logscale_list_actions',
        description: 'List available notification actions in a repository (for referencing when creating alerts)',
        inputSchema: {
          type: 'object',
          properties: {
            repository: {
              type: 'string',
              description: 'Repository or view name (overrides .env default)',
            },
          },
        },
      },
      {
        name: 'logscale_create_action',
        description: 'Create a notification action in a repository (Slack, Email, Webhook, PagerDuty, etc.)',
        inputSchema: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              description: 'Action type',
              enum: ['SlackPostMessage', 'SlackAction', 'EmailAction', 'WebhookAction', 'PagerDutyAction', 'OpsGenieAction', 'VictorOpsAction', 'HumioRepoAction', 'UploadFileAction'],
            },
            name: {
              type: 'string',
              description: 'Action name',
            },
            repository: {
              type: 'string',
              description: 'Repository or view name (overrides .env default)',
            },
            // Slack fields
            url: {
              type: 'string',
              description: 'Webhook URL (for Slack, Webhook, VictorOps)',
            },
            channels: {
              type: 'array',
              description: 'Slack channel names (for SlackPostMessage)',
              items: { type: 'string' },
            },
            // Email fields
            recipients: {
              type: 'array',
              description: 'Email recipients',
              items: { type: 'string' },
            },
            subject_template: {
              type: 'string',
              description: 'Email subject template',
            },
            body_template: {
              type: 'string',
              description: 'Message body template (for Email, Slack, Webhook)',
            },
            // Webhook fields
            method: {
              type: 'string',
              description: 'HTTP method for webhooks',
              enum: ['POST', 'PUT', 'GET'],
            },
            headers: {
              type: 'object',
              description: 'HTTP headers for webhooks (key-value pairs)',
            },
            // PagerDuty fields
            severity: {
              type: 'string',
              description: 'PagerDuty severity',
              enum: ['critical', 'error', 'warning', 'info'],
            },
            routing_key: {
              type: 'string',
              description: 'PagerDuty routing key or OpsGenie API key',
            },
            // HumioRepo fields
            ingest_token: {
              type: 'string',
              description: 'Ingest token for HumioRepoAction',
            },
          },
          required: ['type', 'name'],
        },
      },
      {
        name: 'logscale_delete_action',
        description: 'Delete a notification action by name or ID',
        inputSchema: {
          type: 'object',
          properties: {
            action_id: {
              type: 'string',
              description: 'Action ID (takes priority over name)',
            },
            name: {
              type: 'string',
              description: 'Action name (used if action_id not provided)',
            },
            repository: {
              type: 'string',
              description: 'Repository or view name (overrides .env default)',
            },
            confirm: {
              type: 'boolean',
              description: 'Must be true to confirm deletion',
            },
          },
          required: ['confirm'],
        },
      },
      {
        name: 'logscale_export_alert',
        description: 'Export a detection as a YAML template',
        inputSchema: {
          type: 'object',
          properties: {
            alert_id: {
              type: 'string',
              description: 'Alert ID (takes priority over name)',
            },
            name: {
              type: 'string',
              description: 'Alert name (used if alert_id not provided)',
            },
            type: {
              type: 'string',
              description: 'Alert type hint to narrow search',
              enum: ['filter', 'aggregate', 'scheduled'],
            },
            repository: {
              type: 'string',
              description: 'Repository or view name (overrides .env default)',
            },
            save_to_file: {
              type: 'string',
              description: 'Optional filename to save the YAML (saved in the logscale_mcp directory)',
            },
          },
        },
      },

      // --- Discovery Tools ---
      {
        name: 'logscale_list_repos',
        description: 'List all repositories and views available in LogScale with type labels and storage sizes. Views are queried via the repository parameter of query tools — never with a #view= tag (which is not valid CQL).',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'logscale_status',
        description: 'Check LogScale MCP server connectivity and configuration status',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },

      // --- Lookup File Tools ---
      {
        name: 'logscale_list_files',
        description: 'List all lookup files (CSV/JSON) uploaded to a LogScale repository',
        inputSchema: {
          type: 'object',
          properties: {
            repository: {
              type: 'string',
              description: 'Repository or view name (overrides default from .env)',
            },
          },
        },
      },
      {
        name: 'logscale_get_file',
        description: 'View the headers and content of a lookup file (CSV) in a LogScale repository. Use this to inspect column names and sample rows.',
        inputSchema: {
          type: 'object',
          properties: {
            filename: {
              type: 'string',
              description: 'Name of the lookup file (e.g. "allusers_lookup.csv")',
            },
            repository: {
              type: 'string',
              description: 'Repository or view name (overrides default from .env)',
            },
            filter: {
              type: 'string',
              description: 'Optional filter string to search within the file rows',
            },
            max_rows: {
              type: 'number',
              description: 'Maximum number of rows to return (default 10, max 500)',
              default: 10,
              minimum: 1,
              maximum: 500,
            },
          },
          required: ['filename'],
        },
      },

      {
        name: 'logscale_upload_file',
        description: 'Upload or update a lookup file (CSV) in a LogScale repository. Overwrites the file if it already exists.',
        inputSchema: {
          type: 'object',
          properties: {
            filename: {
              type: 'string',
              description: 'Name for the lookup file in LogScale (e.g., "watchlist.csv")',
            },
            content: {
              type: 'string',
              description: 'CSV content to upload (including header row)',
            },
            local_path: {
              type: 'string',
              description: 'Relative path to a local CSV file within the logscale_mcp directory to upload (alternative to content)',
            },
            repository: {
              type: 'string',
              description: 'Repository or view name (overrides default from .env)',
            },
          },
          required: ['filename'],
        },
      },

      // --- Documentation Tools ---
      {
        name: 'logscale_docs_sync',
        description: 'Download LogScale documentation locally for agent reference',
        inputSchema: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              description: 'Documentation category: cql, dashboard, or all',
              default: 'all',
              enum: ['cql', 'dashboard', 'all'],
            },
            refresh: {
              type: 'boolean',
              description: 'Force re-download even if cached files exist',
              default: false,
            },
            format: {
              type: 'string',
              description: 'Download format: html, markdown, or both',
              default: 'both',
            },
          },
        },
      },
      {
        name: 'logscale_docs',
        description: 'List or return locally cached LogScale documentation',
        inputSchema: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              description: 'Documentation category: cql, dashboard, or all',
              default: 'all',
              enum: ['cql', 'dashboard', 'all'],
            },
            include_content: {
              type: 'boolean',
              description: 'Include full document content in response',
              default: false,
            },
            max_chars: {
              type: 'number',
              description: 'Maximum characters to return per document',
              default: 20000,
              minimum: 1000,
              maximum: 200000,
            },
          },
        },
      },
      {
        name: 'logscale_docs_text',
        description: 'Return cached LogScale documentation as plain text for agents',
        inputSchema: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              description: 'Documentation category: cql, dashboard, or all',
              default: 'all',
              enum: ['cql', 'dashboard', 'all'],
            },
            doc_name: {
              type: 'string',
              description: 'Optional specific doc name to retrieve',
            },
            max_chars: {
              type: 'number',
              description: 'Maximum characters to return per document',
              default: 20000,
              minimum: 1000,
              maximum: 200000,
            },
          },
        },
      },
    ],
  };
});

// ============================================================================
// Tool Dispatch
// ============================================================================
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      // Query tools
      case 'logscale_search':
        return await handleLogScaleSearch(args);
      case 'logscale_query':
        return await handleLogScaleQuery(args);
      case 'logscale_cancel_query':
        return await handleCancelQuery(args);

      // Dashboard management tools
      case 'logscale_create_dashboard':
        return await handleCreateDashboard(args);
      case 'logscale_list_dashboards':
        return await handleListDashboards(args);
      case 'logscale_delete_dashboard':
        return await handleDeleteDashboard(args);
      case 'logscale_export_dashboard':
        return await handleExportDashboard(args);
      case 'logscale_deploy_yaml':
        return await handleDeployYaml(args);
      case 'logscale_update_dashboard':
        return await handleUpdateDashboard(args);

      // Detection/Alert management tools
      case 'logscale_list_alerts':
        return await handleListAlerts(args);
      case 'logscale_get_alert':
        return await handleGetAlert(args);
      case 'logscale_create_alert':
        return await handleCreateAlert(args);
      case 'logscale_update_alert':
        return await handleUpdateAlert(args);
      case 'logscale_delete_alert':
        return await handleDeleteAlert(args);
      case 'logscale_toggle_alert':
        return await handleToggleAlert(args);
      case 'logscale_list_actions':
        return await handleListActions(args);
      case 'logscale_create_action':
        return await handleCreateAction(args);
      case 'logscale_delete_action':
        return await handleDeleteAction(args);
      case 'logscale_export_alert':
        return await handleExportAlert(args);

      // Discovery tools
      case 'logscale_list_repos':
        return await handleListRepos(args);
      case 'logscale_status':
        return await handleStatus(args);

      // Lookup file tools
      case 'logscale_list_files':
        return await handleListFiles(args);
      case 'logscale_get_file':
        return await handleGetFile(args);
      case 'logscale_upload_file':
        return await handleUploadFile(args);

      // Documentation tools
      case 'logscale_docs_sync':
        return await handleDocsSync(args);
      case 'logscale_docs':
        return await handleDocs(args);
      case 'logscale_docs_text':
        return await handleDocsText(args);

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

  return server;
}

// ============================================================================
// Query Handlers
// ============================================================================
async function handleLogScaleSearch(args) {
  const { search_term, repository, start_time = '1h', max_events = 100 } = args;

  if (!search_term || typeof search_term !== 'string') {
    throw new Error('search_term is required and must be a string');
  }

  const maxEvents = normalizeMaxEvents(max_events);
  const query = `${search_term} | head(${maxEvents})`;

  log('debug', `🔍 Search query: ${query}`);
  log('debug', `📂 Repository: ${repository || REPOSITORY} ${repository ? '(override)' : '(default)'}`);
  return await executeLogScaleQuery(query, start_time, args.end_time, repository);
}

async function handleLogScaleQuery(args) {
  const { query, repository, start_time = '1h', end_time, max_events } = args;

  if (!query || typeof query !== 'string') {
    throw new Error('query is required and must be a string');
  }

  // If max_events is set, append a head() to cap results for non-aggregate queries
  let finalQuery = query;
  if (max_events !== undefined) {
    const cap = Number.parseInt(String(max_events), 10);
    if (!Number.isFinite(cap) || cap < 1 || cap > 10000) {
      throw new Error('max_events must be a number between 1 and 10000');
    }
    finalQuery = `${query} | head(${cap})`;
  }

  log('debug', `🔍 Raw query: ${finalQuery}`);
  log('debug', `📂 Repository: ${repository || REPOSITORY} ${repository ? '(override)' : '(default)'}`);
  return await executeLogScaleQuery(finalQuery, start_time, end_time, repository);
}

async function handleCancelQuery(args) {
  const { job_id, repository } = args;
  const repo = validateRepoName(repository || REPOSITORY);
  const safeJobId = validateJobId(job_id);

  const deleteUrl = `${BASE_URL}/api/v1/repositories/${repo}/queryjobs/${safeJobId}`;
  const response = await restFetch(deleteUrl, {
    method: 'DELETE',
    timeoutLabel: 'Cancel query job request',
  });

  if (!response.ok) {
    const errorText = sanitizeErrorText(await response.text());
    throw new Error(`Failed to cancel query job ${safeJobId}: ${response.status} ${errorText}`);
  }

  return {
    content: [{ type: 'text', text: `✅ Query job ${job_id} cancelled successfully.` }],
  };
}

async function executeLogScaleQuery(query, startTime, endTime, repository) {
  const repo = validateRepoName(repository || REPOSITORY);
  assertNoViewTag(query);
  const end = parseTimeInput(endTime, Date.now(), true);
  const start = parseTimeInput(startTime, end, false);

  if (start > end) {
    throw new Error('start_time must be before end_time');
  }

  log('debug', `⏰ Time range: ${new Date(start).toISOString()} to ${new Date(end).toISOString()}`);

  // Use Query Jobs API for reliable handling of all query types
  const jobUrl = `${BASE_URL}/api/v1/repositories/${repo}/queryjobs`;

  log('debug', `🌐 Creating query job at: ${jobUrl}`);

  // Step 1: Create the query job
  const jobInfo = await withRetry(async () => {
    const createResponse = await restFetch(jobUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ queryString: query, start, end, isLive: false }),
      timeoutLabel: 'LogScale API request',
    });

    if (!createResponse.ok) {
      throw httpError('LogScale API error', createResponse.status, sanitizeErrorText(await createResponse.text()));
    }

    return await createResponse.json();
  }, 'QueryJob');
  const jobId = jobInfo.id;

  log('debug', `📋 Query job created: ${jobId}`);

  // Step 2: Poll until done or the wall-clock budget runs out, honoring the
  // server's pollAfter backoff hint. Jobs otherwise linger server-side until
  // the 90s no-poll expiry, so cleanup runs on every exit path.
  const pollUrl = `${BASE_URL}/api/v1/repositories/${repo}/queryjobs/${jobId}`;
  const deadline = Date.now() + QUERY_TIMEOUT_MS;
  let pollResult = null;

  try {
    for (;;) {
      pollResult = await withRetry(async () => {
        const pollResponse = await restFetch(pollUrl, {
          headers: { 'Accept': 'application/json' },
          timeoutLabel: 'LogScale poll request',
        });

        if (!pollResponse.ok) {
          throw httpError('LogScale poll error', pollResponse.status, sanitizeErrorText(await pollResponse.text()));
        }

        return await pollResponse.json();
      }, 'QueryJobPoll');

      log('debug', `📊 Poll: done=${pollResult.done}, events=${pollResult.events?.length || 0}`);

      if (pollResult.done) break;

      if (Date.now() >= deadline) {
        throw new Error(`Query exceeded ${QUERY_TIMEOUT_MS}ms and was cancelled. Narrow the time range or raise LOGSCALE_QUERY_TIMEOUT_MS.`);
      }

      const pollAfter = pollResult.metaData?.pollAfter;
      const waitMs = Number.isFinite(pollAfter) && pollAfter > 0 ? pollAfter : QUERY_POLL_INTERVAL_MS;
      await new Promise(resolvePoll => setTimeout(resolvePoll, Math.max(0, Math.min(waitMs, deadline - Date.now()))));
    }
  } finally {
    deleteQueryJob(repo, jobId);
  }

  if (pollResult.cancelled) {
    throw new Error('Query job was cancelled server-side before completing — results discarded.');
  }

  // Parse response
  const events = pollResult.events || [];
  const metaData = pollResult.metaData || {};
  const warnings = [...(pollResult.warnings || []), ...(metaData.warnings || [])];

  log('debug', `📊 Parsed ${events.length} events from query job`);

  // The API reports truncation via extraData.hasMoreEvents (filter queries hit
  // LogScale's default ~200-event result cap unless the query sets head()/tail())
  const hasMoreEvents = metaData.extraData?.hasMoreEvents === 'true'
    || (Number.isFinite(metaData.eventCount) && metaData.eventCount > events.length);

  let resultText = `# LogScale Query Results\n\n`;
  resultText += `**Query:** \`${query}\`\n`;
  resultText += `**Time Range:** ${new Date(start).toISOString()} to ${new Date(end).toISOString()}\n`;
  resultText += `**Total Events:** ${events.length}${hasMoreEvents ? ' (⚠️ truncated by LogScale — more events matched; use head()/tail() or max_events to control the limit)' : ''}\n`;
  if (Number.isFinite(metaData.timeMillis)) {
    resultText += `**Query Time:** ${metaData.timeMillis}ms\n`;
  }
  if (Number.isFinite(metaData.processedEvents)) {
    resultText += `**Events Scanned:** ${metaData.processedEvents}\n`;
  }
  resultText += '\n';

  for (const warning of warnings) {
    const message = typeof warning === 'string' ? warning : (warning.message || JSON.stringify(warning));
    resultText += `> ⚠️ **Warning:** ${message} — results may be incomplete.\n`;
  }
  if (warnings.length > 0) resultText += '\n';

  if (events.length === 0) {
    resultText += `*No events found matching the query.*\n\n`;
  } else {
    // Check if this looks like an aggregate query (no @rawstring, no @timestamp typically)
    const firstEvent = events[0];
    const isAggregate = !firstEvent['@rawstring'] && !firstEvent['@id'];
    const columns = isAggregate ? Object.keys(firstEvent).filter(k => !k.startsWith('@')) : [];
    let elidedFrom = null;

    if (isAggregate && columns.length > 0) {
      // Format as a compact markdown table
      resultText += `## Results\n\n`;
      resultText += `| ${columns.join(' | ')} |\n`;
      resultText += `| ${columns.map(() => '---').join(' | ')} |\n`;
      for (let i = 0; i < events.length; i++) {
        if (resultText.length > MAX_RESULT_CHARS) {
          elidedFrom = i;
          break;
        }
        resultText += `| ${columns.map(c => String(events[i][c] ?? '')).join(' | ')} |\n`;
      }
      resultText += '\n';
    } else {
      resultText += `## Events\n\n`;
      for (let i = 0; i < events.length; i++) {
        if (resultText.length > MAX_RESULT_CHARS) {
          elidedFrom = i;
          break;
        }
        resultText += `### Event ${i + 1}\n`;
        resultText += '```json\n';
        resultText += JSON.stringify(events[i], null, 2);
        resultText += '\n```\n\n';
      }
    }

    if (elidedFrom !== null) {
      resultText += `*Output truncated: showing ${elidedFrom} of ${events.length} events (${MAX_RESULT_CHARS} char limit). Narrow the query or aggregate to see the rest.*\n`;
    }
  }

  return {
    content: [
      {
        type: 'text',
        text: resultText,
      },
    ],
  };
}

// ============================================================================
// HTTP, Retry, and GraphQL Helpers
// ============================================================================

// Fetch with the standard auth header, request timeout, and AbortError translation.
// Pass token: null for external (non-LogScale) URLs so credentials are never leaked.
async function restFetch(url, { method = 'GET', headers = {}, body, token = API_TOKEN, timeoutLabel = 'LogScale API request' } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method,
      headers: { ...(token ? { 'Authorization': `Bearer ${token}` } : {}), ...headers },
      body,
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      const timeoutErr = new Error(`${timeoutLabel} timed out`);
      timeoutErr.isTimeout = true;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// Error carrying the actual HTTP status so retry logic doesn't have to regex the message
function httpError(prefix, status, detail) {
  const err = new Error(`${prefix} (${status}): ${detail}`);
  err.httpStatus = status;
  return err;
}

function isRetryableError(err) {
  if (err.isTimeout || err.name === 'AbortError') return true;
  if (Number.isFinite(err.httpStatus)) return err.httpStatus >= 500;
  // Network-level failures never carry an HTTP status
  return Boolean(err.message && /ECONNRESET|ECONNREFUSED|fetch failed|network/i.test(err.message));
}

async function withRetry(fn, label = 'request') {
  let lastError;
  for (let attempt = 1; attempt <= RETRY_MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isRetryableError(err) || attempt >= RETRY_MAX_ATTEMPTS) throw err;
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      log('warn', `⚠️ ${label} attempt ${attempt} failed (${err.message}), retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError;
}

async function executeGraphQL(query, variables = {}, { retry } = {}) {
  const graphqlUrl = `${BASE_URL}/graphql`;

  log('debug', `🔗 GraphQL request to: ${graphqlUrl}`);

  // Mutations are not retried by default: a create/delete that completed
  // server-side but timed out client-side would be re-executed (duplicate
  // alerts/dashboards). Reads are safe to retry.
  const isMutation = /^\s*mutation\b/i.test(query);
  const shouldRetry = retry ?? !isMutation;

  const doRequest = async () => {
    const response = await restFetch(graphqlUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      token: USER_API_TOKEN,
      timeoutLabel: 'GraphQL request',
    });

    if (!response.ok) {
      throw httpError('GraphQL HTTP error', response.status, sanitizeErrorText(await response.text()));
    }

    const result = await response.json();

    if (result.errors) {
      throw new Error(`GraphQL errors: ${sanitizeErrorText(JSON.stringify(result.errors, null, 2), 1000)}`);
    }

    log('debug', `✓ GraphQL request successful`);
    return result.data;
  };

  return shouldRetry ? withRetry(doRequest, 'GraphQL') : doRequest();
}

// Best-effort cleanup of a completed or timed-out query job
function deleteQueryJob(repo, jobId) {
  const deleteUrl = `${BASE_URL}/api/v1/repositories/${repo}/queryjobs/${jobId}`;
  fetch(deleteUrl, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${API_TOKEN}` },
    signal: AbortSignal.timeout(5000),
  }).catch(err => {
    log('debug', `Query job cleanup failed (non-critical): ${err.message}`);
  });
}

// ============================================================================
// Dashboard Handlers
// ============================================================================
async function handleCreateDashboard(args) {
  const { name, description, repository, widgets = [], parameters, time_settings = {} } = args;
  const repo = validateRepoName(repository || REPOSITORY);

  if (!name || !Array.isArray(widgets) || widgets.length === 0) {
    throw new Error('name and at least one widget are required');
  }

  log('info', `📊 Creating dashboard "${name}" with ${widgets.length} widgets`);

  // Build widgets template
  const widgetsTemplate = {};
  widgets.forEach((widget, index) => {
    const widgetId = randomUUID();
    widgetsTemplate[widgetId] = {
      x: widget.x ?? (index % 2) * 6,
      y: widget.y ?? Math.floor(index / 2) * 4,
      height: widget.height || 4,
      width: widget.width || 6,
      title: widget.title,
      queryString: widget.query,
      visualization: widget.visualization || 'table-view',
      start: widget.time_range || '24h',
      end: 'now',
      isLive: false,
      type: 'query',
    };

    if (widget.description) {
      widgetsTemplate[widgetId].description = widget.description;
    }
    if (widget.options) {
      widgetsTemplate[widgetId].options = widget.options;
    }
  });

  const template = {
    name,
    description: description || '',
    timeSelector: {},
    sharedTimeInterval: {
      enabled: time_settings.enabled || false,
      isLive: time_settings.is_live || false,
      start: time_settings.start || '1d',
    },
    widgets: widgetsTemplate,
    '$schema': `https://schemas.humio.com/dashboard/${DASHBOARD_SCHEMA_VERSION}`,
  };

  // Add parameters if provided
  if (parameters) {
    template.parameters = parameters;
  }

  const templateJson = JSON.stringify(template);
  log('debug', `📋 Template size: ${templateJson.length} bytes`);

  const dashboard = await deployDashboardTemplate(repo, name, templateJson);
  const dashboardUrl = `${BASE_URL}/${repo}/dashboards/${dashboard.id}`;

  return {
    content: [{
      type: 'text',
      text: `✅ Dashboard "${name}" created successfully!\n\n**ID:** ${dashboard.id}\n**Repository:** ${repo}\n**Widgets:** ${widgets.length}\n**View at:** ${dashboardUrl}`,
    }],
  };
}

// Dashboard helper: fetch all dashboards
async function fetchDashboardList(repo) {
  const data = await executeGraphQL(`
    query ListDashboards($repo: String!) {
      searchDomain(name: $repo) {
        ... on View { dashboards { id name displayName description } }
        ... on Repository { dashboards { id name displayName description } }
      }
    }
  `, { repo });
  return data?.searchDomain?.dashboards || [];
}

// Dashboard helper: resolve name to ID
async function resolveDashboardId(repo, nameOrId) {
  const dashboards = await fetchDashboardList(repo);
  // Try by ID first
  const byId = dashboards.find(d => d.id === nameOrId);
  if (byId) return byId;
  // Try by name (exact match)
  const byName = dashboards.find(d => d.name === nameOrId || d.displayName === nameOrId);
  return byName || null;
}

// Dashboard helper: deploy template
async function deployDashboardTemplate(repo, name, template) {
  const mutation = `
    mutation CreateDashboard($viewName: RepoOrViewName!, $name: String!, $yamlTemplate: YAML!) {
      createDashboardFromTemplateV2(input: {
        viewName: $viewName,
        name: $name,
        yamlTemplate: $yamlTemplate
      }) {
        id
        name
        displayName
      }
    }
  `;
  const data = await executeGraphQL(mutation, {
    viewName: repo,
    name,
    yamlTemplate: typeof template === 'string' ? template : JSON.stringify(template),
  });
  return data.createDashboardFromTemplateV2;
}

// Dashboard helper: delete by ID
async function deleteDashboardById(repo, dashboardId) {
  const mutation = `
    mutation DeleteDashboard($id: String!) {
      deleteDashboard(input: { id: $id }) {
        dashboard { id name }
      }
    }
  `;
  return await executeGraphQL(mutation, { id: dashboardId });
}

// Dashboard helper: fetch a dashboard's name and YAML template (null if not found)
async function fetchDashboardTemplate(repo, dashboardId) {
  const data = await executeGraphQL(`
    query ExportDashboard($repo: String!, $dashId: String!) {
      searchDomain(name: $repo) {
        ... on View { dashboard(id: $dashId) { id name displayName yamlTemplate } }
        ... on Repository { dashboard(id: $dashId) { id name displayName yamlTemplate } }
      }
    }
  `, { repo, dashId: dashboardId });
  return data?.searchDomain?.dashboard || null;
}

// Dashboard helper: replace an existing dashboard with a new template.
// createDashboardFromTemplateV2 rejects duplicate names, so replacement is
// delete-then-create — back up the current template first and restore it if
// the new template fails to deploy, so a bad template can't destroy the dashboard.
async function replaceDashboard(repo, existingId, name, template) {
  const backup = await fetchDashboardTemplate(repo, existingId);
  const dashName = name || backup?.displayName || backup?.name;
  if (!dashName) throw new Error(`Dashboard ${existingId} not found in ${repo}`);
  await deleteDashboardById(repo, existingId);
  try {
    return await deployDashboardTemplate(repo, dashName, template);
  } catch (err) {
    if (backup?.yamlTemplate) {
      try {
        const restored = await deployDashboardTemplate(repo, backup.displayName || backup.name, backup.yamlTemplate);
        err.message += ` — the original dashboard was restored (new ID: ${restored.id})`;
      } catch (restoreErr) {
        err.message += ` — WARNING: restoring the original dashboard also failed (${restoreErr.message}); its template backup was lost with it`;
      }
    }
    throw err;
  }
}

async function handleListDashboards(args) {
  const { repository, filter } = args || {};
  const repo = validateRepoName(repository || REPOSITORY);

  const dashboards = await fetchDashboardList(repo);

  let filtered = dashboards;
  if (filter) {
    const lowerFilter = filter.toLowerCase();
    filtered = dashboards.filter(d =>
      (d.name || '').toLowerCase().includes(lowerFilter) ||
      (d.displayName || '').toLowerCase().includes(lowerFilter)
    );
  }

  if (filtered.length === 0) {
    return {
      content: [{ type: 'text', text: `No dashboards found${filter ? ` matching "${filter}"` : ''} in ${repo}.` }],
    };
  }

  let text = `# Dashboards in ${repo}\n\n`;
  text += `Found ${filtered.length} dashboard(s)${filter ? ` matching "${filter}"` : ''}:\n\n`;
  text += `| Name | ID | URL |\n| --- | --- | --- |\n`;
  for (const d of filtered) {
    const displayName = d.displayName || d.name;
    text += `| ${displayName} | ${d.id} | ${BASE_URL}/${repo}/dashboards/${d.id} |\n`;
  }

  return { content: [{ type: 'text', text }] };
}

async function handleDeleteDashboard(args) {
  const { dashboard_id, name, repository } = args || {};
  const repo = validateRepoName(repository || REPOSITORY);

  if (!dashboard_id && !name) {
    throw new Error('Either dashboard_id or name is required');
  }

  let targetId = dashboard_id;
  let targetName = name;

  if (!targetId) {
    const resolved = await resolveDashboardId(repo, name);
    if (!resolved) throw new Error(`Dashboard "${name}" not found in ${repo}`);
    targetId = resolved.id;
    targetName = resolved.displayName || resolved.name;
  }

  await deleteDashboardById(repo, targetId);

  return {
    content: [{ type: 'text', text: `✅ Dashboard "${targetName || targetId}" deleted successfully from ${repo}.` }],
  };
}

async function handleExportDashboard(args) {
  const { dashboard_id, name, repository, save_to_file } = args || {};
  const repo = validateRepoName(repository || REPOSITORY);

  if (!dashboard_id && !name) {
    throw new Error('Either dashboard_id or name is required');
  }

  let targetId = dashboard_id;
  if (!targetId) {
    const resolved = await resolveDashboardId(repo, name);
    if (!resolved) throw new Error(`Dashboard "${name}" not found in ${repo}`);
    targetId = resolved.id;
  }

  const dashboard = await fetchDashboardTemplate(repo, targetId);
  if (!dashboard) throw new Error(`Dashboard ${targetId} not found`);

  const yamlContent = dashboard.yamlTemplate;

  if (save_to_file) {
    const outPath = safePath(DASHBOARD_YAML_DIR, save_to_file);
    await writeFile(outPath, yamlContent, 'utf8');
    return {
      content: [{ type: 'text', text: `✅ Dashboard "${dashboard.displayName || dashboard.name}" exported to ${outPath}` }],
    };
  }

  return {
    content: [{ type: 'text', text: `# Exported: ${dashboard.displayName || dashboard.name}\n\n\`\`\`yaml\n${yamlContent}\n\`\`\`` }],
  };
}

async function handleDeployYaml(args) {
  const { yaml_file, name_override, repository, replace_existing = false } = args;
  const repo = validateRepoName(repository || REPOSITORY);

  if (!yaml_file) throw new Error('yaml_file is required');

  const filePath = safePath(DASHBOARD_YAML_DIR, yaml_file);
  const content = await readFile(filePath, 'utf8');
  const parsed = yaml.load(content, { schema: yaml.JSON_SCHEMA });

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`YAML file "${yaml_file}" does not contain a dashboard template object`);
  }

  const dashName = name_override || parsed.name;

  if (!dashName) throw new Error('Dashboard name not found in YAML and no name_override provided');

  let result;
  const existing = replace_existing ? await resolveDashboardId(repo, dashName) : null;
  if (existing) {
    log('info', `🔄 Replacing existing dashboard "${dashName}" (${existing.id})`);
    result = await replaceDashboard(repo, existing.id, dashName, JSON.stringify(parsed));
  } else {
    result = await deployDashboardTemplate(repo, dashName, JSON.stringify(parsed));
  }
  const dashboardUrl = `${BASE_URL}/${repo}/dashboards/${result.id}`;

  return {
    content: [{ type: 'text', text: `✅ Dashboard "${dashName}" deployed from ${yaml_file}\n\n**ID:** ${result.id}\n**Repository:** ${repo}\n**View at:** ${dashboardUrl}` }],
  };
}

async function handleUpdateDashboard(args) {
  const { dashboard_id, name, repository, new_name, description, yaml_template } = args || {};
  const repo = validateRepoName(repository || REPOSITORY);

  if (!dashboard_id && !name) {
    throw new Error('Either dashboard_id or name is required');
  }

  let targetId = dashboard_id;
  let targetName = name;

  if (!targetId) {
    const resolved = await resolveDashboardId(repo, name);
    if (!resolved) throw new Error(`Dashboard "${name}" not found in ${repo}`);
    targetId = resolved.id;
    targetName = resolved.displayName || resolved.name;
  }

  // If yaml_template is provided, do a full template update (delete + recreate,
  // with rollback to the original template if the new one fails to deploy)
  if (yaml_template) {
    const result = await replaceDashboard(repo, targetId, new_name || targetName, yaml_template);
    const dashboardUrl = `${BASE_URL}/${repo}/dashboards/${result.id}`;
    return {
      content: [{ type: 'text', text: `✅ Dashboard "${result.displayName || result.name}" updated (replaced) successfully!\n\n**New ID:** ${result.id}\n**View at:** ${dashboardUrl}` }],
    };
  }

  // Otherwise, use GraphQL mutation for metadata-only updates
  if (!new_name && description === undefined) {
    throw new Error('Provide new_name, description, or yaml_template to update');
  }

  const mutation = `
    mutation UpdateDashboard($input: UpdateDashboardInput!) {
      updateDashboard(input: $input) {
        id
        name
        displayName
      }
    }
  `;

  const input = { id: targetId };
  if (new_name) input.name = new_name;
  if (description !== undefined) input.description = description;

  const data = await executeGraphQL(mutation, { input });
  const updated = data.updateDashboard;
  const dashboardUrl = `${BASE_URL}/${repo}/dashboards/${updated.id}`;

  return {
    content: [{ type: 'text', text: `✅ Dashboard "${updated.displayName || updated.name}" updated successfully!\n\n**ID:** ${updated.id}\n**View at:** ${dashboardUrl}` }],
  };
}

// ============================================================================
// Detection/Alert Helpers
// ============================================================================

// Fetch all alerts of a given type (or all types)
async function fetchAlertsByType(repo, type = 'all') {
  const fragments = {
    filter: `filterAlerts {
      id name description queryString enabled labels
      throttleTimeSeconds throttleFields
      lastTriggered lastError
      queryOwnership { __typename }
      actions { id name __typename }
    }`,
    aggregate: `aggregateAlerts {
      id name description queryString enabled labels
      throttleTimeSeconds throttleFields searchIntervalSeconds
      queryTimestampType triggerMode
      lastTriggered lastSuccessfulPoll lastError
      queryOwnership { __typename }
      actions { id name __typename }
    }`,
    scheduled: `scheduledSearches {
      id name description queryString enabled labels
      schedule timeZone searchIntervalSeconds maxWaitTimeSeconds
      queryTimestampType backfillLimitV2 triggerOnEmptyResult
      timeOfLastExecution timeOfLastTrigger lastError
      queryOwnership { __typename }
      actionsV2 { id name __typename }
    }`,
  };

  const selectedFragments = type === 'all'
    ? Object.values(fragments).join('\n')
    : fragments[type];

  if (!selectedFragments) {
    throw new Error(`Unknown alert type: ${type}. Use filter, aggregate, scheduled, or all`);
  }

  const data = await executeGraphQL(`
    query FetchAlerts($repo: String!) {
      searchDomain(name: $repo) {
        ... on View { ${selectedFragments} }
        ... on Repository { ${selectedFragments} }
      }
    }
  `, { repo });

  const domain = data?.searchDomain || {};
  const result = {};

  if (type === 'all' || type === 'filter') {
    result.filter = (domain.filterAlerts || []).map(a => ({ ...a, _type: 'filter' }));
  }
  if (type === 'all' || type === 'aggregate') {
    result.aggregate = (domain.aggregateAlerts || []).map(a => ({ ...a, _type: 'aggregate' }));
  }
  if (type === 'all' || type === 'scheduled') {
    result.scheduled = (domain.scheduledSearches || []).map(a => ({
      ...a,
      _type: 'scheduled',
      // Normalize: scheduledSearches use actionsV2 instead of actions
      actions: a.actionsV2 || a.actions || [],
    }));
  }

  return result;
}

// Resolve alert by ID or name, searching across types (single query)
async function resolveAlertId(repo, nameOrId, typeHint) {
  // Fetch all needed types in one GraphQL call
  const fetchType = typeHint || 'all';
  const alerts = await fetchAlertsByType(repo, fetchType);

  const types = typeHint ? [typeHint] : ['filter', 'aggregate', 'scheduled'];

  for (const type of types) {
    const list = alerts[type] || [];

    // Try by ID first
    const byId = list.find(a => a.id === nameOrId);
    if (byId) return { id: byId.id, type, alert: byId };

    // Try by name (exact match)
    const byName = list.find(a => a.name === nameOrId);
    if (byName) return { id: byName.id, type, alert: byName };
  }

  return null;
}

// Derive the mutation-input ownership enum from an alert's queryOwnership union
function existingOwnershipType(alert) {
  return alert?.queryOwnership?.__typename === 'UserOwnership' ? 'User' : 'Organization';
}

// Resolve action names to IDs
async function resolveActionIds(repo, actionNamesOrIds) {
  const data = await executeGraphQL(`
    query ListActions($repo: String!) {
      searchDomain(name: $repo) {
        ... on View { actions { id name } }
        ... on Repository { actions { id name } }
      }
    }
  `, { repo });

  const allActions = data?.searchDomain?.actions || [];
  const resolved = [];

  for (const ref of actionNamesOrIds) {
    // Check if it's already an ID
    const byId = allActions.find(a => a.id === ref);
    if (byId) {
      resolved.push(byId.id);
      continue;
    }
    // Try by name (case-insensitive)
    const byName = allActions.find(a => a.name.toLowerCase() === ref.toLowerCase());
    if (byName) {
      resolved.push(byName.name);
      continue;
    }
    throw new Error(`Action "${ref}" not found. Available actions: ${allActions.map(a => a.name).join(', ')}`);
  }

  return resolved;
}

// ============================================================================
// Detection/Alert Handlers
// ============================================================================

async function handleListAlerts(args) {
  const { repository, type = 'all', enabled, label, name_filter } = args || {};
  const repo = validateRepoName(repository || REPOSITORY);

  const alerts = await fetchAlertsByType(repo, type);
  let allAlerts = [
    ...(alerts.filter || []),
    ...(alerts.aggregate || []),
    ...(alerts.scheduled || []),
  ];

  // Apply filters
  if (enabled !== undefined) {
    allAlerts = allAlerts.filter(a => a.enabled === enabled);
  }
  if (label) {
    const lowerLabel = label.toLowerCase();
    allAlerts = allAlerts.filter(a =>
      (a.labels || []).some(l => l.toLowerCase().includes(lowerLabel))
    );
  }
  if (name_filter) {
    const lowerName = name_filter.toLowerCase();
    allAlerts = allAlerts.filter(a =>
      (a.name || '').toLowerCase().includes(lowerName)
    );
  }

  if (allAlerts.length === 0) {
    return {
      content: [{ type: 'text', text: `No alerts found in ${repo}${type !== 'all' ? ` (type: ${type})` : ''}.` }],
    };
  }

  // Sort by type then name
  allAlerts.sort((a, b) => {
    if (a._type !== b._type) return a._type.localeCompare(b._type);
    return a.name.localeCompare(b.name);
  });

  let text = `# Detections in ${repo}\n\n`;
  text += `Found ${allAlerts.length} detection(s):\n\n`;
  text += `| Type | Name | Enabled | Labels | Last Error |\n`;
  text += `| --- | --- | --- | --- | --- |\n`;

  for (const a of allAlerts) {
    const typeLabel = ALERT_TYPE_LABELS[a._type].split(' ')[0];
    const labels = (a.labels || []).join(', ') || '-';
    const errorStatus = a.lastError ? '⚠️ Error' : '✅';
    text += `| ${typeLabel} | ${a.name} | ${a.enabled ? '✅' : '❌'} | ${labels} | ${errorStatus} |\n`;
  }

  return { content: [{ type: 'text', text }] };
}

async function handleGetAlert(args) {
  const { alert_id, name, type, repository } = args || {};
  const repo = validateRepoName(repository || REPOSITORY);

  if (!alert_id && !name) {
    throw new Error('Either alert_id or name is required');
  }

  const resolved = await resolveAlertId(repo, alert_id || name, type);
  if (!resolved) {
    throw new Error(`Alert "${alert_id || name}" not found in ${repo}`);
  }

  const { alert, type: alertType } = resolved;
  const typeLabel = ALERT_TYPE_LABELS[alertType];

  let text = `# ${typeLabel}: ${alert.name}\n\n`;
  text += `**ID:** ${alert.id}\n`;
  text += `**Type:** ${typeLabel}\n`;
  text += `**Enabled:** ${alert.enabled ? 'Yes' : 'No'}\n`;
  text += `**Description:** ${alert.description || '(none)'}\n`;
  text += `**Labels:** ${(alert.labels || []).join(', ') || '(none)'}\n\n`;

  text += `## Query\n\n\`\`\`\n${alert.queryString}\n\`\`\`\n\n`;

  text += `## Actions\n\n`;
  const actions = alert.actions || [];
  if (actions.length === 0) {
    text += `(no actions configured)\n\n`;
  } else {
    for (const action of actions) {
      text += `- ${action.name || action.id} (${action.__typename || 'Unknown'})\n`;
    }
    text += '\n';
  }

  text += `## Configuration\n\n`;

  if (alertType === 'filter') {
    text += `- **Throttle:** ${alert.throttleTimeSeconds || 0}s\n`;
    text += `- **Throttle Fields:** ${(alert.throttleFields || []).join(', ') || '(none)'}\n`;
  } else if (alertType === 'aggregate') {
    text += `- **Search Interval:** ${alert.searchIntervalSeconds}s\n`;
    text += `- **Throttle:** ${alert.throttleTimeSeconds || 0}s\n`;
    text += `- **Throttle Fields:** ${(alert.throttleFields || []).join(', ') || '(none)'}\n`;
    text += `- **Trigger Mode:** ${alert.triggerMode || 'N/A'}\n`;
    text += `- **Timestamp Type:** ${alert.queryTimestampType || 'N/A'}\n`;
  } else if (alertType === 'scheduled') {
    text += `- **Schedule:** ${alert.schedule}\n`;
    text += `- **Time Zone:** ${alert.timeZone || 'N/A'}\n`;
    text += `- **Search Interval:** ${alert.searchIntervalSeconds}s\n`;
    text += `- **Timestamp Type:** ${alert.queryTimestampType || 'N/A'}\n`;
    text += `- **Backfill Limit:** ${alert.backfillLimitV2 ?? 'N/A'}\n`;
    text += `- **Trigger on Empty:** ${alert.triggerOnEmptyResult ? 'Yes' : 'No'}\n`;
  }

  text += `\n## Status\n\n`;
  if (alertType === 'scheduled') {
    text += `- **Last Execution:** ${formatTimestampUtil(alert.timeOfLastExecution)}\n`;
    text += `- **Last Triggered:** ${formatTimestampUtil(alert.timeOfLastTrigger)}\n`;
  } else {
    text += `- **Last Triggered:** ${formatTimestampUtil(alert.lastTriggered)}\n`;
    if (alert.lastSuccessfulPoll) {
      text += `- **Last Successful Poll:** ${formatTimestampUtil(alert.lastSuccessfulPoll)}\n`;
    }
  }
  if (alert.lastError) {
    text += `- **Last Error:** ⚠️ ${alert.lastError}\n`;
  }

  return { content: [{ type: 'text', text }] };
}

async function handleCreateAlert(args) {
  const {
    type, name, query_string, actions, description, labels,
    enabled = true, repository, query_ownership_type = 'Organization',
    // Filter-specific
    throttle_seconds, throttle_fields,
    // Aggregate-specific
    search_interval_seconds, query_timestamp_type = 'IngestTimestamp',
    trigger_mode = 'CompleteMode',
    // Scheduled-specific
    max_wait_seconds, schedule, time_zone = 'UTC', backfill_limit, trigger_on_empty = false,
  } = args;

  const repo = validateRepoName(repository || REPOSITORY);

  if (!type || !name || !query_string || !actions || actions.length === 0) {
    throw new Error('type, name, query_string, and actions are required');
  }

  // Resolve action names to IDs/names
  const resolvedActions = await resolveActionIds(repo, actions);

  let mutation, variables, resultPath;

  if (type === 'filter') {
    mutation = `
      mutation CreateFilterAlert($input: CreateFilterAlert!) {
        createFilterAlert(input: $input) {
          id name enabled
        }
      }
    `;
    variables = {
      input: {
        viewName: repo,
        name,
        queryString: query_string,
        actionIdsOrNames: resolvedActions,
        queryOwnershipType: query_ownership_type,
        enabled,
        ...(description !== undefined && { description }),
        ...(labels && { labels }),
        ...(throttle_seconds !== undefined && { throttleTimeSeconds: throttle_seconds }),
        ...(throttle_fields && { throttleFields: throttle_fields }),
      },
    };
    resultPath = 'createFilterAlert';

  } else if (type === 'aggregate') {
    if (!search_interval_seconds) {
      throw new Error('search_interval_seconds is required for aggregate alerts');
    }
    mutation = `
      mutation CreateAggregateAlert($input: CreateAggregateAlert!) {
        createAggregateAlert(input: $input) {
          id name enabled
        }
      }
    `;
    variables = {
      input: {
        viewName: repo,
        name,
        queryString: query_string,
        actionIdsOrNames: resolvedActions,
        queryOwnershipType: query_ownership_type,
        searchIntervalSeconds: search_interval_seconds,
        throttleTimeSeconds: throttle_seconds !== undefined ? throttle_seconds : 60,
        queryTimestampType: query_timestamp_type,
        enabled,
        ...(description !== undefined && { description }),
        ...(labels && { labels }),
        ...(throttle_fields && { throttleFields: throttle_fields }),
        ...(trigger_mode && { triggerMode: trigger_mode }),
      },
    };
    resultPath = 'createAggregateAlert';

  } else if (type === 'scheduled') {
    if (!schedule) {
      throw new Error('schedule (cron expression) is required for scheduled searches');
    }
    if (!search_interval_seconds) {
      throw new Error('search_interval_seconds is required for scheduled searches');
    }
    mutation = `
      mutation CreateScheduledSearch($input: CreateScheduledSearchV2!) {
        createScheduledSearchV2(input: $input) {
          id name enabled
        }
      }
    `;
    variables = {
      input: {
        viewName: repo,
        name,
        queryString: query_string,
        actionIdsOrNames: resolvedActions,
        queryOwnershipType: query_ownership_type,
        queryTimestampType: query_timestamp_type,
        schedule,
        timeZone: time_zone,
        searchIntervalSeconds: search_interval_seconds,
        enabled,
        ...(description !== undefined && { description }),
        ...(labels && { labels }),
        ...(max_wait_seconds !== undefined && { maxWaitTimeSeconds: max_wait_seconds }),
        // Default maxWaitTimeSeconds when using IngestTimestamp
        ...(max_wait_seconds === undefined && query_timestamp_type === 'IngestTimestamp' && { maxWaitTimeSeconds: 60 }),
        ...(backfill_limit !== undefined && { backfillLimit: backfill_limit }),
        ...(trigger_on_empty !== undefined && { triggerOnEmptyResult: trigger_on_empty }),
      },
    };
    resultPath = 'createScheduledSearchV2';

  } else {
    throw new Error(`Unknown alert type: ${type}. Use filter, aggregate, or scheduled.`);
  }

  const data = await executeGraphQL(mutation, variables);
  const created = data[resultPath];

  const typeLabel = ALERT_TYPE_LABELS[type];

  return {
    content: [{
      type: 'text',
      text: `✅ ${typeLabel} "${name}" created successfully!\n\n**ID:** ${created.id}\n**Repository:** ${repo}\n**Enabled:** ${created.enabled}\n**Actions:** ${resolvedActions.join(', ')}`,
    }],
  };
}

async function handleUpdateAlert(args) {
  const {
    alert_id, name, type, repository,
    new_name, query_string, description, actions, labels, enabled,
    query_ownership_type, throttle_seconds, throttle_fields,
    search_interval_seconds, query_timestamp_type, trigger_mode,
    max_wait_seconds, schedule, time_zone, backfill_limit, trigger_on_empty,
  } = args || {};

  const repo = validateRepoName(repository || REPOSITORY);

  if (!alert_id && !name) {
    throw new Error('Either alert_id or name is required');
  }

  const resolved = await resolveAlertId(repo, alert_id || name, type);
  if (!resolved) {
    throw new Error(`Alert "${alert_id || name}" not found in ${repo}`);
  }

  const { id, type: alertType, alert: existing } = resolved;

  // Resolve action IDs if provided
  let resolvedActions;
  if (actions) {
    resolvedActions = await resolveActionIds(repo, actions);
  }

  let mutation, variables, resultPath;

  if (alertType === 'filter') {
    // Get existing action names for required fields
    const existingActions = (existing.actions || []).map(a => a.name || a.id);
    mutation = `
      mutation UpdateFilterAlert($input: UpdateFilterAlertV2!) {
        updateFilterAlertV2(input: $input) {
          id name enabled
        }
      }
    `;
    // The V2 update is full-replace: omitted optional fields are reset, so
    // every field falls back to the alert's current value.
    variables = {
      input: {
        viewName: repo,
        id,
        name: new_name || existing.name,
        queryString: query_string || existing.queryString,
        actionIdsOrNames: resolvedActions || existingActions,
        queryOwnershipType: query_ownership_type || existingOwnershipType(existing),
        enabled: enabled !== undefined ? enabled : existing.enabled,
        labels: labels || existing.labels || [],
        throttleFields: throttle_fields || existing.throttleFields || [],
        description: description !== undefined ? description : (existing.description || ''),
        throttleTimeSeconds: throttle_seconds !== undefined ? throttle_seconds : (existing.throttleTimeSeconds ?? 0),
      },
    };
    resultPath = 'updateFilterAlertV2';

  } else if (alertType === 'aggregate') {
    const existingActions = (existing.actions || []).map(a => a.name || a.id);
    mutation = `
      mutation UpdateAggregateAlert($input: UpdateAggregateAlertV2!) {
        updateAggregateAlertV2(input: $input) {
          id name enabled
        }
      }
    `;
    variables = {
      input: {
        viewName: repo,
        id,
        name: new_name || existing.name,
        queryString: query_string || existing.queryString,
        actionIdsOrNames: resolvedActions || existingActions,
        queryOwnershipType: query_ownership_type || existingOwnershipType(existing),
        searchIntervalSeconds: search_interval_seconds !== undefined ? search_interval_seconds : existing.searchIntervalSeconds,
        throttleTimeSeconds: throttle_seconds !== undefined ? throttle_seconds : (existing.throttleTimeSeconds ?? 60),
        queryTimestampType: query_timestamp_type || existing.queryTimestampType || 'IngestTimestamp',
        triggerMode: trigger_mode || existing.triggerMode || 'CompleteMode',
        enabled: enabled !== undefined ? enabled : existing.enabled,
        labels: labels || existing.labels || [],
        throttleFields: throttle_fields || existing.throttleFields || [],
        description: description !== undefined ? description : (existing.description || ''),
      },
    };
    resultPath = 'updateAggregateAlertV2';

  } else if (alertType === 'scheduled') {
    const existingActions = (existing.actions || []).map(a => a.name || a.id);
    mutation = `
      mutation UpdateScheduledSearch($input: UpdateScheduledSearchV3!) {
        updateScheduledSearchV3(input: $input) {
          id name enabled
        }
      }
    `;
    const maxWait = max_wait_seconds !== undefined ? max_wait_seconds : existing.maxWaitTimeSeconds;
    const backfill = backfill_limit !== undefined ? backfill_limit : existing.backfillLimitV2;
    variables = {
      input: {
        viewName: repo,
        id,
        name: new_name || existing.name,
        queryString: query_string || existing.queryString,
        actionIdsOrNames: resolvedActions || existingActions,
        queryOwnershipType: query_ownership_type || existingOwnershipType(existing),
        queryTimestampType: query_timestamp_type || existing.queryTimestampType || 'IngestTimestamp',
        schedule: schedule || existing.schedule,
        timeZone: time_zone || existing.timeZone || 'UTC',
        searchIntervalSeconds: search_interval_seconds !== undefined ? search_interval_seconds : existing.searchIntervalSeconds,
        enabled: enabled !== undefined ? enabled : existing.enabled,
        triggerOnEmptyResult: trigger_on_empty !== undefined ? trigger_on_empty : (existing.triggerOnEmptyResult || false),
        labels: labels || existing.labels || [],
        description: description !== undefined ? description : (existing.description || ''),
        ...(maxWait !== undefined && maxWait !== null && { maxWaitTimeSeconds: maxWait }),
        ...(backfill !== undefined && backfill !== null && { backfillLimit: backfill }),
      },
    };
    resultPath = 'updateScheduledSearchV3';

  } else {
    throw new Error(`Unknown alert type: ${alertType}`);
  }

  const data = await executeGraphQL(mutation, variables);
  const updated = data[resultPath];

  const typeLabel = ALERT_TYPE_LABELS[alertType];

  return {
    content: [{
      type: 'text',
      text: `✅ ${typeLabel} "${updated.name}" updated successfully!\n\n**ID:** ${updated.id}\n**Enabled:** ${updated.enabled}`,
    }],
  };
}

async function handleDeleteAlert(args) {
  const { alert_id, name, type, repository, confirm } = args || {};
  const repo = validateRepoName(repository || REPOSITORY);

  if (!confirm) {
    throw new Error('Set confirm: true to delete this alert');
  }

  if (!alert_id && !name) {
    throw new Error('Either alert_id or name is required');
  }

  const resolved = await resolveAlertId(repo, alert_id || name, type);
  if (!resolved) {
    throw new Error(`Alert "${alert_id || name}" not found in ${repo}`);
  }

  const { id, type: alertType, alert } = resolved;

  let mutation;

  if (alertType === 'filter') {
    mutation = `
      mutation DeleteFilterAlert($input: DeleteFilterAlert!) {
        deleteFilterAlertV2(input: $input)
      }
    `;
  } else if (alertType === 'aggregate') {
    mutation = `
      mutation DeleteAggregateAlert($input: DeleteAggregateAlert!) {
        deleteAggregateAlertV2(input: $input)
      }
    `;
  } else if (alertType === 'scheduled') {
    mutation = `
      mutation DeleteScheduledSearch($input: DeleteScheduledSearchV2!) {
        deleteScheduledSearchV2(input: $input)
      }
    `;
  }

  await executeGraphQL(mutation, {
    input: { viewName: repo, id },
  });

  const typeLabel = ALERT_TYPE_LABELS[alertType];

  return {
    content: [{ type: 'text', text: `✅ ${typeLabel} "${alert.name}" (${id}) deleted successfully from ${repo}.` }],
  };
}

async function handleToggleAlert(args) {
  const { alert_id, name, type, enabled, repository } = args || {};
  const repo = validateRepoName(repository || REPOSITORY);

  if (enabled === undefined) {
    throw new Error('enabled is required (true or false)');
  }

  if (!alert_id && !name) {
    throw new Error('Either alert_id or name is required');
  }

  const resolved = await resolveAlertId(repo, alert_id || name, type);
  if (!resolved) {
    throw new Error(`Alert "${alert_id || name}" not found in ${repo}`);
  }

  const { id, type: alertType, alert } = resolved;
  const action = enabled ? 'enable' : 'disable';

  let mutation;

  if (alertType === 'filter') {
    mutation = enabled
      ? `mutation EnableFilterAlert($input: EnableFilterAlert!) { enableFilterAlertV2(input: $input) { id name enabled } }`
      : `mutation DisableFilterAlert($input: DisableFilterAlert!) { disableFilterAlertV2(input: $input) { id name enabled } }`;
  } else if (alertType === 'aggregate') {
    mutation = enabled
      ? `mutation EnableAggregateAlert($input: EnableAggregateAlert!) { enableAggregateAlertV2(input: $input) { id name enabled } }`
      : `mutation DisableAggregateAlert($input: DisableAggregateAlert!) { disableAggregateAlertV2(input: $input) { id name enabled } }`;
  } else if (alertType === 'scheduled') {
    mutation = enabled
      ? `mutation EnableScheduledSearch($input: EnableScheduledSearch!) { enableScheduledSearchV2(input: $input) { id name enabled } }`
      : `mutation DisableScheduledSearch($input: DisableScheduledSearch!) { disableScheduledSearchV2(input: $input) { id name enabled } }`;
  }

  await executeGraphQL(mutation, {
    input: { viewName: repo, id },
  });

  const typeLabel = ALERT_TYPE_LABELS[alertType];

  return {
    content: [{ type: 'text', text: `✅ ${typeLabel} "${alert.name}" ${action}d successfully.` }],
  };
}

async function handleListActions(args) {
  const { repository } = args || {};
  const repo = validateRepoName(repository || REPOSITORY);

  const data = await executeGraphQL(`
    query ListActionsDetailed($repo: String!) {
      searchDomain(name: $repo) {
        ... on View { actions { id name __typename } }
        ... on Repository { actions { id name __typename } }
      }
    }
  `, { repo });

  const actions = data?.searchDomain?.actions || [];

  if (actions.length === 0) {
    return {
      content: [{ type: 'text', text: `No actions found in ${repo}. Create actions in the LogScale UI first.` }],
    };
  }

  let text = `# Actions in ${repo}\n\n`;
  text += `Found ${actions.length} action(s):\n\n`;
  text += `| Name | Type | ID |\n| --- | --- | --- |\n`;

  for (const a of actions) {
    const typeName = (a.__typename || 'Unknown').replace('Action', '');
    text += `| ${a.name} | ${typeName} | ${a.id} |\n`;
  }

  text += `\nUse action names or IDs when creating alerts with \`logscale_create_alert\`.`;

  return { content: [{ type: 'text', text }] };
}

async function handleCreateAction(args) {
  const {
    type, name, repository,
    url, channels, recipients, subject_template, body_template,
    method, headers, severity, routing_key, ingest_token,
  } = args || {};
  const repo = validateRepoName(repository || REPOSITORY);

  if (!type || !name) {
    throw new Error('type and name are required');
  }

  let mutation, variables;

  switch (type) {
    case 'SlackPostMessage':
      if (!channels || channels.length === 0) throw new Error('channels is required for SlackPostMessage');
      mutation = `
        mutation CreateSlackPostMessageAction($input: SlackPostMessageActionInput!) {
          createSlackPostMessageAction(input: $input) { id name }
        }
      `;
      variables = {
        input: {
          viewName: repo,
          name,
          apiToken: routing_key || '',
          channels,
          fields: [{ fieldName: 'Events', strategy: 'ALL' }],
          useProxy: false,
        },
      };
      break;

    case 'EmailAction':
      if (!recipients || recipients.length === 0) throw new Error('recipients is required for EmailAction');
      mutation = `
        mutation CreateEmailAction($input: CreateEmailAction!) {
          createEmailAction(input: $input) { id name }
        }
      `;
      variables = {
        input: {
          viewName: repo,
          name,
          recipients,
          subjectTemplate: subject_template || 'LogScale Alert: {alert_name}',
          bodyTemplate: body_template || '{events}',
        },
      };
      break;

    case 'WebhookAction':
      if (!url) throw new Error('url is required for WebhookAction');
      mutation = `
        mutation CreateWebhookAction($input: CreateWebhookAction!) {
          createWebhookAction(input: $input) { id name }
        }
      `;
      variables = {
        input: {
          viewName: repo,
          name,
          url,
          method: method || 'POST',
          headers: headers ? Object.entries(headers).map(([k, v]) => ({ header: k, value: v })) : [],
          bodyTemplate: body_template || '{events}',
        },
      };
      break;

    case 'PagerDutyAction':
      if (!routing_key) throw new Error('routing_key is required for PagerDutyAction');
      mutation = `
        mutation CreatePagerDutyAction($input: CreatePagerDutyAction!) {
          createPagerDutyAction(input: $input) { id name }
        }
      `;
      variables = {
        input: {
          viewName: repo,
          name,
          routingKey: routing_key,
          severity: severity || 'critical',
        },
      };
      break;

    case 'OpsGenieAction':
      if (!routing_key) throw new Error('routing_key (API key) is required for OpsGenieAction');
      mutation = `
        mutation CreateOpsGenieAction($input: CreateOpsGenieAction!) {
          createOpsGenieAction(input: $input) { id name }
        }
      `;
      variables = {
        input: {
          viewName: repo,
          name,
          apiUrl: url || 'https://api.opsgenie.com',
          genieKey: routing_key,
        },
      };
      break;

    case 'HumioRepoAction':
      if (!ingest_token) throw new Error('ingest_token is required for HumioRepoAction');
      mutation = `
        mutation CreateHumioRepoAction($input: CreateHumioRepoAction!) {
          createHumioRepoAction(input: $input) { id name }
        }
      `;
      variables = {
        input: {
          viewName: repo,
          name,
          ingestToken: ingest_token,
        },
      };
      break;

    default:
      throw new Error(`Unsupported action type: ${type}. Use SlackPostMessage, EmailAction, WebhookAction, PagerDutyAction, OpsGenieAction, or HumioRepoAction.`);
  }

  const data = await executeGraphQL(mutation, variables);
  const resultKey = Object.keys(data)[0];
  const created = data[resultKey];

  return {
    content: [{
      type: 'text',
      text: `✅ Action "${name}" (${type}) created successfully!\n\n**ID:** ${created.id}\n**Repository:** ${repo}`,
    }],
  };
}

async function handleDeleteAction(args) {
  const { action_id, name, repository, confirm } = args || {};
  const repo = validateRepoName(repository || REPOSITORY);

  if (!confirm) {
    throw new Error('Set confirm: true to delete this action');
  }

  if (!action_id && !name) {
    throw new Error('Either action_id or name is required');
  }

  // Resolve name to ID only when no ID was given — the type-agnostic
  // deleteActionV2 mutation removes any action kind by ID.
  let targetId = action_id;
  let targetName = name;
  if (!targetId) {
    const data = await executeGraphQL(`
      query ListActions($repo: String!) {
        searchDomain(name: $repo) {
          ... on View { actions { id name } }
          ... on Repository { actions { id name } }
        }
      }
    `, { repo });

    const allActions = data?.searchDomain?.actions || [];
    const target = allActions.find(a => a.name.toLowerCase() === name.toLowerCase());
    if (!target) {
      throw new Error(`Action "${name}" not found in ${repo}. Available actions: ${allActions.map(a => a.name).join(', ')}`);
    }
    targetId = target.id;
    targetName = target.name;
  }

  await executeGraphQL(`
    mutation DeleteAction($input: DeleteActionV2!) {
      deleteActionV2(input: $input)
    }
  `, { input: { viewName: repo, id: targetId } });

  return {
    content: [{ type: 'text', text: `✅ Action "${targetName || targetId}" (${targetId}) deleted successfully from ${repo}.` }],
  };
}

async function handleExportAlert(args) {
  const { alert_id, name, type, repository, save_to_file } = args || {};
  const repo = validateRepoName(repository || REPOSITORY);

  if (!alert_id && !name) {
    throw new Error('Either alert_id or name is required');
  }

  // Single fetch: pull id/name/yamlTemplate for the hinted type (or all types)
  // and match locally — avoids resolving and then re-downloading the full list.
  const typeFields = {
    filter: 'filterAlerts { id name yamlTemplate }',
    aggregate: 'aggregateAlerts { id name yamlTemplate }',
    scheduled: 'scheduledSearches { id name yamlTemplate }',
  };
  const selected = type ? typeFields[type] : Object.values(typeFields).join('\n');
  if (!selected) {
    throw new Error(`Unknown alert type: ${type}. Use filter, aggregate, or scheduled.`);
  }

  const data = await executeGraphQL(`
    query ExportAlert($repo: String!) {
      searchDomain(name: $repo) {
        ... on View { ${selected} }
        ... on Repository { ${selected} }
      }
    }
  `, { repo });

  const domain = data?.searchDomain || {};
  const candidates = [
    ...(domain.filterAlerts || []).map(a => ({ ...a, _type: 'filter' })),
    ...(domain.aggregateAlerts || []).map(a => ({ ...a, _type: 'aggregate' })),
    ...(domain.scheduledSearches || []).map(a => ({ ...a, _type: 'scheduled' })),
  ];
  const ref = alert_id || name;
  const alert = candidates.find(a => a.id === ref) || candidates.find(a => a.name === ref);

  if (!alert) {
    throw new Error(`Alert "${ref}" not found in ${repo}`);
  }
  if (!alert.yamlTemplate) {
    throw new Error(`Could not export YAML template for alert ${alert.id}`);
  }

  const yamlContent = alert.yamlTemplate;
  const typeLabel = ALERT_TYPE_LABELS[alert._type];

  if (save_to_file) {
    const outPath = safePath(DASHBOARD_YAML_DIR, save_to_file);
    await writeFile(outPath, yamlContent, 'utf8');
    return {
      content: [{ type: 'text', text: `✅ ${typeLabel} "${alert.name}" exported to ${outPath}` }],
    };
  }

  return {
    content: [{ type: 'text', text: `# Exported ${typeLabel}: ${alert.name}\n\n\`\`\`yaml\n${yamlContent}\n\`\`\`` }],
  };
}

// ============================================================================
// Lookup File Handlers
// ============================================================================

/**
 * List all lookup files in a LogScale repository.
 *
 * @param {object} args - Tool arguments.
 * @returns {Promise<object>} MCP tool response with file listing.
 */
async function handleListFiles(args) {
  const repo = validateRepoName(args?.repository || REPOSITORY);

  const data = await executeGraphQL(`
    query ListFiles($repo: String!) {
      searchDomain(name: $repo) {
        files {
          nameAndPath { name path }
          contentHash
          fileSizeBytes
        }
      }
    }
  `, { repo });

  const files = data?.searchDomain?.files || [];

  if (files.length === 0) {
    return {
      content: [{ type: 'text', text: `No lookup files found in repository **${repo}**.` }],
    };
  }

  let text = `# Lookup Files in ${repo}\n\nFound **${files.length}** file(s):\n\n`;
  text += `| # | File Name | Size |\n`;
  text += `| --- | --- | --- |\n`;

  for (let i = 0; i < files.length; i++) {
    const fileName = files[i].nameAndPath?.name || '(unknown)';
    const size = files[i].fileSizeBytes ? formatBytes(files[i].fileSizeBytes) : '-';
    text += `| ${i + 1} | ${fileName} | ${size} |\n`;
  }

  text += `\nUse \`logscale_get_file\` with the filename to view headers and content.`;

  return { content: [{ type: 'text', text }] };
}

/**
 * Retrieve headers and content of a lookup file from LogScale.
 *
 * Uses the REST API to download the raw CSV, then parses headers and rows.
 * Falls back gracefully if the file is empty or not found.
 *
 * @param {object} args - Tool arguments including filename, repository, filter, max_rows.
 * @returns {Promise<object>} MCP tool response with headers and sample rows.
 */
async function handleGetFile(args) {
  const { filename, filter, max_rows: maxRows = 10 } = args || {};
  const repo = validateRepoName(args?.repository || REPOSITORY);

  if (!filename) {
    throw new Error('filename is required');
  }

  const fileUrl = `${BASE_URL}/api/v1/repositories/${encodeURIComponent(repo)}/files/${encodeURIComponent(filename)}`;

  log('debug', `Downloading lookup file: ${fileUrl}`);

  const response = await restFetch(fileUrl, {
    headers: { 'Accept': 'text/csv, application/json, */*' },
    timeoutLabel: `Downloading file "${filename}" from ${repo}`,
  });

  if (!response.ok) {
    const errorText = sanitizeErrorText(await response.text());
    throw new Error(`Error downloading file "${filename}" from ${repo}: ${response.status} ${errorText}`);
  }

  const rawContent = await response.text();

  if (!rawContent || rawContent.trim().length === 0) {
    return {
      content: [{ type: 'text', text: `File "${filename}" in ${repo} is empty.` }],
    };
  }

  const lines = rawContent.split('\n').filter(line => line.trim().length > 0);

  if (lines.length === 0) {
    return {
      content: [{ type: 'text', text: `File "${filename}" in ${repo} has no content.` }],
    };
  }

  const headers = parseCSVLine(lines[0]);
  let dataLines = lines.slice(1);

  if (filter) {
    const lowerFilter = filter.toLowerCase();
    dataLines = dataLines.filter(line => line.toLowerCase().includes(lowerFilter));
  }

  const totalRows = dataLines.length;
  const limitedRows = dataLines.slice(0, Math.min(maxRows, 500));

  let text = `# Lookup File: ${filename}\n\n`;
  text += `**Repository:** ${repo}\n`;
  text += `**Columns (${headers.length}):** \`${headers.join('`, `')}\`\n`;
  text += `**Total rows:** ${totalRows}`;
  if (filter) {
    text += ` (filtered by "${filter}")`;
  }
  text += `\n**Showing:** ${limitedRows.length} row(s)\n\n`;

  text += `| ${headers.join(' | ')} |\n`;
  text += `| ${headers.map(() => '---').join(' | ')} |\n`;

  for (const line of limitedRows) {
    const values = parseCSVLine(line);
    const paddedValues = headers.map((_, i) => (values[i] || '').replace(/\|/g, '\\|'));
    text += `| ${paddedValues.join(' | ')} |\n`;
  }

  return { content: [{ type: 'text', text }] };
}

async function handleUploadFile(args) {
  const { filename, content, local_path } = args || {};
  const repo = validateRepoName(args?.repository || REPOSITORY);

  if (!filename) {
    throw new Error('filename is required');
  }

  let csvContent;
  if (content) {
    csvContent = content;
  } else if (local_path) {
    const resolvedPath = safePath(DASHBOARD_YAML_DIR, local_path);
    csvContent = await readFile(resolvedPath, 'utf8');
  } else {
    throw new Error('Either content or local_path is required');
  }

  const fileUrl = `${BASE_URL}/api/v1/repositories/${encodeURIComponent(repo)}/files/${encodeURIComponent(filename)}`;

  log('debug', `Uploading lookup file: ${fileUrl}`);

  // File upload is a full-content PUT, so retrying after a timeout is idempotent
  await withRetry(async () => {
    const response = await restFetch(fileUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/csv' },
      body: csvContent,
      timeoutLabel: `Uploading file "${filename}" to ${repo}`,
    });

    if (!response.ok) {
      throw httpError(`Error uploading file "${filename}" to ${repo}`, response.status, sanitizeErrorText(await response.text()));
    }

    return response;
  }, 'UploadFile');

  const lines = csvContent.split('\n').filter(l => l.trim().length > 0);
  const rowCount = Math.max(0, lines.length - 1);

  return {
    content: [{
      type: 'text',
      text: `✅ Lookup file "${filename}" uploaded to ${repo}\n\n**Size:** ${formatBytes(csvContent.length)}\n**Rows:** ${rowCount} (excluding header)`,
    }],
  };
}

// ============================================================================
// Discovery Handlers
// ============================================================================

async function handleListRepos(args) {
  const data = await executeGraphQL(`{
    searchDomains {
      __typename
      name
      description
      ... on Repository {
        compressedByteSize
        uncompressedByteSize
      }
    }
  }`);

  const domains = data?.searchDomains || [];

  if (domains.length === 0) {
    return {
      content: [{ type: 'text', text: 'No repositories or views found.' }],
    };
  }

  let text = `# LogScale Repositories & Views\n\nFound ${domains.length} search domain(s):\n\n`;
  text += `| Name | Type | Description | Compressed Size | Uncompressed Size |\n`;
  text += `| --- | --- | --- | --- | --- |\n`;

  for (const d of domains) {
    const type = d.__typename === 'View' ? 'View' : 'Repository';
    const desc = d.description || '-';
    const compressed = d.compressedByteSize ? formatBytes(d.compressedByteSize) : '-';
    const uncompressed = d.uncompressedByteSize ? formatBytes(d.uncompressedByteSize) : '-';
    text += `| ${d.name} | ${type} | ${desc} | ${compressed} | ${uncompressed} |\n`;
  }

  text += `\n> To query a **View**, pass its name in the \`repository\` parameter of logscale_query/logscale_search. `;
  text += `Inside CQL, \`#repo=\` matches raw repository names only — \`#view=\` is not a valid tag and silently matches nothing.\n`;

  return { content: [{ type: 'text', text }] };
}

async function handleStatus(args) {
  let text = `# LogScale MCP Server Status\n\n`;
  text += `**Version:** ${VERSION}\n`;
  text += `**Base URL:** ${BASE_URL}\n`;
  text += `**Default Repository:** ${REPOSITORY}\n`;
  text += `**API Token:** ${API_TOKEN ? '✅ Set' : '❌ Not set'}\n`;
  text += `**User API Token:** ${USER_API_TOKEN ? '✅ Set' : '❌ Not set'}\n\n`;

  // Test REST API connectivity (lightweight check using status endpoint)
  try {
    const resp = await restFetch(`${BASE_URL}/api/v1/status`, {
      timeoutLabel: 'REST API status check',
    });
    text += `**REST API connectivity:** ${resp.ok ? '✅ OK' : `❌ ${resp.status}`}\n`;
  } catch (e) {
    text += `**REST API connectivity:** ❌ ${e.message}\n`;
  }

  // Test GraphQL API connectivity
  try {
    await executeGraphQL(`{ currentUser { id username } }`);
    text += `**GraphQL API connectivity:** ✅ OK\n`;
  } catch (e) {
    text += `**GraphQL API connectivity:** ❌ ${e.message}\n`;
  }

  return { content: [{ type: 'text', text }] };
}

// ============================================================================
// Documentation Handlers
// ============================================================================

async function handleDocsSync(args) {
  const { category = 'all', refresh = false, format = 'both' } = args || {};
  const normalizedFormat = normalizeDocFormat(format);

  // Determine which sources to sync based on category
  let sourcesToSync = [];
  if (category === 'cql') {
    sourcesToSync = CQL_DOCS_SOURCES;
    await mkdir(CQL_DOCS_DIR, { recursive: true });
  } else if (category === 'dashboard') {
    sourcesToSync = DASHBOARD_DOCS_SOURCES;
    await mkdir(DASHBOARD_DOCS_DIR, { recursive: true });
  } else {
    sourcesToSync = DOCS_SOURCES;
    await mkdir(CQL_DOCS_DIR, { recursive: true });
    await mkdir(DASHBOARD_DOCS_DIR, { recursive: true });
  }

  // Any per-source failure (timeout, network, HTTP error) is recorded and the
  // rest of the sync continues; sources download in parallel.
  const syncSource = async (source) => {
    const targetDir = source.category === 'cql' ? CQL_DOCS_DIR : DASHBOARD_DOCS_DIR;
    const filePath = join(targetDir, source.filename);
    const markdownPath = join(targetDir, source.filename.replace(/\.html$/i, '.md'));
    const htmlCached = await fileExists(filePath);
    const markdownCached = await fileExists(markdownPath);
    const shouldSkip = !refresh
      && ((normalizedFormat === 'html' && htmlCached)
        || (normalizedFormat === 'markdown' && markdownCached)
        || (normalizedFormat === 'both' && htmlCached && markdownCached));

    if (shouldSkip) {
      return { ...source, status: 'cached', path: filePath };
    }

    log('info', `📥 Downloading ${source.title}...`);
    try {
      // token: null — these are external documentation sites; never send credentials
      const response = await restFetch(source.url, {
        headers: { 'User-Agent': 'logscale-mcp-server' },
        token: null,
        timeoutLabel: `Downloading ${source.url}`,
      });

      if (!response.ok) {
        log('warn', `⚠️ Failed to download ${source.url}: ${response.status}`);
        return { ...source, status: 'failed', error: response.status };
      }

      const body = await response.text();
      if (normalizedFormat !== 'markdown') {
        await writeFile(filePath, body, 'utf8');
      }
      if (normalizedFormat !== 'html') {
        const markdown = htmlToMarkdown(body);
        await writeFile(markdownPath, markdown, 'utf8');
      }
      return { ...source, status: 'downloaded', path: filePath };
    } catch (err) {
      log('warn', `⚠️ Failed to download ${source.url}: ${err.message}`);
      return { ...source, status: 'failed', error: err.message };
    }
  };

  const results = await Promise.all(sourcesToSync.map(syncSource));

  const successCount = results.filter(r => r.status === 'downloaded' || r.status === 'cached').length;
  const summary = results
    .map((entry) => `- [${entry.category}] ${entry.title}: ${entry.status}`)
    .join('\n');

  return {
    content: [
      {
        type: 'text',
        text: `Documentation sync complete (${category}).\n\nProcessed ${results.length} documents (${successCount} successful).\n\n${summary}`,
      },
    ],
  };
}

async function handleDocs(args) {
  const { category = 'all', include_content = false, max_chars = 20000 } = args || {};
  const limit = normalizeMaxChars(max_chars);

  const dirsToRead = category === 'cql' ? [CQL_DOCS_DIR]
    : category === 'dashboard' ? [DASHBOARD_DOCS_DIR]
    : [CQL_DOCS_DIR, DASHBOARD_DOCS_DIR];

  const entries = [];
  for (const dir of dirsToRead) {
    const files = await safeReadDir(dir);
    const dirName = dir.includes('cql') ? 'cql' : 'dashboard';

    for (const file of files) {
      const filePath = join(dir, file);
      const details = await stat(filePath);
      const entry = { path: filePath, size: details.size, category: dirName };

      if (include_content) {
        const raw = await readFile(filePath, 'utf8');
        entry.content = raw.slice(0, limit);
        if (raw.length > limit) {
          entry.truncated = true;
        }
      }

      entries.push(entry);
    }
  }

  if (entries.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: `No ${category} docs cached yet. Run logscale_docs_sync to download.`,
        },
      ],
    };
  }

  const resultText = entries
    .map((entry) => {
      let block = `- [${entry.category}] ${entry.path} (${entry.size} bytes)`;
      if (entry.content) {
        block += `\n\n${entry.content}`;
        if (entry.truncated) {
          block += `\n\n[content truncated to ${limit} chars]`;
        }
      }
      return block;
    })
    .join('\n\n');

  return {
    content: [
      {
        type: 'text',
        text: resultText,
      },
    ],
  };
}

async function handleDocsText(args) {
  const { category = 'all', doc_name: docName, max_chars = 20000 } = args || {};
  const limit = normalizeMaxChars(max_chars);

  let sourcesToRead = category === 'cql' ? CQL_DOCS_SOURCES
    : category === 'dashboard' ? DASHBOARD_DOCS_SOURCES
    : DOCS_SOURCES;

  if (docName) {
    sourcesToRead = sourcesToRead.filter(s => s.name === docName);
    if (sourcesToRead.length === 0) {
      throw new Error(`Unknown doc_name: ${docName}`);
    }
  }

  const entries = [];
  for (const source of sourcesToRead) {
    const targetDir = source.category === 'cql' ? CQL_DOCS_DIR : DASHBOARD_DOCS_DIR;
    const filePath = join(targetDir, source.filename);
    const markdownPath = join(targetDir, source.filename.replace(/\.html$/i, '.md'));
    const htmlExists = await fileExists(filePath);
    const markdownExists = await fileExists(markdownPath);

    if (!htmlExists && !markdownExists) {
      entries.push({
        title: source.title,
        category: source.category,
        status: 'missing',
        message: 'Run logscale_docs_sync to download.',
      });
      continue;
    }

    const raw = await readFile(htmlExists ? filePath : markdownPath, 'utf8');
    const text = (htmlExists ? htmlToText(raw) : raw).slice(0, limit);
    entries.push({
      title: source.title,
      category: source.category,
      status: 'ready',
      content: text,
      truncated: text.length >= limit,
    });
  }

  const resultText = entries
    .map((entry) => {
      if (entry.status !== 'ready') {
        return `# [${entry.category}] ${entry.title}\n\n${entry.message}`;
      }
      let block = `# [${entry.category}] ${entry.title}\n\n${entry.content}`;
      if (entry.truncated) {
        block += `\n\n[content truncated to ${limit} chars]`;
      }
      return block;
    })
    .join('\n\n---\n\n');

  return {
    content: [
      {
        type: 'text',
        text: resultText,
      },
    ],
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/** Active Streamable HTTP sessions (session id → transport). */
const streamableTransports = Object.create(null);

async function runStreamableHttpServer() {
  const host = process.env.MCP_HTTP_HOST || '127.0.0.1';
  const port = Number.parseInt(process.env.MCP_HTTP_PORT || process.env.MCP_PORT || '3333', 10);
  let basePath = (process.env.MCP_HTTP_PATH || '/mcp').trim();
  if (!basePath.startsWith('/')) {
    basePath = `/${basePath}`;
  }
  basePath = basePath.replace(/\/+$/, '') || '/mcp';
  const bearerToken = process.env.MCP_HTTP_TOKEN?.trim();

  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ type: 'application/json', limit: '4mb' }));

  function requireHttpToken(req, res, next) {
    if (!bearerToken) {
      next();
      return;
    }
    const authz = req.headers.authorization;
    if (authz !== `Bearer ${bearerToken}`) {
      res.status(401).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Unauthorized' },
        id: null,
      });
      return;
    }
    next();
  }

  app.get('/health', (_req, res) => {
    res.json({ ok: true, name: 'logscale-mcp-server', version: VERSION, transport: 'streamable-http' });
  });

  const mcpPostHandler = async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    try {
      let transport;
      if (sessionId && streamableTransports[sessionId]) {
        transport = streamableTransports[sessionId];
      } else if (!sessionId && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            streamableTransports[sid] = transport;
          },
        });
        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid && streamableTransports[sid]) {
            delete streamableTransports[sid];
          }
        };
        const mcp = createLogscaleMcpServer();
        await mcp.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      } else {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bad Request: expected initialize request or valid Mcp-Session-Id',
          },
          id: null,
        });
        return;
      }
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      log('error', `MCP HTTP POST error: ${error.message}`);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  };

  const mcpGetHandler = async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    if (!sessionId || !streamableTransports[sessionId]) {
      res.status(400).send('Invalid or missing Mcp-Session-Id');
      return;
    }
    const transport = streamableTransports[sessionId];
    await transport.handleRequest(req, res);
  };

  const mcpDeleteHandler = async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    if (!sessionId || !streamableTransports[sessionId]) {
      res.status(400).send('Invalid or missing Mcp-Session-Id');
      return;
    }
    try {
      const transport = streamableTransports[sessionId];
      await transport.handleRequest(req, res);
    } catch (error) {
      log('error', `MCP HTTP DELETE error: ${error.message}`);
      if (!res.headersSent) {
        res.status(500).send('Error processing session termination');
      }
    }
  };

  app.post(basePath, requireHttpToken, mcpPostHandler);
  app.get(basePath, requireHttpToken, mcpGetHandler);
  app.delete(basePath, requireHttpToken, mcpDeleteHandler);

  const server = app.listen(port, host, () => {
    const displayUrl = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}${basePath}`;
    log('info', `🚀 LogScale MCP Server v${VERSION} — Streamable HTTP at ${displayUrl} (27 tools)`);
    if (bearerToken) {
      log('info', '🔐 MCP_HTTP_TOKEN is set; clients must send Authorization: Bearer <token>');
    } else {
      log('warn', '⚠️  No MCP_HTTP_TOKEN: HTTP endpoint is open to local connections; set MCP_HTTP_TOKEN for a shared secret');
    }
  });

  const shutdown = async (signal) => {
    log('info', `${signal} received, closing HTTP and MCP sessions...`);
    for (const sid of Object.keys(streamableTransports)) {
      try {
        await streamableTransports[sid].close();
      } catch (e) {
        log('warn', `Error closing session ${sid}: ${e.message}`);
      }
      delete streamableTransports[sid];
    }
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

async function main() {
  const mode = (process.env.MCP_TRANSPORT || 'stdio').toLowerCase();
  if (mode === 'http' || mode === 'streamable-http') {
    await runStreamableHttpServer();
    return;
  }
  if (mode !== 'stdio') {
    log('error', `Unknown MCP_TRANSPORT "${mode}". Use "stdio" (default) or "http".`);
    process.exit(1);
  }

  const mcp = createLogscaleMcpServer();
  const transport = new StdioServerTransport();
  log('info', `🚀 LogScale MCP Server v${VERSION} ready (stdio, 27 tools)`);
  await mcp.connect(transport);
}

main().catch((error) => {
  log('error', `💥 Server error: ${error.message}`);
  process.exit(1);
});
