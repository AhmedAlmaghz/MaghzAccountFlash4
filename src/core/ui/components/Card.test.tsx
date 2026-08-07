import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card, CardTitle, CardDescription } from './Card';

describe('Card', () => {
  it('renders children', () => {
    render(<Card>Card content</Card>);
    expect(screen.getByText('Card content')).toBeInTheDocument();
  });

  it('renders header when provided', () => {
    render(<Card header={<span>Header</span>}>Content</Card>);
    expect(screen.getByText('Header')).toBeInTheDocument();
  });

  it('renders footer when provided', () => {
    render(<Card footer={<span>Footer</span>}>Content</Card>);
    expect(screen.getByText('Footer')).toBeInTheDocument();
  });

  it('does not render header section when not provided', () => {
    const { container } = render(<Card>Content</Card>);
    const headerDiv = container.querySelector('.border-b');
    expect(headerDiv).not.toBeInTheDocument();
  });

  it('does not render footer section when not provided', () => {
    const { container } = render(<Card>Content</Card>);
    const footerDiv = container.querySelector('.border-t');
    expect(footerDiv).not.toBeInTheDocument();
  });

  it('applies padding by default', () => {
    const { container } = render(<Card>Content</Card>);
    const contentDiv = container.querySelector('.p-5');
    expect(contentDiv).toBeInTheDocument();
  });

  it('removes padding when noPadding is true', () => {
    const { container } = render(<Card noPadding>Content</Card>);
    const contentDiv = container.querySelector('.p-5');
    expect(contentDiv).not.toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(<Card className="custom-card">Content</Card>);
    expect(container.firstChild).toHaveClass('custom-card');
  });

  it('forwards ref', () => {
    const ref = vi.fn();
    render(<Card ref={ref}>Content</Card>);
    expect(ref).toHaveBeenCalled();
  });
});

describe('CardTitle', () => {
  it('renders children', () => {
    render(<CardTitle>My Title</CardTitle>);
    expect(screen.getByText('My Title')).toBeInTheDocument();
  });

  it('renders as h3', () => {
    render(<CardTitle>Title</CardTitle>);
    expect(screen.getByRole('heading', { level: 3 })).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(<CardTitle className="custom-title">Title</CardTitle>);
    expect(container.firstChild).toHaveClass('custom-title');
  });
});

describe('CardDescription', () => {
  it('renders children', () => {
    render(<CardDescription>My description</CardDescription>);
    expect(screen.getByText('My description')).toBeInTheDocument();
  });

  it('renders as p', () => {
    render(<CardDescription>Desc</CardDescription>);
    expect(screen.getByText('Desc').tagName).toBe('P');
  });

  it('applies custom className', () => {
    const { container } = render(<CardDescription className="custom-desc">Desc</CardDescription>);
    expect(container.firstChild).toHaveClass('custom-desc');
  });
});
