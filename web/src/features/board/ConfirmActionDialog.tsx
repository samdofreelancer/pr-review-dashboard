/**
 * Destructive-action confirmation dialog (T050) on the shared AppDialog.
 *
 * Every board write that is hard to undo (disconnect, mark-ready, publish)
 * goes through one component so confirmation behaviour stays uniform and
 * testable; the confirm button never re-dispatches while `busy`.
 */
import type { ReactElement } from 'react';
import { AppDialog } from '../../components/overlays.js';
import { VI } from '../../i18n/vi.js';

export interface ConfirmActionDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description?: string;
  readonly confirmLabel?: string;
  readonly destructive?: boolean;
  readonly busy?: boolean;
  readonly onConfirm: () => void;
}

export function ConfirmActionDialog(props: ConfirmActionDialogProps): ReactElement {
  return (
    <AppDialog open={props.open} onOpenChange={props.onOpenChange} title={props.title}>
      {props.description !== undefined ? <p className="dialog-desc">{props.description}</p> : null}
      <div className="dialog-actions">
        <button type="button" className="button" onClick={() => props.onOpenChange(false)}>
          {VI.actions.cancel}
        </button>
        <button
          type="button"
          className={`button${props.destructive === true ? ' button-danger' : ' button-primary'}`}
          disabled={props.busy}
          onClick={props.onConfirm}
        >
          {props.confirmLabel ?? VI.actions.confirm}
        </button>
      </div>
    </AppDialog>
  );
}
