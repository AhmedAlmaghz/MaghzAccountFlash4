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

    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Age')).toBeInTheDocument();
    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    expect(screen.getByText('Bob Johnson')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getByText('35')).toBeInTheDocument();
  });

  it('renders loading state', () => {
    render(
      <Table
        data={[]}
        columns={columns}
        keyExtractor={keyExtractor}
        isLoading={true}
      />
    );

    const spinner = document.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
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

    const row = screen.getByText('John Doe').closest('tr');
    if (row) {
      fireEvent.click(row);
    }

    expect(onRowClick).toHaveBeenCalledWith(mockData[0]);
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

    expect(screen.getByText('30 years')).toBeInTheDocument();
    expect(screen.getByText('25 years')).toBeInTheDocument();
    expect(screen.getByText('35 years')).toBeInTheDocument();
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

    expect(screen.getByText(expected)).toBeInTheDocument();
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

    const container = document.querySelector('.custom-table');
    expect(container).toBeInTheDocument();
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
});
