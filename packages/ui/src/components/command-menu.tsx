import type { ReactNode } from 'react';
import { Command } from 'cmdk';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Search } from 'lucide-react';
import { cn } from '../lib/cn';

export interface CommandItem {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Extra search terms ("spending" finds Analytics). */
  keywords?: string[];
  hint?: string;
  /** Quiet text on the right, e.g. a date and amount. */
  detail?: string;
  /** Server results already match the query: never hide them with the local filter. */
  alwaysShow?: boolean;
  onSelect: () => void;
}

export interface CommandGroup {
  heading: string;
  /** A line under the heading (e.g. what a search understood). */
  note?: string;
  items: CommandItem[];
}

export interface CommandMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: CommandGroup[];
  placeholder?: string;
  emptyText?: string;
  /** Controlled input, so callers can fetch results for what is typed. */
  query?: string;
  onQueryChange?: (query: string) => void;
  /** Shown under the list while results are on their way. */
  busy?: boolean;
}

/** ⌘K / "/" launcher. Pure navigation + actions; feature search results are injected as groups. */
export function CommandMenu({
  open,
  onOpenChange,
  groups,
  placeholder = 'Search or jump to…',
  emptyText = 'Nothing matches that yet.',
  query,
  onQueryChange,
  busy = false,
}: CommandMenuProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-40 bg-ink/40"
          style={{ animation: 'pfm-fade-in var(--dur-panel) var(--ease-out)' }}
        />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-[12vh] z-50 w-[min(36rem,calc(100vw-1.5rem))] -translate-x-1/2 overflow-hidden rounded-lg border border-rule bg-surface shadow-float"
          style={{ animation: 'pfm-rise var(--dur-panel) var(--ease-out)' }}
        >
          <DialogPrimitive.Title className="sr-only">Command menu</DialogPrimitive.Title>
          <Command label="Command menu" loop>
            <div className="flex items-center gap-2 border-b border-rule px-4">
              <Search aria-hidden className="size-4 text-muted" />
              <Command.Input
                {...(query !== undefined ? { value: query } : {})}
                {...(onQueryChange ? { onValueChange: onQueryChange } : {})}
                placeholder={placeholder}
                className="h-12 flex-1 bg-transparent outline-none placeholder:text-muted"
              />
            </div>
            <Command.List className="max-h-[50vh] overflow-y-auto p-2">
              {groups.some((g) => g.items.some((i) => i.alwaysShow)) ? null : (
                <Command.Empty className="px-3 py-6 text-center text-muted">
                  {emptyText}
                </Command.Empty>
              )}
              {groups.map((group) => (
                <Command.Group
                  key={group.heading}
                  heading={group.heading}
                  {...(group.items.some((i) => i.alwaysShow) ? { forceMount: true } : {})}
                  className={cn(
                    '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted',
                  )}
                >
                  {group.note ? <p className="px-3 pb-1 text-xs text-muted">{group.note}</p> : null}
                  {group.items.map((item) => (
                    <Command.Item
                      key={item.id}
                      {...(item.alwaysShow ? { forceMount: true } : {})}
                      value={`${item.label} ${(item.keywords ?? []).join(' ')}`}
                      onSelect={() => {
                        onOpenChange(false);
                        item.onSelect();
                      }}
                      className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 data-[selected=true]:bg-sunk [&_svg]:size-4 [&_svg]:text-muted"
                    >
                      {item.icon}
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {item.detail ? (
                        <span className="shrink-0 text-xs text-muted">{item.detail}</span>
                      ) : null}
                      {item.hint ? (
                        <kbd className="rounded-sm border border-rule px-1.5 text-xs text-muted">
                          {item.hint}
                        </kbd>
                      ) : null}
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
            </Command.List>
            <div role="status" aria-live="polite" className="sr-only">
              {busy ? 'Searching…' : ''}
            </div>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
