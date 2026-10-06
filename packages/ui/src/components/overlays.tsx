import { useRef, type ComponentProps, type ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { X } from 'lucide-react';
import { cn } from '../lib/cn';
import { IconButton } from './button';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

function Overlay() {
  return (
    <DialogPrimitive.Overlay
      className="fixed inset-0 z-40 bg-ink/40 backdrop-blur-[1px]"
      style={{ animation: 'pfm-fade-in var(--dur-panel) var(--ease-out)' }}
    />
  );
}

interface ContentProps extends Omit<ComponentProps<typeof DialogPrimitive.Content>, 'title'> {
  title: string;
  description?: string;
  /** Visually hide the title (still announced). */
  hideTitle?: boolean;
}

function Header({
  title,
  description,
  hideTitle,
}: Pick<ContentProps, 'title' | 'description' | 'hideTitle'>) {
  return (
    <div className={cn('flex items-start justify-between gap-4', hideTitle && 'sr-only')}>
      <div>
        <DialogPrimitive.Title className="font-display text-2xl">{title}</DialogPrimitive.Title>
        {description ? (
          <DialogPrimitive.Description className="mt-1 text-[0.8125rem] text-muted">
            {description}
          </DialogPrimitive.Description>
        ) : (
          <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
        )}
      </div>
    </div>
  );
}

function CloseButton() {
  return (
    <DialogPrimitive.Close asChild>
      <IconButton label="Close" size="icon-sm" className="absolute right-3 top-3">
        <X />
      </IconButton>
    </DialogPrimitive.Close>
  );
}

/**
 * Centered dialog on desktop, bottom sheet on phones (thumb-reachable, different interaction model).
 * Focus is trapped and restored by Radix; Esc closes.
 */
/**
 * Dialogs here are opened from state, not from a Radix trigger, so Radix does not know where to send
 * focus when they close. Remember the element that was focused when the dialog first rendered (the
 * button that opened it) and hand focus back to it, so keyboard users are not dropped at the page top.
 */
function useRestoreFocus() {
  const opener = useRef<Element | null>(
    typeof document === 'undefined' ? null : document.activeElement,
  );
  return (event: Event) => {
    const el = opener.current;
    if (el instanceof HTMLElement && el !== document.body && el.isConnected) {
      event.preventDefault();
      el.focus();
    }
  };
}

export function DialogContent({
  title,
  description,
  hideTitle,
  className,
  children,
  ...props
}: ContentProps) {
  const restoreFocus = useRestoreFocus();
  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        onCloseAutoFocus={restoreFocus}
        className={cn(
          'fixed z-50 flex max-h-[92dvh] flex-col gap-5 overflow-y-auto border border-rule bg-surface p-6 shadow-float',
          'inset-x-0 bottom-0 rounded-t-lg pb-[max(1.5rem,env(safe-area-inset-bottom))]',
          'md:inset-x-auto md:bottom-auto md:left-1/2 md:top-1/2 md:w-[min(32rem,calc(100vw-2rem))] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-lg md:pb-6',
          className,
        )}
        style={{ animation: 'pfm-slide-up var(--dur-panel) var(--ease-out)' }}
        {...props}
      >
        <Header
          title={title}
          {...(description ? { description } : {})}
          {...(hideTitle ? { hideTitle } : {})}
        />
        {children}
        <CloseButton />
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/** Right-hand drawer for detail views (account details, transaction detail). Full width on phones. */
export function DrawerContent({
  title,
  description,
  hideTitle,
  className,
  children,
  ...props
}: ContentProps) {
  const restoreFocus = useRestoreFocus();
  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        onCloseAutoFocus={restoreFocus}
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex w-full flex-col gap-5 overflow-y-auto border-l border-rule bg-surface p-6 shadow-float sm:w-[28rem]',
          className,
        )}
        style={{ animation: 'pfm-slide-right var(--dur-panel) var(--ease-out)' }}
        {...props}
      >
        <Header
          title={title}
          {...(description ? { description } : {})}
          {...(hideTitle ? { hideTitle } : {})}
        />
        {children}
        <CloseButton />
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

// ------------------------------------------------------------------ dropdown menu

export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof DropdownPrimitive.Content>) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          'z-50 min-w-48 rounded-md border border-rule bg-surface p-1 shadow-float',
          className,
        )}
        style={{ animation: 'pfm-fade-in var(--dur-micro) var(--ease-out)' }}
        {...props}
      />
    </DropdownPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  destructive,
  ...props
}: ComponentProps<typeof DropdownPrimitive.Item> & { destructive?: boolean }) {
  return (
    <DropdownPrimitive.Item
      className={cn(
        'flex cursor-pointer select-none items-center gap-2 rounded-sm px-2.5 py-2 text-[0.9375rem] outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-sunk [&_svg]:size-4',
        destructive && 'text-loss',
        className,
      )}
      {...props}
    />
  );
}

export const DropdownMenuLabel = ({
  className,
  ...props
}: ComponentProps<typeof DropdownPrimitive.Label>) => (
  <DropdownPrimitive.Label
    className={cn('px-2.5 py-1.5 text-xs text-muted', className)}
    {...props}
  />
);

export const DropdownMenuSeparator = ({
  className,
  ...props
}: ComponentProps<typeof DropdownPrimitive.Separator>) => (
  <DropdownPrimitive.Separator className={cn('my-1 h-px bg-rule', className)} {...props} />
);

// ------------------------------------------------------------------ tooltip

export const TooltipProvider = ({ children }: { children: ReactNode }) => (
  <TooltipPrimitive.Provider delayDuration={300}>{children}</TooltipPrimitive.Provider>
);

/** Supplementary hint only; never the sole carrier of essential information (touch users never see it). */
export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          sideOffset={6}
          className="z-50 rounded-sm bg-ink px-2 py-1 text-xs text-bg"
          style={{ animation: 'pfm-fade-in var(--dur-micro) var(--ease-out)' }}
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
