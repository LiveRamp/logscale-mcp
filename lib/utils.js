import { resolve } from 'path';
import { readdir, stat } from 'fs/promises';

const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
let currentLogLevel = 'info';

export function setLogLevel(level) {
  currentLogLevel = (level || 'info').toLowerCase();
}

export function log(level, message) {
  const current = LOG_LEVELS[currentLogLevel] ?? LOG_LEVELS.info;
  const desired = LOG_LEVELS[level] ?? LOG_LEVELS.info;
  if (desired <= current) {
    console.error(message);
  }
}

export function parseTimeInput(value, now, allowEmpty) {
  if (!value) {
    if (allowEmpty) {
      return now;
    }
    throw new Error('start_time is required');
  }

  if (typeof value !== 'string') {
    throw new Error('Time values must be strings');
  }

  if (value.match(/^\d+[smhd]$/)) {
    const amount = Number.parseInt(value.slice(0, -1), 10);
    const unit = value.slice(-1);
    const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
    return now - amount * multipliers[unit];
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid time format: ${value}`);
  }

  return parsed;
}

export function normalizeMaxEvents(maxEvents) {
  const parsed = Number.parseInt(String(maxEvents), 10);
  if (Number.isNaN(parsed) || parsed < 1 || parsed > 1000) {
    throw new Error('max_events must be a number between 1 and 1000');
  }
  return parsed;
}

export function normalizeMaxChars(maxChars) {
  const parsed = Number.parseInt(String(maxChars), 10);
  if (Number.isNaN(parsed) || parsed < 1000 || parsed > 200000) {
    throw new Error('max_chars must be a number between 1000 and 200000');
  }
  return parsed;
}

export function normalizeDocFormat(format) {
  if (!format || typeof format !== 'string') {
    return 'both';
  }
  const normalized = format.trim().toLowerCase();
  if (!['html', 'markdown', 'both'].includes(normalized)) {
    throw new Error('format must be html, markdown, or both');
  }
  return normalized;
}

export function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export function formatTimestamp(ts) {
  if (!ts) return 'Never';
  let date;
  if (typeof ts === 'number') {
    date = new Date(ts);
  } else if (/^\d+$/.test(String(ts).trim())) {
    // Numeric string: epoch milliseconds
    date = new Date(Number.parseInt(ts, 10));
  } else {
    // Anything else (e.g. ISO 8601): let Date parse it
    date = new Date(ts);
  }
  return isNaN(date.getTime()) ? String(ts) : date.toISOString();
}

export function validateRepoName(name) {
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('Repository name is required');
  }
  if (!/^[a-zA-Z0-9_.\-]+$/.test(name)) {
    throw new Error(`Invalid repository name: "${name}". Only letters, numbers, hyphens, underscores, and dots are allowed.`);
  }
  return name;
}

export function safePath(baseDir, userPath) {
  const normalizedBase = baseDir.endsWith('/') ? baseDir : baseDir + '/';
  const resolved = userPath.startsWith('/') ? resolve(userPath) : resolve(baseDir, userPath);
  if (resolved !== baseDir && !resolved.startsWith(normalizedBase)) {
    throw new Error(`Path "${userPath}" resolves outside the allowed directory`);
  }
  return resolved;
}

export function decodeHtmlEntities(text) {
  // &amp; must be decoded last so escaped entities like &amp;lt; don't
  // get double-decoded into <
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, '\'')
    .replace(/&amp;/gi, '&');
}

export function stripTags(value) {
  return value.replace(/<[^>]+>/g, ' ');
}

export function htmlToText(html) {
  if (!html) return '';
  const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  const withoutStyles = withoutScripts.replace(/<style[\s\S]*?<\/style>/gi, '');
  const withBreaks = withoutStyles
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/h\d>/gi, '\n\n');
  const withoutTags = withBreaks.replace(/<[^>]+>/g, ' ');
  const decoded = decodeHtmlEntities(withoutTags);
  return decoded
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function htmlToMarkdown(html) {
  let content = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  content = content.replace(/<style[\s\S]*?<\/style>/gi, '');
  content = content.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, text) => {
    const prefix = '#'.repeat(Number.parseInt(level, 10));
    return `\n\n${prefix} ${stripTags(text).trim()}\n\n`;
  });
  content = content.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, text) => {
    const clean = decodeHtmlEntities(stripTags(text));
    return `\n\n\`\`\`\n${clean.trim()}\n\`\`\`\n\n`;
  });
  content = content.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, text) => {
    const clean = decodeHtmlEntities(stripTags(text));
    return `\`${clean.trim()}\``;
  });
  content = content.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**');
  content = content.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*');
  content = content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, text) => {
    return `- ${stripTags(text).trim()}\n`;
  });
  content = content.replace(/<\/p>/gi, '\n\n').replace(/<br\s*\/?>/gi, '\n');
  content = stripTags(content);
  content = decodeHtmlEntities(content);
  return content
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

// #view= is not a valid CQL tag — LogScale treats it as a filter on a nonexistent
// tag and silently matches zero events, so catch it before the API does nothing.
export function assertNoViewTag(query) {
  if (/#view\s*=/i.test(query)) {
    throw new Error(
      '#view is not a valid CQL tag — queries containing it silently match 0 events. '
      + 'To query a view (e.g. SOC, detections), pass the view name in the `repository` parameter. '
      + 'Inside CQL, use #repo=<raw_repo_name> to narrow results to one repository — view names never match #repo=.'
    );
  }
}

export function validateJobId(jobId) {
  if (!jobId || typeof jobId !== 'string' || jobId.trim().length === 0) {
    throw new Error('job_id is required');
  }
  if (!/^[a-zA-Z0-9_\-]+$/.test(jobId)) {
    throw new Error(`Invalid job_id format: "${jobId}". Only letters, numbers, hyphens, and underscores are allowed.`);
  }
  return jobId;
}

export function sanitizeErrorText(text, maxLength = 500) {
  if (!text || typeof text !== 'string') return '';
  return text.slice(0, maxLength).replace(/[\r\n]+/g, ' ').trim();
}

export async function fileExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

export async function safeReadDir(path) {
  try {
    return await readdir(path);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}
