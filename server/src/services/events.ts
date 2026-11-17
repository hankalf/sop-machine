import { EventEmitter } from 'node:events';
import type { ChecklistRun, CorrectiveAction, Sop, User } from '../../../shared/types';

/** In-process events so features (email, auto-translate) can react to SOP workflow changes. */
interface SopEvents {
  submitted: [sop: Sop, by: User];
  approved: [sop: Sop, by: User, previousVersion: string | null];
  checklistCompleted: [run: ChecklistRun];
  actionReassigned: [action: CorrectiveAction, by: User];
}

class TypedEmitter extends EventEmitter {
  emitSop<K extends keyof SopEvents>(event: K, ...args: SopEvents[K]) {
    return this.emit(event, ...args);
  }
  onSop<K extends keyof SopEvents>(event: K, listener: (...args: SopEvents[K]) => void | Promise<void>) {
    return this.on(event, (...args: SopEvents[K]) => {
      Promise.resolve(listener(...args)).catch((err) => console.error(`[events] ${event} handler failed`, err));
    });
  }
}

export const sopEvents = new TypedEmitter();
