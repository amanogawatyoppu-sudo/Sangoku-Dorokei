type Handler<E> = (ev: E) => void;

/** Minimal typed event bus keyed by the `type` field of the event union. */
export class EventBus<E extends { type: string }> {
  private handlers = new Map<string, Handler<E>[]>();

  on<T extends E['type']>(type: T, fn: Handler<Extract<E, { type: T }>>): void {
    const list = this.handlers.get(type) ?? [];
    list.push(fn as Handler<E>);
    this.handlers.set(type, list);
  }

  emit(ev: E): void {
    for (const fn of this.handlers.get(ev.type) ?? []) fn(ev);
  }
}
