import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Table } from './Table';

describe('Table', () => {
  const mockData = [
    { id: '1', name: 'John Doe', age: 30 },
    { id: '2', name: 'Jane Smith', age: 25 },
    { id: '3', name: 'Bob Johnson', age: 35 },
  ];

  const columns = [
    { key: 'name', header: 'Name' },
    { key: 'age', header: 'Age' },
  ];

  const keyExtractor = (row: typeof mockData[0]) => row.id;

  it('renders table with data', () => {
    render(
      <Table
        data={mockData}
        columns={columns}
        keyExtractor={keyExtractor}
      />
    );

    // Both desktop table and mobile card list render in DOM (CSS controls visibility)
    expect(screen.getAllByText('Name').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Age').length).toBeGreaterThan(0);
    expect(screen.getAllByText('John Doe').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Jane Smith').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Bob Johnson').length).toBeGreaterThan(0);
    expect(screen.getAllByText('30').length).toBeGreaterThan(0);
    expect(screen.getAllByText('25').length).toBeGreaterThan(0);
    expect(screen.getAllByText('35').length).toBeGreaterThan(0);
  });

  it('renders loading state as skeleton', () => {
    render(
      <Table
        data={[]}
        columns={columns}
        keyExtractor={keyExtractor}
        isLoading={true}
      />
    );

    const skeleton = document.querySelector('.skeleton');
    expect(skeleton).toBeInTheDocument();
  });

  it('renders empty state when no data', () => {
    render(
      <Table
        data={[]}
        columns={columns}
        keyExtractor={keyExtractor}
      />
    );

    expect(screen.getByText('لا توجد بيانات')).toBeInTheDocument();
  });

  it('renders custom empty message', () => {
    render(
      <Table
        data={[]}
        columns={columns}
        keyExtractor={keyExtractor}
        emptyMessage="No records found"
      />
    );

    expect(screen.getByText('No records found')).toBeInTheDocument();
  });

  it('handles row click', () => {
    const onRowClick = vi.fn();
    render(
      <Table
        data={mockData}
        columns={columns}
        keyExtractor={keyExtractor}
        onRowClick={onRowClick}
      />
    );

    // Desktop table row — select the row that contains the cell with John Doe
    const row = screen
      .getAllByRole('row')
      .find((r) => r.textContent?.includes('John Doe'));
    if (row) {
      fireEvent.click(row);
    }

    expect(onRowClick).toHaveBeenCalledWith(mockData[0]);
  });

  it('mobile card click triggers onRowClick', () => {
    const onRowClick = vi.fn();
    render(
      <Table
        data={mockData}
        columns={[{ key: 'name', header: 'Name', mobile: 'title' }, { key: 'age', header: 'Age' }]}
        keyExtractor={keyExtractor}
        onRowClick={onRowClick}
      />
    );

    const card = screen.getAllByText('John Doe')[0].closest('div.cursor-pointer');
    if (card) fireEvent.click(card);
    expect(onRowClick).toHaveBeenCalled();
  });

  it('renders with custom render function', () => {
    const columnsWithRender = [
      { key: 'name', header: 'Name' },
      {
        key: 'age',
        header: 'Age',
        render: (row: typeof mockData[0]) => `${row.age} years`,
      },
    ];

    render(
      <Table
        data={mockData}
        columns={columnsWithRender}
        keyExtractor={keyExtractor}
      />
    );

    expect(screen.getAllByText('30 years').length).toBeGreaterThan(0);
    expect(screen.getAllByText('25 years').length).toBeGreaterThan(0);
    expect(screen.getAllByText('35 years').length).toBeGreaterThan(0);
  });

  it('renders with column alignment', () => {
    const alignedColumns = [
      { key: 'name', header: 'Name', align: 'left' as const },
      { key: 'age', header: 'Age', align: 'right' as const },
    ];

    render(
      <Table
        data={mockData}
        columns={alignedColumns}
        keyExtractor={keyExtractor}
      />
    );

    const headers = screen.getAllByRole('columnheader');
    expect(headers[0]).toHaveClass('text-start');
    expect(headers[1]).toHaveClass('text-end');
  });

  it('renders with column width', () => {
    const widthColumns = [
      { key: 'name', header: 'Name', width: '200px' },
      { key: 'age', header: 'Age', width: '100px' },
    ];

    render(
      <Table
        data={mockData}
        columns={widthColumns}
        keyExtractor={keyExtractor}
      />
    );

    const headers = screen.getAllByRole('columnheader');
    expect(headers[0]).toHaveStyle({ width: '200px' });
    expect(headers[1]).toHaveStyle({ width: '100px' });
  });

  it('handles null and undefined values', () => {
    const dataWithNulls = [
      { id: '1', name: 'John', age: null },
      { id: '2', name: 'Jane', age: undefined },
    ];

    render(
      <Table
        data={dataWithNulls}
        columns={columns}
        keyExtractor={keyExtractor}
      />
    );

    const cells = screen.getAllByRole('cell');
    const ageCells = cells.filter(cell => cell.textContent === '-');
    expect(ageCells.length).toBeGreaterThanOrEqual(2);
  });

  it('renders Date objects as locale strings', () => {
    const date = new Date('2024-01-15');
    const expected = date.toLocaleDateString();
    const dataWithDates = [
      { id: '1', name: 'John', date },
    ];

    const dateColumns = [
      { key: 'name', header: 'Name' },
      { key: 'date', header: 'Date' },
    ];

    render(
      <Table
        data={dataWithDates}
        columns={dateColumns}
        keyExtractor={(row) => row.id}
      />
    );

    expect(screen.getAllByText(expected).length).toBeGreaterThan(0);
  });

  it('applies custom className', () => {
    render(
      <Table
        data={mockData}
        columns={columns}
        keyExtractor={keyExtractor}
        className="custom-table"
      />
    );

    const container = document.querySelectorAll('.custom-table');
    expect(container.length).toBeGreaterThan(0);
  });

  it('renders correct number of rows', () => {
    render(
      <Table
        data={mockData}
        columns={columns}
        keyExtractor={keyExtractor}
      />
    );

    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(mockData.length + 1);
  });

  it('renders correct number of columns', () => {
    render(
      <Table
        data={mockData}
        columns={columns}
        keyExtractor={keyExtractor}
      />
    );

    const headers = screen.getAllByRole('columnheader');
    expect(headers).toHaveLength(columns.length);
  });

  it('mobile card mode maps roles correctly', () => {
    render(
      <Table
        data={mockData}
        columns={[
          { key: 'name', header: 'Name', mobile: 'title' },
          { key: 'age', header: 'Age', mobile: 'subtitle' },
          { key: 'id', header: 'ID', mobile: 'hidden' },
        ]}
        keyExtractor={keyExtractor}
      />
    );

    // hidden column appears only in the desktop table header — not in card meta grid
    const cardLabels = screen.getAllByText('ID');
    expect(cardLabels.length).toBe(1);
    // Age appears in subtitle (card) + header + cells (desktop)
    expect(screen.getAllByText('Age').length).toBeGreaterThanOrEqual(1);
  });
});
