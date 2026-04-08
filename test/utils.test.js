import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTimeInput,
  normalizeMaxEvents,
  normalizeMaxChars,
  normalizeDocFormat,
  formatBytes,
  formatTimestamp,
  htmlToText,
  htmlToMarkdown,
  validateRepoName,
  validateJobId,
  sanitizeErrorText,
  decodeHtmlEntities,
  stripTags,
  safePath,
  parseCSVLine,
} from '../lib/utils.js';

// ============================================================================
// parseTimeInput
// ============================================================================
describe('parseTimeInput', () => {
  const now = 1700000000000;

  it('parses relative seconds', () => {
    assert.equal(parseTimeInput('30s', now), now - 30000);
  });

  it('parses relative minutes', () => {
    assert.equal(parseTimeInput('5m', now), now - 300000);
  });

  it('parses relative hours', () => {
    assert.equal(parseTimeInput('1h', now), now - 3600000);
    assert.equal(parseTimeInput('24h', now), now - 86400000);
  });

  it('parses relative days', () => {
    assert.equal(parseTimeInput('7d', now), now - 604800000);
  });

  it('parses ISO date strings', () => {
    const result = parseTimeInput('2025-01-01T00:00:00Z', now);
    assert.equal(result, Date.parse('2025-01-01T00:00:00Z'));
  });

  it('throws on missing value when not allowEmpty', () => {
    assert.throws(() => parseTimeInput(null, now, false), /start_time is required/);
    assert.throws(() => parseTimeInput('', now, false), /start_time is required/);
    assert.throws(() => parseTimeInput(undefined, now), /start_time is required/);
  });

  it('returns now when allowEmpty and no value', () => {
    assert.equal(parseTimeInput(null, now, true), now);
    assert.equal(parseTimeInput('', now, true), now);
  });

  it('throws on non-string values', () => {
    assert.throws(() => parseTimeInput(12345, now), /Time values must be strings/);
  });

  it('throws on invalid format', () => {
    assert.throws(() => parseTimeInput('not-a-date', now), /Invalid time format/);
  });
});

// ============================================================================
// normalizeMaxEvents
// ============================================================================
describe('normalizeMaxEvents', () => {
  it('accepts valid numbers', () => {
    assert.equal(normalizeMaxEvents(1), 1);
    assert.equal(normalizeMaxEvents(100), 100);
    assert.equal(normalizeMaxEvents(1000), 1000);
  });

  it('parses string numbers', () => {
    assert.equal(normalizeMaxEvents('50'), 50);
  });

  it('throws on out of range', () => {
    assert.throws(() => normalizeMaxEvents(0), /max_events must be/);
    assert.throws(() => normalizeMaxEvents(1001), /max_events must be/);
    assert.throws(() => normalizeMaxEvents(-1), /max_events must be/);
  });

  it('throws on NaN', () => {
    assert.throws(() => normalizeMaxEvents('abc'), /max_events must be/);
  });
});

// ============================================================================
// normalizeMaxChars
// ============================================================================
describe('normalizeMaxChars', () => {
  it('accepts valid numbers', () => {
    assert.equal(normalizeMaxChars(1000), 1000);
    assert.equal(normalizeMaxChars(200000), 200000);
    assert.equal(normalizeMaxChars(50000), 50000);
  });

  it('throws on out of range', () => {
    assert.throws(() => normalizeMaxChars(999), /max_chars must be/);
    assert.throws(() => normalizeMaxChars(200001), /max_chars must be/);
  });
});

// ============================================================================
// normalizeDocFormat
// ============================================================================
describe('normalizeDocFormat', () => {
  it('returns both for empty/null input', () => {
    assert.equal(normalizeDocFormat(null), 'both');
    assert.equal(normalizeDocFormat(''), 'both');
    assert.equal(normalizeDocFormat(undefined), 'both');
  });

  it('normalizes case', () => {
    assert.equal(normalizeDocFormat('HTML'), 'html');
    assert.equal(normalizeDocFormat('Markdown'), 'markdown');
    assert.equal(normalizeDocFormat('BOTH'), 'both');
  });

  it('trims whitespace', () => {
    assert.equal(normalizeDocFormat('  html  '), 'html');
  });

  it('throws on invalid format', () => {
    assert.throws(() => normalizeDocFormat('pdf'), /format must be/);
  });
});

// ============================================================================
// formatBytes
// ============================================================================
describe('formatBytes', () => {
  it('returns 0 B for zero/null', () => {
    assert.equal(formatBytes(0), '0 B');
    assert.equal(formatBytes(null), '0 B');
    assert.equal(formatBytes(undefined), '0 B');
  });

  it('formats bytes', () => {
    assert.equal(formatBytes(500), '500 B');
  });

  it('formats kilobytes', () => {
    assert.equal(formatBytes(1024), '1 KB');
    assert.equal(formatBytes(1536), '1.5 KB');
  });

  it('formats megabytes', () => {
    assert.equal(formatBytes(1048576), '1 MB');
  });

  it('formats gigabytes', () => {
    assert.equal(formatBytes(1073741824), '1 GB');
  });
});

// ============================================================================
// formatTimestamp
// ============================================================================
describe('formatTimestamp', () => {
  it('returns Never for null/undefined', () => {
    assert.equal(formatTimestamp(null), 'Never');
    assert.equal(formatTimestamp(undefined), 'Never');
    assert.equal(formatTimestamp(0), 'Never');
  });

  it('formats epoch milliseconds', () => {
    const result = formatTimestamp(1700000000000);
    assert.ok(result.includes('2023-11-14'));
    assert.ok(result.endsWith('Z'));
  });

  it('formats string timestamps', () => {
    const result = formatTimestamp('1700000000000');
    assert.ok(result.includes('2023-11-14'));
  });

  it('returns original for invalid values', () => {
    assert.equal(formatTimestamp('not-a-number'), 'not-a-number');
  });
});

// ============================================================================
// validateRepoName
// ============================================================================
describe('validateRepoName', () => {
  it('accepts valid names', () => {
    assert.equal(validateRepoName('my-repo'), 'my-repo');
    assert.equal(validateRepoName('my_repo'), 'my_repo');
    assert.equal(validateRepoName('MyRepo123'), 'MyRepo123');
    assert.equal(validateRepoName('repo.name'), 'repo.name');
  });

  it('throws on null/undefined/empty', () => {
    assert.throws(() => validateRepoName(null), /Repository name is required/);
    assert.throws(() => validateRepoName(''), /Repository name is required/);
    assert.throws(() => validateRepoName(undefined), /Repository name is required/);
  });

  it('throws on injection attempts', () => {
    assert.throws(() => validateRepoName('repo"; DROP TABLE'), /Invalid repository name/);
    assert.throws(() => validateRepoName('repo/../../etc'), /Invalid repository name/);
    assert.throws(() => validateRepoName('repo name'), /Invalid repository name/);
    assert.throws(() => validateRepoName('repo?param=1'), /Invalid repository name/);
  });

  it('throws on special characters', () => {
    assert.throws(() => validateRepoName('repo@name'), /Invalid repository name/);
    assert.throws(() => validateRepoName('repo#name'), /Invalid repository name/);
    assert.throws(() => validateRepoName('repo$name'), /Invalid repository name/);
  });
});

// ============================================================================
// safePath
// ============================================================================
describe('safePath', () => {
  it('resolves relative paths within base dir', () => {
    const result = safePath('/opt/app', 'file.yaml');
    assert.equal(result, '/opt/app/file.yaml');
  });

  it('throws on path traversal', () => {
    assert.throws(() => safePath('/opt/app', '../../etc/passwd'), /resolves outside/);
  });

  it('throws on absolute paths outside base', () => {
    assert.throws(() => safePath('/opt/app', '/etc/passwd'), /resolves outside/);
  });

  it('allows absolute paths inside base dir', () => {
    const result = safePath('/opt/app', '/opt/app/sub/file.yaml');
    assert.equal(result, '/opt/app/sub/file.yaml');
  });

  it('throws on sibling directory with matching prefix', () => {
    assert.throws(() => safePath('/opt/app', '../app_evil/file.txt'), /resolves outside/);
  });
});

// ============================================================================
// parseCSVLine
// ============================================================================
describe('parseCSVLine', () => {
  it('parses simple CSV', () => {
    assert.deepEqual(parseCSVLine('a,b,c'), ['a', 'b', 'c']);
  });

  it('handles quoted fields with commas', () => {
    assert.deepEqual(parseCSVLine('"hello, world",foo,bar'), ['hello, world', 'foo', 'bar']);
  });

  it('handles escaped quotes', () => {
    assert.deepEqual(parseCSVLine('"say ""hello""",b'), ['say "hello"', 'b']);
  });

  it('handles empty fields', () => {
    assert.deepEqual(parseCSVLine('a,,c'), ['a', '', 'c']);
  });

  it('trims whitespace', () => {
    assert.deepEqual(parseCSVLine(' a , b , c '), ['a', 'b', 'c']);
  });
});

// ============================================================================
// HTML Processing
// ============================================================================
describe('decodeHtmlEntities', () => {
  it('decodes common entities', () => {
    assert.equal(decodeHtmlEntities('&amp;'), '&');
    assert.equal(decodeHtmlEntities('&lt;'), '<');
    assert.equal(decodeHtmlEntities('&gt;'), '>');
    assert.equal(decodeHtmlEntities('&quot;'), '"');
    assert.equal(decodeHtmlEntities('&#39;'), "'");
    assert.equal(decodeHtmlEntities('&nbsp;'), ' ');
  });

  it('handles multiple entities', () => {
    assert.equal(decodeHtmlEntities('a &amp; b &lt; c'), 'a & b < c');
  });
});

describe('stripTags', () => {
  it('removes HTML tags', () => {
    assert.equal(stripTags('<p>hello</p>'), ' hello ');
    assert.equal(stripTags('<b>bold</b> text'), ' bold  text');
  });

  it('handles self-closing tags', () => {
    assert.equal(stripTags('line1<br/>line2'), 'line1 line2');
  });
});

describe('htmlToText', () => {
  it('strips script and style tags', () => {
    const html = '<p>hello</p><script>alert("xss")</script><style>.x{}</style><p>world</p>';
    const result = htmlToText(html);
    assert.ok(!result.includes('alert'));
    assert.ok(!result.includes('.x'));
    assert.ok(result.includes('hello'));
    assert.ok(result.includes('world'));
  });

  it('converts breaks to newlines', () => {
    const html = 'line1<br>line2<br/>line3';
    const result = htmlToText(html);
    assert.ok(result.includes('line1'));
    assert.ok(result.includes('line2'));
    assert.ok(result.includes('line3'));
  });

  it('returns empty string for empty input', () => {
    assert.equal(htmlToText(''), '');
  });
});

describe('htmlToMarkdown', () => {
  it('converts headings', () => {
    const html = '<h1>Title</h1><h2>Subtitle</h2>';
    const result = htmlToMarkdown(html);
    assert.ok(result.includes('# Title'));
    assert.ok(result.includes('## Subtitle'));
  });

  it('converts bold and italic', () => {
    const html = '<strong>bold</strong> and <em>italic</em>';
    const result = htmlToMarkdown(html);
    assert.ok(result.includes('**bold**'));
    assert.ok(result.includes('*italic*'));
  });

  it('converts code blocks', () => {
    const html = '<pre>code here</pre>';
    const result = htmlToMarkdown(html);
    assert.ok(result.includes('```'));
    assert.ok(result.includes('code here'));
  });

  it('converts inline code', () => {
    const html = 'use <code>someFunc()</code> here';
    const result = htmlToMarkdown(html);
    assert.ok(result.includes('`someFunc()`'));
  });

  it('converts list items', () => {
    const html = '<ul><li>item 1</li><li>item 2</li></ul>';
    const result = htmlToMarkdown(html);
    assert.ok(result.includes('- item 1'));
    assert.ok(result.includes('- item 2'));
  });

  it('strips script and style', () => {
    const html = '<script>alert("xss")</script><style>.x{}</style><p>content</p>';
    const result = htmlToMarkdown(html);
    assert.ok(!result.includes('alert'));
    assert.ok(!result.includes('.x'));
    assert.ok(result.includes('content'));
  });
});

// ============================================================================
// validateJobId
// ============================================================================
describe('validateJobId', () => {
  it('accepts valid alphanumeric job IDs', () => {
    assert.equal(validateJobId('abc123'), 'abc123');
    assert.equal(validateJobId('job-42'), 'job-42');
    assert.equal(validateJobId('query_job_001'), 'query_job_001');
  });

  it('accepts UUID-style job IDs', () => {
    assert.equal(validateJobId('a1b2c3d4-e5f6-7890-abcd-ef1234567890'), 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');
  });

  it('throws on null/undefined/empty', () => {
    assert.throws(() => validateJobId(null), /job_id is required/);
    assert.throws(() => validateJobId(undefined), /job_id is required/);
    assert.throws(() => validateJobId(''), /job_id is required/);
    assert.throws(() => validateJobId('  '), /job_id is required/);
  });

  it('rejects path traversal attempts', () => {
    assert.throws(() => validateJobId('../../../etc/passwd'), /Invalid job_id format/);
    assert.throws(() => validateJobId('job/../../admin'), /Invalid job_id format/);
  });

  it('rejects URL injection attempts', () => {
    assert.throws(() => validateJobId('job?param=1'), /Invalid job_id format/);
    assert.throws(() => validateJobId('job&action=delete'), /Invalid job_id format/);
    assert.throws(() => validateJobId('job#fragment'), /Invalid job_id format/);
  });

  it('rejects special characters', () => {
    assert.throws(() => validateJobId('job id'), /Invalid job_id format/);
    assert.throws(() => validateJobId('job;rm -rf'), /Invalid job_id format/);
    assert.throws(() => validateJobId('job$(whoami)'), /Invalid job_id format/);
  });
});

// ============================================================================
// sanitizeErrorText
// ============================================================================
describe('sanitizeErrorText', () => {
  it('returns empty string for null/undefined', () => {
    assert.equal(sanitizeErrorText(null), '');
    assert.equal(sanitizeErrorText(undefined), '');
    assert.equal(sanitizeErrorText(''), '');
  });

  it('passes through short clean text', () => {
    assert.equal(sanitizeErrorText('Not found'), 'Not found');
  });

  it('truncates long text to default 500 chars', () => {
    const long = 'x'.repeat(1000);
    const result = sanitizeErrorText(long);
    assert.equal(result.length, 500);
  });

  it('truncates to custom max length', () => {
    const long = 'x'.repeat(200);
    const result = sanitizeErrorText(long, 50);
    assert.equal(result.length, 50);
  });

  it('collapses newlines to spaces', () => {
    const text = 'line1\nline2\r\nline3\n\nline4';
    const result = sanitizeErrorText(text);
    assert.equal(result, 'line1 line2 line3 line4');
  });

  it('trims whitespace', () => {
    assert.equal(sanitizeErrorText('  hello  '), 'hello');
  });

  it('handles non-string input gracefully', () => {
    assert.equal(sanitizeErrorText(12345), '');
    assert.equal(sanitizeErrorText({}), '');
  });
});
