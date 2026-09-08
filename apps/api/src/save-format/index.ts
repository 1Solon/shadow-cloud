import { createHash } from 'node:crypto';
import { readArchive, rebuildArchive } from './internal/archive';
import { Nrbf, type Value } from './internal/nrbf';
import { SaveFormatError } from './internal/errors';
export { SaveFormatError } from './internal/errors';
export { MAX_ARCHIVE_BYTES } from './internal/archive';

export type SaveInspection = {
  sourceId: string;
  regimes: {
    id: string;
    name: string;
    current: boolean;
    eligible: boolean;
    reason: string | null;
  }[];
};

/** Archive key is operator configuration, never a regime password. */
export function inspectSave(
  bytes: Buffer,
  archiveKey: Uint8Array,
): SaveInspection {
  return analyzeSave(bytes, archiveKey).inspection;
}

function analyzeSave(bytes: Buffer, archiveKey: Uint8Array, regimeId?: string) {
  try {
    const payload = readArchive(bytes, archiveKey);
    const parser = new Nrbf(payload);
    const root = parser.parse();
    const unsupported = (): never => {
      throw new SaveFormatError('unsupported');
    };
    if (root.kind !== 'class' || root.name !== 'WindowsApplication1.DataClass')
      unsupported();
    const field = (obj: Value, name: string): Value => {
      if (obj.kind !== 'class') return unsupported();
      const value = obj.members.get(name);
      return value ? parser.resolve(value) : unsupported();
    };
    const protection = field(root, 'PasswordsOn');
    if (protection.kind !== 'primitive' || protection.type !== 1) unsupported();
    if (protection.kind === 'primitive' && protection.value === false)
      throw new SaveFormatError('disabled');
    const turn = field(root, 'Turn');
    const array = field(root, 'RegimeObj');
    if (turn.kind !== 'primitive' || turn.type !== 8 || array.kind !== 'array')
      return unsupported();
    if (
      array.lengths.length !== 1 ||
      array.lower[0] !== 0 ||
      array.lengths[0] > 10000 ||
      typeof turn.value !== 'number' ||
      turn.value < 0 ||
      turn.value >= array.lengths[0]
    )
      return unsupported();
    const sourceId = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    const passwordOwners = parser.passwordOwners();
    const regimes: SaveInspection['regimes'] = [];
    let target: Extract<Value, { kind: 'string' }> | undefined;
    let index = 0;
    let currentFound = false;
    const seen = new Set<Value>();
    for (const entry of array.values) {
      const obj = parser.resolve(entry);
      if (obj.kind === 'null') {
        index += obj.count;
        continue;
      }
      if (
        obj.kind !== 'class' ||
        obj.name !== 'WindowsApplication1.RegimeClass' ||
        seen.has(obj)
      )
        return unsupported();
      seen.add(obj);
      const ai = field(obj, 'AI');
      if (ai.kind !== 'primitive' || ai.type !== 1) return unsupported();
      if (index === turn.value) currentFound = true;
      if (ai.value === false) {
        const name = field(obj, 'Name');
        if (
          name.kind !== 'string' ||
          passwordOwners.has(name) ||
          !name.value.trim() ||
          name.value.length > 256 ||
          [...name.value].some(
            (character) =>
              character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
          )
        )
          return unsupported();
        const raw = obj.members.get('PassWord');
        const password = raw ? parser.resolve(raw) : undefined;
        if (password && password.kind !== 'null' && password.kind !== 'string')
          return unsupported();
        const present =
          password?.kind === 'string' && password.value.length > 0;
        const shared = password && (passwordOwners.get(password) ?? 0) > 1;
        const eligible = present && !shared;
        const id = createHash('sha256')
          .update(`${sourceId}:regime:${index}`)
          .digest('hex');
        if (id === regimeId && eligible && password?.kind === 'string')
          target = password;
        regimes.push({
          id,
          name: name.value,
          current: index === turn.value,
          eligible,
          reason: eligible
            ? null
            : present && shared
              ? 'This regime shares a serialized password value and cannot be safely reset.'
              : 'This regime has no existing password.',
        });
      }
      index++;
    }
    if (!currentFound || index !== array.lengths[0]) return unsupported();
    return { inspection: { sourceId, regimes }, payload, target };
  } catch (error) {
    if (error instanceof SaveFormatError) throw error;
    // Never expose zlib/decoder errors, serialized names, offsets, or values.
    throw new SaveFormatError('malformed');
  }
}

export function replacePassword(
  bytes: Buffer,
  archiveKey: Uint8Array,
  input: { sourceId: string; regimeId: string; password: string },
): Buffer {
  try {
    const { inspection, payload, target } = analyzeSave(
      bytes,
      archiveKey,
      input.regimeId,
    );
    if (inspection.sourceId !== input.sourceId || !target)
      throw new SaveFormatError('unsupported');
    if (
      typeof input.password !== 'string' ||
      !/^[\x20-\x7e]{1,128}$/.test(input.password)
    )
      throw new SaveFormatError('password');
    const body = Buffer.from(input.password);
    const prefix: number[] = [];
    let length = body.length;
    do {
      prefix.push((length & 127) | (length > 127 ? 128 : 0));
      length >>>= 7;
    } while (length);
    const equalLength = body.length === target.end - target.body;
    const patched = Buffer.concat([
      payload.subarray(0, equalLength ? target.body : target.prefix),
      ...(equalLength ? [] : [Buffer.from(prefix)]),
      body,
      payload.subarray(target.end),
    ]);
    const output = rebuildArchive(bytes, patched, archiveKey);
    const checked = inspectSave(output, archiveKey);
    const metadata = ({ regimes }: SaveInspection) =>
      regimes.map(({ name, current, eligible, reason }) => ({
        name,
        current,
        eligible,
        reason,
      }));
    if (
      JSON.stringify(metadata(checked)) !== JSON.stringify(metadata(inspection))
    )
      throw new SaveFormatError('malformed');
    return output;
  } catch (error) {
    if (error instanceof SaveFormatError) throw error;
    throw new SaveFormatError('malformed');
  }
}
