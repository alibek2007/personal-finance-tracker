import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { money } from '@pfm/finance';
import { Amount } from './amount';
import { IconButton } from './button';
import { Field, Input } from './field';
import { MoneyInput } from './money-input';
import { BudgetProgress, GoalProgress } from './progress';
import { SegmentedControl } from './segmented';

const usd = (minor: number) => money(minor, 'USD');

describe('Amount', () => {
  it('shows an explicit sign for income and expense (never color alone)', () => {
    const { container } = render(
      <>
        <Amount money={usd(480000)} kind="income" />
        <Amount money={usd(2930)} kind="expense" />
      </>,
    );
    expect(container).toHaveTextContent('+$4,800.00');
    expect(container).toHaveTextContent('−$29.30');
    expect(screen.getByText(/Income:/)).toHaveClass('sr-only');
    expect(screen.getByText(/Expense:/)).toHaveClass('sr-only');
  });

  it('treats an expense magnitude and a negative neutral value the same way', () => {
    const { container } = render(
      <>
        <Amount money={usd(-82000)} />
        <Amount money={usd(-500)} kind="expense" />
      </>,
    );
    expect(container).toHaveTextContent('−$820.00');
    expect(container).toHaveTextContent('−$5.00');
  });

  it('uses tabular numerals', () => {
    render(<Amount money={usd(100)} />);
    expect(screen.getByText('$1.00')).toHaveClass('num');
  });
});

describe('MoneyInput', () => {
  function Harness({ initial = null }: { initial?: number | null }) {
    const [value, setValue] = useState<number | null>(initial);
    return (
      <>
        <Field label="Amount">
          <MoneyInput value={value} onChange={setValue} currency="USD" />
        </Field>
        <output data-testid="minor">{value === null ? 'null' : value}</output>
      </>
    );
  }

  it('turns typed text into exact minor units', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText('Amount'), '19.99');
    expect(screen.getByTestId('minor')).toHaveTextContent('1999');
  });

  it('accepts thousands separators and pasted currency symbols', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText('Amount'), '$1,234.5');
    expect(screen.getByTestId('minor')).toHaveTextContent('123450');
  });

  it('reports null for empty or unparseable input and blocks excess precision', async () => {
    const user = userEvent.setup();
    render(<Harness initial={500} />);
    const input = screen.getByLabelText('Amount');
    expect(input).toHaveValue('5.00');
    await user.clear(input);
    expect(screen.getByTestId('minor')).toHaveTextContent('null');
    await user.type(input, '1.999');
    expect(screen.getByTestId('minor')).toHaveTextContent('null');
  });

  it('normalises to two decimals on blur', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText('Amount');
    await user.type(input, '7.5');
    await user.tab();
    expect(input).toHaveValue('7.50');
  });

  it('rejects a leading minus unless negatives are allowed', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText('Amount'), '-12');
    expect(screen.getByTestId('minor')).toHaveTextContent('1200');
  });
});

describe('Field', () => {
  it('links label, hint and error to the control', () => {
    render(
      <Field label="Description" error="Add a short description">
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText('Description');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Add a short description');
    expect(screen.getByRole('alert')).toHaveTextContent('Add a short description');
  });
});

describe('IconButton', () => {
  it('always has an accessible name', () => {
    render(<IconButton label="Close">x</IconButton>);
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });
});

describe('BudgetProgress', () => {
  it('states remaining money in words', () => {
    render(<BudgetProgress name="Food" spent={usd(32000)} limit={usd(50000)} />);
    expect(screen.getByText('$180 left')).toBeInTheDocument();
    expect(screen.getByText('64% used')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Food budget, 64% used' })).toHaveAttribute(
      'aria-valuenow',
      '64',
    );
  });

  it('flags an overspent budget without relying on colour', () => {
    render(<BudgetProgress name="Shopping" spent={usd(23400)} limit={usd(20000)} />);
    expect(screen.getByText(/Over by \$34/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });

  it('survives a zero limit', () => {
    render(<BudgetProgress name="Other" spent={usd(0)} limit={usd(0)} />);
    expect(screen.getByText('0% used')).toBeInTheDocument();
  });
});

describe('GoalProgress', () => {
  it('shows percent and detail, and celebrates completion in text', () => {
    const { rerender } = render(
      <GoalProgress name="Laptop" current={usd(120000)} target={usd(200000)} detail="$267/month" />,
    );
    expect(screen.getByText('60%')).toBeInTheDocument();
    expect(screen.getByText('$267/month')).toBeInTheDocument();
    rerender(<GoalProgress name="Laptop" current={usd(200000)} target={usd(200000)} />);
    expect(screen.getByText(/Goal reached/)).toBeInTheDocument();
  });
});

describe('SegmentedControl', () => {
  it('is a radio group with keyboard support and accessible names', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SegmentedControl
        label="Date range"
        value="7d"
        onChange={onChange}
        options={[
          { value: '7d', label: '7D', ariaLabel: 'Last 7 days' },
          { value: '30d', label: '30D', ariaLabel: 'Last 30 days' },
        ]}
      />,
    );
    expect(screen.getByRole('radiogroup', { name: 'Date range' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Last 7 days' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Last 30 days' }));
    expect(onChange).toHaveBeenCalledWith('30d');
  });
});
