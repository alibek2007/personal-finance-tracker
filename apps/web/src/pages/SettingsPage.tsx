import { useState } from 'react';
import {
  Button,
  Field,
  SegmentedControl,
  Select,
  toast,
  useTheme,
  type ThemePreference,
} from '@pfm/ui';
import { CURRENCIES, CURRENCY_CODES, type CurrencyCode } from '@pfm/finance';
import { useCurrentUser, useUpdateProfile } from '../lib/auth';
import { ApiError } from '../lib/api';
import { CategoriesManager } from '../features/settings/CategoriesManager';
import { DataSection } from '../features/data/DataSection';

const THEMES = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Match system' },
] as const;

function timezones(current: string): string[] {
  try {
    const all = Intl.supportedValuesOf('timeZone');
    return all.includes(current) ? all : [current, ...all];
  } catch {
    return [current];
  }
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-6 border-t border-rule py-8 md:grid-cols-[14rem_minmax(0,1fr)]">
      <div>
        <h2 className="font-display text-xl">{title}</h2>
        <p className="mt-1 text-[0.8125rem] text-muted">{description}</p>
      </div>
      <div>{children}</div>
    </section>
  );
}

export function SettingsPage() {
  const user = useCurrentUser();
  const { preference, setPreference } = useTheme();
  const update = useUpdateProfile();
  const [currency, setCurrency] = useState<CurrencyCode>(user.currency);
  const [timezone, setTimezone] = useState(user.timezone);
  const dirty = currency !== user.currency || timezone !== user.timezone;

  async function save() {
    try {
      await update.mutateAsync({ currency, timezone });
      toast.success('Settings saved');
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : "Couldn't save your settings. Check your connection and try again.",
      );
    }
  }

  return (
    <div>
      <h1 className="font-display text-4xl">Settings</h1>
      <div className="mt-8">
        <Section title="Appearance" description="Applies on this device only.">
          <SegmentedControl
            label="Theme"
            options={THEMES}
            value={preference}
            onChange={(value) => setPreference(value as ThemePreference)}
          />
        </Section>
        <Section
          title="Money and time"
          description="Your main currency drives totals. Your timezone decides where one day ends and the next begins."
        >
          <form
            className="grid max-w-xl gap-5 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <Field label="Main currency" hint="Existing accounts keep their own currency.">
              <Select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
              >
                {CURRENCY_CODES.map((code) => (
                  <option key={code} value={code}>
                    {code} · {CURRENCIES[code].name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Timezone">
              <Select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                {timezones(user.timezone).map((tz) => (
                  <option key={tz} value={tz}>
                    {tz.replace(/_/g, ' ')}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit" loading={update.isPending} disabled={!dirty}>
                Save changes
              </Button>
            </div>
          </form>
        </Section>
        <Section
          title="Categories"
          description="How your spending and income are grouped. Archive instead of deleting to keep your history."
        >
          <CategoriesManager />
        </Section>
        <Section
          title="Your data"
          description="Your transactions are yours: take a copy any time, or bring in a bank statement."
        >
          <DataSection />
        </Section>
      </div>
    </div>
  );
}
