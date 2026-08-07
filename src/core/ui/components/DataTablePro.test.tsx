import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DataTablePro } from './DataTablePro';
import type { ColumnDef } from '@tanstack/react-table';

interface TestRow {
  id: string;
  name: string;
  value: number;
}

const mockData: TestRow[] = [
  { id: '1', name: 'Item 1', value: 100 },
  { id: '2', name: 'Item 2', value: 200 },
  { id: '3', name: 'Item 3', value: 300 },
];

const columns: ColumnDef<TestRow>[] = [
  {
    accessorKey: 'name',
    header: 'Name',
  },
  {
    accessorKey: 'value',
    header: 'Value',
  },
];

describe('DataTablePro', () => {
  it('renders loading state', () => {
    render(
      <DataTablePro
        data={[]}
        columns={columns}
        keyExtractor={(row) => row.id}
        isLoading={true}
      />
    );

    const skeletons = document.querySelectorAll('.animate-pulse-soft');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('renders empty state when no data', () => {
    render(
      <DataTablePro
        data={[]}
        columns={columns}
        keyExtractor={(row) => row.id}
      />
    );

    expect(screen.getByText('لا توجد بيانات')).toBeInTheDocument();
  });

  it('renders custom empty message', () => {
    render(
      <DataTablePro
        data={[]}
        columns={columns}
        keyExtractor={(row) => row.id}
        emptyMessage="No records found"
      />
    );

    expect(screen.getByText('No records found')).toBeInTheDocument();
  });

  it('renders table with data', () => {
    render(
      <DataTablePro
        data={mockData}
        columns={columns}
        keyExtractor={(row) => row.id}
      />
    );

    expect(screen.getByText('Item 1')).toBeInTheDocument();
    expect(screen.getByText('Item 2')).toBeInTheDocument();
    expect(screen.getByText('Item 3')).toBeInTheDocument();
  });

  it('renders title when provided', () => {
    render(
      <DataTablePro
        data={mockData}
        columns={columns}
        keyExtractor={(row) => row.id}
        title="Test Table"
      />
    );

    expect(screen.getByText('Test Table')).toBeInTheDocument();
  });

  it('renders search input when searchable', () => {
    render(
      <DataTablePro
        data={mockData}
        columns={columns}
        keyExtractor={(row) => row.id}
        searchable={true}
      />
    );

    const searchInput = screen.getByPlaceholderText('بحث...');
    expect(searchInput).toBeInTheDocument();
  });

  it('hides search input when not searchable', () => {
    render(
      <DataTablePro
        data={mockData}
        columns={columns}
        keyExtractor={(row) => row.id}
        searchable={false}
      />
    );

    expect(screen.queryByPlaceholderText('بحث...')).not.toBeInTheDocument();
  });

  it('filters data when searching', () => {
    render(
      <DataTablePro
        data={mockData}
        columns={columns}
        keyExtractor={(row) => row.id}
        searchable={true}
      />
    );

    const searchInput = screen.getByPlaceholderText('بحث...');
    fireEvent.change(searchInput, { target: { value: 'Item 1' } });

    expect(screen.getByText('Item 1')).toBeInTheDocument();
    expect(screen.queryByText('Item 2')).not.toBeInTheDocument();
  });

  it('renders export buttons when handlers provided', () => {
    const onExportExcel = vi.fn();
    const onExportPdf = vi.fn();
    const onPrint = vi.fn();

    render(
      <DataTablePro
        data={mockData}
        columns={columns}
        keyExtractor={(row) => row.id}
        onExportExcel={onExportExcel}
        onExportPdf={onExportPdf}
        onPrint={onPrint}
      />
    );

    expect(screen.getByTitle('تصدير Excel')).toBeInTheDocument();
    expect(screen.getByTitle('تصدير PDF')).toBeInTheDocument();
    expect(screen.getByTitle('طباعة')).toBeInTheDocument();
  });

  it('calls export handlers when clicked', () => {
    const onExportExcel = vi.fn();
    const onExportPdf = vi.fn();
    const onPrint = vi.fn();

    render(
      <DataTablePro
        data={mockData}
        columns={columns}
        keyExtractor={(row) => row.id}
        onExportExcel={onExportExcel}
        onExportPdf={onExportPdf}
        onPrint={onPrint}
      />
    );

    fireEvent.click(screen.getByTitle('تصدير Excel'));
    expect(onExportExcel).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByTitle('تصدير PDF'));
    expect(onExportPdf).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByTitle('طباعة'));
    expect(onPrint).toHaveBeenCalledOnce();
  });

  it('handles row click', () => {
    const onRowClick = vi.fn();

    render(
      <DataTablePro
        data={mockData}
        columns={columns}
        keyExtractor={(row) => row.id}
        onRowClick={onRowClick}
      />
    );

    const row = screen.getByText('Item 1').closest('tr');
    if (row) {
      fireEvent.click(row);
    }

    expect(onRowClick).toHaveBeenCalledWith(mockData[0]);
  });

  it('renders pagination controls', () => {
    render(
      <DataTablePro
        data={mockData}
        columns={columns}
        keyExtractor={(row) => row.id}
        pageSize={2}
      />
    );

    expect(screen.getByText('عرض')).toBeInTheDocument();
    expect(screen.getByText(/من \d+ سجل/)).toBeInTheDocument();
  });

  it('changes page size', () => {
    render(
      <DataTablePro
        data={mockData}
        columns={columns}
        keyExtractor={(row) => row.id}
        pageSize={2}
      />
    );

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: '25' } });

    expect(select).toHaveValue('25');
  });

  it('applies custom className', () => {
    const { container } = render(
      <DataTablePro
        data={mockData}
        columns={columns}
        keyExtractor={(row) => row.id}
        className="custom-table"
      />
    );

    expect(container.firstChild).toHaveClass('custom-table');
  });

  it('uses custom search placeholder', () => {
    render(
      <DataTablePro
        data={mockData}
        columns={columns}
        keyExtractor={(row) => row.id}
        searchable={true}
        searchPlaceholder="Search here..."
      />
    );

    expect(screen.getByPlaceholderText('Search here...')).toBeInTheDocument();
  });

  it('renders custom page size options', () => {
    render(
      <DataTablePro
        data={mockData}
        columns={columns}
        keyExtractor={(row) => row.id}
        pageSizeOptions={[5, 10, 20]}
      />
    );

    const select = screen.getByRole('combobox');
    const options = Array.from(select.querySelectorAll('option'));
    expect(options).toHaveLength(3);
  });
});
