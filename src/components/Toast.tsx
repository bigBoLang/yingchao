import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

const ToastContext = createContext<{
  push: (message: string, type?: ToastType) => void;
} | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((message: string, type: ToastType = 'info') => {
    const id = nextId++;
    setItems((current) => [...current, { id, message, type }]);
    window.setTimeout(() => {
      setItems((current) => current.filter((item) => item.id !== id));
    }, 4200);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {items.map((item) => {
          const Icon =
            item.type === 'success' ? CheckCircle2 : item.type === 'error' ? AlertTriangle : Info;
          return (
            <div key={item.id} className={`toast toast-${item.type}`}>
              <Icon size={18} />
              <span>{item.message}</span>
              <button
                type="button"
                onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}
                aria-label="关闭提示"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}
