import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ActionButtons } from './ActionButtons';

describe('ActionButtons', () => {
  it('renders view, edit, delete buttons by default', () => {
    const onView = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();

    render(<ActionButtons onView={onView} onEdit={onEdit} onDelete={onDelete} />);

    expect(screen.getByTitle('عرض')).toBeInTheDocument();
    expect(screen.getByTitle('تعديل')).toBeInTheDocument();
    expect(screen.getByTitle('حذف')).toBeInTheDocument();
  });

  it('does not render print/export by default', () => {
    const onView = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();

    render(<ActionButtons onView={onView} onEdit={onEdit} onDelete={onDelete} />);

    expect(screen.queryByTitle('طباعة')).not.toBeInTheDocument();
    expect(screen.queryByTitle('تصدير')).not.toBeInTheDocument();
  });

  it('renders print button when showPrint is true', () => {
    const onPrint = vi.fn();
    render(<ActionButtons onPrint={onPrint} showPrint onView={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByTitle('طباعة')).toBeInTheDocument();
  });

  it('renders export button when showExport is true', () => {
    const onExport = vi.fn();
    render(<ActionButtons onExport={onExport} showExport onView={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByTitle('تصدير')).toBeInTheDocument();
  });

  it('calls onView when view button is clicked', () => {
    const onView = vi.fn();
    render(<ActionButtons onView={onView} onEdit={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByTitle('عرض'));
    expect(onView).toHaveBeenCalledOnce();
  });

  it('calls onEdit when edit button is clicked', () => {
    const onEdit = vi.fn();
    render(<ActionButtons onView={vi.fn()} onEdit={onEdit} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByTitle('تعديل'));
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it('calls onDelete when delete button is clicked', () => {
    const onDelete = vi.fn();
    render(<ActionButtons onView={vi.fn()} onEdit={vi.fn()} onDelete={onDelete} />);
    fireEvent.click(screen.getByTitle('حذف'));
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it('hides view when showView is false', () => {
    render(<ActionButtons onView={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} showView={false} />);
    expect(screen.queryByTitle('عرض')).not.toBeInTheDocument();
  });

  it('hides edit when showEdit is false', () => {
    render(<ActionButtons onView={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} showEdit={false} />);
    expect(screen.queryByTitle('تعديل')).not.toBeInTheDocument();
  });

  it('hides delete when showDelete is false', () => {
    render(<ActionButtons onView={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} showDelete={false} />);
    expect(screen.queryByTitle('حذف')).not.toBeInTheDocument();
  });

  it('does not render button when handler is missing', () => {
    render(<ActionButtons onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.queryByTitle('عرض')).not.toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(
      <ActionButtons onView={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} className="custom-actions" />
    );
    expect(container.firstChild).toHaveClass('custom-actions');
  });
});
