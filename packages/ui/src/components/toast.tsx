import { Toaster as Sonner, toast } from 'sonner';
import { useTheme } from '../theme';

export { toast };

/** Themed toast host. Mount once near the root; call `toast.success(...)` / `toast.error(...)`. */
export function Toaster() {
  const { resolved } = useTheme();
  return (
    <Sonner
      theme={resolved}
      position="bottom-center"
      offset={{ bottom: 88 }}
      mobileOffset={{ bottom: 88 }}
      toastOptions={{
        style: {
          background: 'var(--surface)',
          color: 'var(--ink)',
          border: '1px solid var(--rule-strong)',
          borderRadius: 'var(--r-md)',
          fontFamily: 'var(--font-ui)',
          boxShadow: 'var(--shadow-float)',
        },
      }}
    />
  );
}
