import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RichText } from './RichText';

describe('RichText', () => {
  it('renders plain text as a paragraph', () => {
    render(<RichText text="نص بسيط" />);
    expect(screen.getByText('نص بسيط')).toBeInTheDocument();
  });

  it('renders bold and italic inline formatting', () => {
    render(<RichText text="إجمالي **1,500** ر.ي و *هامش* جيد" />);
    expect(screen.getByText('1,500')).toBeInTheDocument();
    expect(screen.getByText('هامش')).toBeInTheDocument();
    expect(screen.getByText('1,500').tagName).toBe('STRONG');
    expect(screen.getByText('هامش').tagName).toBe('EM');
  });

  it('renders inline code without markers', () => {
    render(<RichText text="استخدم `update_lead_status` للأمر" />);
    expect(screen.getByText('update_lead_status')).toBeInTheDocument();
    expect(screen.getByText('update_lead_status').tagName).toBe('CODE');
  });

  it('renders headings with the correct tag', () => {
    render(<RichText text={'## عنوان ثانوي\n### عنوان ثالث'} />);
    expect(screen.getByRole('heading', { name: 'عنوان ثانوي' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'عنوان ثالث' })).toBeInTheDocument();
  });

  it('renders bullet and numbered lists', () => {
    render(<RichText text={'- بند أول\n- بند ثانٍ\n1. رقم واحد\n2. رقم اثنان'} />);
    expect(screen.getByText('بند أول')).toBeInTheDocument();
    expect(screen.getByText('بند ثانٍ')).toBeInTheDocument();
    expect(screen.getByText('رقم واحد')).toBeInTheDocument();
    expect(screen.getByText('رقم اثنان')).toBeInTheDocument();
    expect(screen.getAllByRole('list')).toHaveLength(2);
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
  });

  it('renders a pipe table with headers and rows', () => {
    const md = '| الحساب | الرصيد |\n| --- | --- |\n| النقدية | 500 |\n| الموردون | 200 |';
    render(<RichText text={md} />);
    expect(screen.getByText('الحساب')).toBeInTheDocument();
    expect(screen.getByText('النقدية')).toBeInTheDocument();
    expect(screen.getByText('الموردون')).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('الرصيد')).toBeInTheDocument();
  });

  it('renders a fenced code block', () => {
    render(<RichText text={'```\nSELECT * FROM companies;\n```'} />);
    expect(screen.getByText('SELECT * FROM companies;')).toBeInTheDocument();
  });

  it('renders a blockquote', () => {
    render(<RichText text="> اقتباس توضيحي" />);
    expect(screen.getByText('اقتباس توضيحي')).toBeInTheDocument();
    expect(screen.getByText('اقتباس توضيحي').closest('blockquote')).not.toBeNull();
  });

  it('falls back to a paragraph for a malformed table row', () => {
    render(<RichText text="| عمود وحيد" />);
    expect(screen.getByText('| عمود وحيد')).toBeInTheDocument();
  });
});
