/**
 * Toast provider (T031).
 *
 * Radix toasts wrapped in a `useToast()` imperative hook so any slice can
 * show success/failure feedback with Vietnamese copy and aria-live output.
 */
import { createContext, useContext, useState, type ReactElement, type ReactNode } from 'react';
import * as ToastPrimitive from '@radix-ui/react-toast';
import { VI } from '../i18n/vi.js';

export interface ToastRequest {
  readonly title: string;
  readonly body?: string;
  readonly kind: 'success' | 'error' | 'info';
}

interface ToastValues {
  readonly show: (request: ToastRequest) => void;
}

const ToastContext = createContext<ToastValues>({ show: () => undefined });

export function useToast(): ToastValues {
  return useContext(ToastContext);
}

export function ToastProvider(props: { readonly children: ReactNode }): ReactElement {
  const [requests, setRequests] = useState<readonly ToastRequest[]>([]);
  const value: ToastValues = {
    show: (request) => {
      setRequests((previous) => [...previous, request]);
    },
  };
  const remove = (index: number): void =>
    setRequests((previous) => previous.filter((_, position) => position !== index));

  return (
    <ToastContext.Provider value={value}>
      <ToastPrimitive.Provider swipeDirection="right" duration={8000}>
        {props.children}
        {requests.map((request, index) => (
          <ToastPrimitive.Root
            key={`${request.title}-${index}`}
            className={`toast toast-${request.kind}`}
            onOpenChange={(open) => {
              if (!open) remove(index);
            }}
          >
            <ToastPrimitive.Title className="toast-title">{request.title}</ToastPrimitive.Title>
            {request.body !== undefined ? (
              <ToastPrimitive.Description className="toast-body">
                {request.body}
              </ToastPrimitive.Description>
            ) : null}
            <ToastPrimitive.Close asChild aria-label={VI.actions.dismiss}>
              <button type="button" className="toast-close">
                ×
              </button>
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        ))}
        <ToastPrimitive.Viewport className="toast-viewport" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}
