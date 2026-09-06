/** Minimal @angular/core stub for Node execution of framework-free service logic. */
export function Injectable(_opts?: unknown): ClassDecorator {
  return () => {};
}
export function Component(_opts?: unknown): ClassDecorator {
  return () => {};
}
export function inject(_token?: unknown): never {
  throw new Error('inject() is not available in this test harness');
}
export function OnInit(): void {}
