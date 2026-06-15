import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatHtmlOutput, escHtml } from '../src/lib/output-formatters/html.mjs';

const MOCK_RESULT_EMPTY = { findings: [] };

const MOCK_RESULT_FINDINGS = {
  findings: [
    {
      severity: 'critical',
      file: 'src/auth.js',
      lineStart: 42,
      title: 'SQL Injection',
      message: 'Unsanitized input passed to query.',
      suggestion: 'Use parameterized queries.',
    },
    {
      severity: 'major',
      file: 'src/utils.js',
      title: 'Missing null check',
      message: 'Possible NPE on line 10.',
    },
  ],
};

const MOCK_RESULT_XSS = {
  findings: [
    {
      severity: 'info',
      file: '<script>alert("xss")</script>',
      title: '<b>bold</b>',
      message: '<script>alert(1)</script>',
      suggestion: '<img src=x onerror=alert(1)>',
    },
  ],
};

describe('formatHtmlOutput', () => {
  it('produces a string containing <!DOCTYPE html>', () => {
    const html = formatHtmlOutput(MOCK_RESULT_EMPTY, 'midstream');
    assert.ok(typeof html === 'string', 'output should be a string');
    assert.ok(html.includes('<!DOCTYPE html>'), 'output should contain <!DOCTYPE html>');
    assert.ok(html.includes('<html lang="ja">'), 'output should contain <html lang="ja">');
  });

  it('reflects the decision in the HTML banner', () => {
    // With critical finding, verdict should be human-review-required
    const html = formatHtmlOutput(MOCK_RESULT_FINDINGS, 'midstream');
    assert.ok(
      html.includes('Human Review Required'),
      'output should render the "Human Review Required" label text in the banner'
    );
  });

  it('auto-approve decision appears for empty findings', () => {
    const html = formatHtmlOutput(MOCK_RESULT_EMPTY, 'upstream');
    assert.ok(
      html.includes('Auto Approve'),
      'empty findings should render the "Auto Approve" label text in the banner'
    );
  });

  it('XSS: finding with <script> in message gets HTML-escaped in output', () => {
    const html = formatHtmlOutput(MOCK_RESULT_XSS, 'midstream');
    assert.ok(
      !html.includes('<script>alert(1)</script>'),
      'raw <script> tag must not appear in output'
    );
    assert.ok(html.includes('&lt;script&gt;'), 'script tag should be HTML-escaped');
    assert.ok(
      !html.includes('<script>alert("xss")</script>'),
      'raw script in file name must not appear'
    );
  });

  it('empty findings array does not crash and renders no-findings message', () => {
    const html = formatHtmlOutput(MOCK_RESULT_EMPTY, 'downstream');
    assert.ok(html.includes('指摘事項なし'), 'should render no-findings message');
  });
});

describe('escHtml', () => {
  it('escapes all five special characters', () => {
    assert.equal(escHtml('& < > " \''), '&amp; &lt; &gt; &quot; &#39;');
  });

  it('handles null/undefined gracefully', () => {
    assert.equal(escHtml(null), '');
    assert.equal(escHtml(undefined), '');
  });
});
