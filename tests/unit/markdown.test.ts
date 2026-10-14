import { describe, expect, it } from 'vitest';
import { gifUrl, safeUrl } from '@/lib/markdown';

describe('Markdown link filter', () => {
  it('keeps http(s) and mailto, drops everything else', () => {
    expect(safeUrl('https://arxiv.org/abs/1')).toBe('https://arxiv.org/abs/1');
    expect(safeUrl('HTTP://x.org')).toBe('HTTP://x.org');
    expect(safeUrl('mailto:a@b.org')).toBe('mailto:a@b.org');
    for (const bad of [
      'javascript:alert(1)',
      ' javascript:alert(1)',
      'data:text/html,x',
      'vbscript:x',
      '/relative',
      '//evil.org',
      'file:///etc/passwd',
    ]) {
      expect(safeUrl(bad)).toBe('');
    }
  });
});

describe('Markdown GIF filter', () => {
  it('passes https .gif URLs on the allowlisted hosts', () => {
    expect(gifUrl('https://media.giphy.com/media/abc/giphy.gif')).toBe('https://media.giphy.com/media/abc/giphy.gif');
    expect(gifUrl('https://media.giphy.com/a.gif?cid=1')).toBe('https://media.giphy.com/a.gif?cid=1');
    expect(gifUrl('https://media.tenor.com/x/cat.GIF')).toBe('https://media.tenor.com/x/cat.GIF');
  });
  it('refuses everything else', () => {
    for (const bad of [
      'http://media.giphy.com/a.gif',
      'https://evil.example/a.gif',
      'https://media.giphy.com.evil.example/a.gif',
      'https://user@media.giphy.com/a.gif',
      'https://media.giphy.com/a.png',
      'data:image/gif;base64,R0lGOD',
      '//media.giphy.com/a.gif',
      '',
    ]) {
      expect(gifUrl(bad), bad).toBeNull();
    }
  });
});
