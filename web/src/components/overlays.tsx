/**
 * Radix dialogs, menus, and tabs with Vietnamese defaults (T031).
 *
 * Thin primitives only: focus trap, Escape, and portal behaviour come from
 * Radix; the app adds styling and fixed Vietnamese titles. Web content that
 * lands inside a dialog is sanitized Markdown (publish/review surfaces use
 * the dedicated SanitizedMarkdown later) — this primitive renders plain text.
 */
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as MenuPrimitive from '@radix-ui/react-dropdown-menu';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import type { ReactNode, ReactElement } from 'react';
import { VI } from '../i18n/vi.js';

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

export interface AppDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly describe?: string;
  readonly children: ReactNode;
}

export function AppDialog(props: AppDialogProps): ReactElement {
  return (
    <DialogPrimitive.Root open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay" />
        <DialogPrimitive.Content className="dialog">
          <DialogPrimitive.Title className="dialog-title">{props.title}</DialogPrimitive.Title>
          {props.describe !== undefined ? (
            <DialogPrimitive.Description className="dialog-desc">
              {props.describe}
            </DialogPrimitive.Description>
          ) : null}
          {props.children}
          <DialogPrimitive.Close asChild>
            <button type="button" className="dialog-close" aria-label={VI.actions.dismiss}>
              ×
            </button>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

export interface MenuItemSpec {
  readonly label: string;
  readonly onSelect: () => void;
  readonly disabled?: boolean;
  readonly destructive?: boolean;
}

export function AppMenu(props: {
  readonly label: string;
  readonly items: readonly MenuItemSpec[];
}): ReactElement {
  return (
    <MenuPrimitive.Root>
      <MenuPrimitive.Trigger asChild>
        <button type="button" className="menu-trigger" aria-haspopup="menu">
          {props.label} ▾
        </button>
      </MenuPrimitive.Trigger>
      <MenuPrimitive.Portal>
        <MenuPrimitive.Content className="menu-content" sideOffset={4}>
          {props.items.map((item) => (
            <MenuPrimitive.Item
              key={item.label}
              className={`menu-item${item.destructive === true ? ' menu-item-destructive' : ''}`}
              disabled={item.disabled ?? false}
              onSelect={item.onSelect}
            >
              {item.label}
            </MenuPrimitive.Item>
          ))}
        </MenuPrimitive.Content>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Root>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

export interface TabSpec {
  readonly value: string;
  readonly label: string;
  readonly content: ReactNode;
}

export function AppTabs(props: {
  readonly defaultValue: string;
  readonly tabs: readonly TabSpec[];
}): ReactElement {
  return (
    <TabsPrimitive.Root defaultValue={props.defaultValue} className="tabs-root">
      <TabsPrimitive.List className="tabs-list">
        {props.tabs.map((tab) => (
          <TabsPrimitive.Trigger key={tab.value} value={tab.value} className="tabs-trigger">
            {tab.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {props.tabs.map((tab) => (
        <TabsPrimitive.Content key={tab.value} value={tab.value} className="tabs-content">
          {tab.content}
        </TabsPrimitive.Content>
      ))}
    </TabsPrimitive.Root>
  );
}
