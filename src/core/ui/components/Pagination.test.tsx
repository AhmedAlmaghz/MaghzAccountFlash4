import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Pagination } from './Pagination';

describe('Pagination', () => {
  const defaultProps = {
    page: 1,
    pageSize: 10,
    total: 100,
    onPageChange: vi.fn(),
  };

  it('renders pagination component', () => {
    render(<Pagination {...defaultProps} />);
    expect(screen.getByText(/1-10/)).toBeInTheDocument();
    expect(screen.getByText(/100/)).toBeInTheDocument();
  });

  it('disables previous buttons on first page', () => {
    render(<Pagination {...defaultProps} page={1} />);
    const firstButton = screen.getByRole('button', { name: /الأولى/ });
    const prevButton = screen.getByRole('button', { name: /السابقة/ });
    expect(firstButton).toBeDisabled();
    expect(prevButton).toBeDisabled();
  });

  it('enables navigation buttons on middle page', () => {
    render(<Pagination {...defaultProps} page={5} />);
    const firstButton = screen.getByRole('button', { name: /الأولى/ });
    const prevButton = screen.getByRole('button', { name: /السابقة/ });
    const nextButton = screen.getByRole('button', { name: /التالية/ });
    const lastButton = screen.getByRole('button', { name: /الأخيرة/ });
    expect(firstButton).toBeEnabled();
    expect(prevButton).toBeEnabled();
    expect(nextButton).toBeEnabled();
    expect(lastButton).toBeEnabled();
  });

  it('disables next buttons on last page', () => {
    render(<Pagination {...defaultProps} page={10} />);
    const nextButton = screen.getByRole('button', { name: /التالية/ });
    const lastButton = screen.getByRole('button', { name: /الأخيرة/ });
    expect(nextButton).toBeDisabled();
    expect(lastButton).toBeDisabled();
  });

  it('calls onPageChange when clicking next', () => {
    const onPageChange = vi.fn();
    render(<Pagination {...defaultProps} page={1} onPageChange={onPageChange} />);
    const nextButton = screen.getByRole('button', { name: /التالية/ });
    fireEvent.click(nextButton);
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('calls onPageChange when clicking previous', () => {
    const onPageChange = vi.fn();
    render(<Pagination {...defaultProps} page={5} onPageChange={onPageChange} />);
    const prevButton = screen.getByRole('button', { name: /السابقة/ });
    fireEvent.click(prevButton);
    expect(onPageChange).toHaveBeenCalledWith(4);
  });

  it('calls onPageChange when clicking first', () => {
    const onPageChange = vi.fn();
    render(<Pagination {...defaultProps} page={5} onPageChange={onPageChange} />);
    const firstButton = screen.getByRole('button', { name: /الأولى/ });
    fireEvent.click(firstButton);
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it('calls onPageChange when clicking last', () => {
    const onPageChange = vi.fn();
    render(<Pagination {...defaultProps} page={5} onPageChange={onPageChange} />);
    const lastButton = screen.getByRole('button', { name: /الأخيرة/ });
    fireEvent.click(lastButton);
    expect(onPageChange).toHaveBeenCalledWith(10);
  });

  it('shows page size selector when enabled', () => {
    const onPageSizeChange = vi.fn();
    render(<Pagination {...defaultProps} onPageSizeChange={onPageSizeChange} showSizeChanger={true} />);
    const select = screen.getByRole('combobox', { name: /حجم الصفحة/ });
    expect(select).toBeInTheDocument();
  });

  it('calls onPageSizeChange when changing page size', () => {
    const onPageSizeChange = vi.fn();
    render(<Pagination {...defaultProps} onPageSizeChange={onPageSizeChange} showSizeChanger={true} />);
    const select = screen.getByRole('combobox', { name: /حجم الصفحة/ });
    fireEvent.change(select, { target: { value: '25' } });
    expect(onPageSizeChange).toHaveBeenCalledWith(25);
  });

  it('hides page size selector when showSizeChanger is false', () => {
    const onPageSizeChange = vi.fn();
    render(<Pagination {...defaultProps} onPageSizeChange={onPageSizeChange} showSizeChanger={false} />);
    const select = screen.queryByRole('combobox', { name: /حجم الصفحة/ });
    expect(select).not.toBeInTheDocument();
  });

  it('displays correct range for middle page', () => {
    render(<Pagination {...defaultProps} page={3} />);
    expect(screen.getByText(/21-30/)).toBeInTheDocument();
  });

  it('displays correct range for last page with partial items', () => {
    render(<Pagination {...defaultProps} page={10} total={95} />);
    expect(screen.getByText(/91-95/)).toBeInTheDocument();
  });

  it('handles zero total items', () => {
    render(<Pagination {...defaultProps} total={0} />);
    expect(screen.getByText(/لا توجد نتائج/)).toBeInTheDocument();
  });

  it('calculates totalPages correctly', () => {
    render(<Pagination {...defaultProps} total={95} pageSize={10} />);
    expect(screen.getByText(/صفحة 1 من 10/)).toBeInTheDocument();
  });
});
