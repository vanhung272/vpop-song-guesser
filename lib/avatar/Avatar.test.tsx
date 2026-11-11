// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Avatar } from './Avatar';

function fakeContext() {
  return new Proxy(
    {},
    {
      get: (target: Record<string, unknown>, prop: string) => target[prop] ?? vi.fn(),
      set: (target: Record<string, unknown>, prop: string, value) => {
        target[prop] = value;
        return true;
      },
    },
  );
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    (() => fakeContext()) as unknown as HTMLCanvasElement['getContext'],
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('<Avatar />', () => {
  it('renders a canvas with the given size', () => {
    render(<Avatar seed="abc" size={96} />);
    const canvas = screen.getByRole('img') as HTMLCanvasElement;
    expect(canvas.tagName).toBe('CANVAS');
    expect(canvas.style.width).toBe('96px');
    expect(canvas.style.height).toBe('96px');
    // Backing store is size * devicePixelRatio (1 in jsdom).
    expect(canvas.width).toBe(96);
    expect(canvas.height).toBe(96);
    expect(canvas.getAttribute('aria-label')).toBeTruthy();
  });

  it('draws onto the 2d context', () => {
    render(<Avatar seed="abc" size={64} />);
    expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalledWith('2d');
  });
});
