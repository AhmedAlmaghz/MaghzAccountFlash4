import { describe, it, expect } from 'vitest';
import { escapeHtml, sanitizeElementHtml } from './html';

describe('html utilities', () => {
  describe('escapeHtml', () => {
    it('escapes ampersand', () => {
      expect(escapeHtml('test & value')).toBe('test &amp; value');
    });

    it('escapes less than', () => {
      expect(escapeHtml('test < value')).toBe('test &lt; value');
    });

    it('escapes greater than', () => {
      expect(escapeHtml('test > value')).toBe('test &gt; value');
    });

    it('escapes double quotes', () => {
      expect(escapeHtml('test "value"')).toBe('test &quot;value&quot;');
    });

    it('escapes single quotes', () => {
      expect(escapeHtml("test 'value'")).toBe('test &#39;value&#39;');
    });

    it('escapes multiple special characters', () => {
      expect(escapeHtml('<script>alert("xss")</script>')).toBe(
        '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
      );
    });

    it('handles empty string', () => {
      expect(escapeHtml('')).toBe('');
    });

    it('handles string without special characters', () => {
      expect(escapeHtml('hello world')).toBe('hello world');
    });
  });

  describe('sanitizeElementHtml', () => {
    it('removes script tags', () => {
      const div = document.createElement('div');
      div.innerHTML = '<p>safe</p><script>alert("xss")</script>';
      const result = sanitizeElementHtml(div);
      expect(result).not.toContain('<script>');
      expect(result).toContain('<p>safe</p>');
    });

    it('removes iframe tags', () => {
      const div = document.createElement('div');
      div.innerHTML = '<p>safe</p><iframe src="evil.com"></iframe>';
      const result = sanitizeElementHtml(div);
      expect(result).not.toContain('<iframe>');
      expect(result).toContain('<p>safe</p>');
    });

    it('removes object tags', () => {
      const div = document.createElement('div');
      div.innerHTML = '<p>safe</p><object data="evil.swf"></object>';
      const result = sanitizeElementHtml(div);
      expect(result).not.toContain('<object>');
    });

    it('removes event handlers', () => {
      const div = document.createElement('div');
      div.innerHTML = '<button onclick="alert(1)">click</button>';
      const result = sanitizeElementHtml(div);
      expect(result).not.toContain('onclick');
      expect(result).toContain('<button>click</button>');
    });

    it('removes javascript: URLs', () => {
      const div = document.createElement('div');
      div.innerHTML = '<a href="javascript:alert(1)">link</a>';
      const result = sanitizeElementHtml(div);
      expect(result).not.toContain('javascript:');
    });

    it('removes srcdoc attribute', () => {
      const div = document.createElement('div');
      div.innerHTML = '<iframe srcdoc="<script>alert(1)</script>"></iframe>';
      const result = sanitizeElementHtml(div);
      expect(result).not.toContain('srcdoc');
    });

    it('preserves safe HTML', () => {
      const div = document.createElement('div');
      div.innerHTML = '<p class="test">safe content</p>';
      const result = sanitizeElementHtml(div);
      expect(result).toContain('<p class="test">safe content</p>');
    });

    it('handles nested dangerous tags', () => {
      const div = document.createElement('div');
      div.innerHTML = '<div><p>safe</p><script>alert(1)</script></div>';
      const result = sanitizeElementHtml(div);
      expect(result).not.toContain('<script>');
      expect(result).toContain('<p>safe</p>');
    });
  });
});
