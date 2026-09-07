export class SaveFormatError extends Error {
  constructor(
    public readonly code:
      'unsupported' | 'malformed' | 'limit' | 'disabled' | 'password',
  ) {
    super(
      {
        unsupported: 'Unsupported save format.',
        malformed: 'The save is malformed or failed its integrity check.',
        limit: 'The save exceeds safe inspection limits.',
        disabled: 'Password protection is disabled for this save.',
        password: 'Use 1 to 128 printable ASCII characters.',
      }[code],
    );
  }
}
export function requireFormat(condition: unknown): asserts condition {
  if (!condition) throw new SaveFormatError('malformed');
}
export function bounded(value: number, max: number) {
  requireFormat(Number.isSafeInteger(value) && value >= 0);
  if (value > max) throw new SaveFormatError('limit');
  return value;
}
