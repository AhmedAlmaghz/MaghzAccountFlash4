import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageLoader } from './PageLoader';

describe('PageLoader', () => {
  it('renders spinner by default', () => {
    const { container } = render(<PageLoader />);
    const spinner = container.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
  });

  it('renders with fullPage layout by default', () => {
    const { container } = render(<PageLoader />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('h-full');
    expect(wrapper.className).toContain('w-full');
  });

  it('renders with non-fullPage layout', () => {
    const { container } = render(<PageLoader fullPage={false} />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('py-12');
    expect(wrapper.className).not.toContain('h-full');
  });

  it('renders text when provided', () => {
    render(<PageLoader text="جاري التحميل..." />);
    expect(screen.getByText('جاري التحميل...')).toBeInTheDocument();
  });

  it('does not render text when not provided', () => {
    const { container } = render(<PageLoader />);
    const paragraph = container.querySelector('p');
    expect(paragraph).not.toBeInTheDocument();
  });
});
