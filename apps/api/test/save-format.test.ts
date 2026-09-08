import { describe, expect, it } from 'vitest';
import { inspectSave, replacePassword } from '../src/save-format';
import {
  archiveKey,
  syntheticArchive,
  syntheticPayload,
} from './support/synthetic-save';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const integer = (n: number) => {
  const bytes = Buffer.alloc(4);
  bytes.writeInt32LE(n);
  return bytes;
};
const text = (value: string) =>
  Buffer.concat([Buffer.from([value.length]), Buffer.from(value)]);
const reference = (id: number) =>
  Buffer.concat([Buffer.from([9]), integer(id)]);
const probeString = Buffer.concat([
  Buffer.from([6]),
  integer(301),
  text('probe'),
]);
const probeClass = (name: string, system = false) =>
  Buffer.concat([
    Buffer.from([system ? 4 : 5]),
    integer(301),
    text(name),
    integer(0),
    ...(system ? [] : [integer(1)]),
  ]);
const probeArray = (tag: number, primitive?: number) =>
  Buffer.concat([
    Buffer.from([tag]),
    integer(301),
    integer(0),
    ...(primitive === undefined ? [] : [Buffer.from([primitive])]),
  ]);

function typedProbe(
  type: number,
  info: Buffer,
  target: Buffer,
  mode: 'inline' | 'forward' | 'backward',
  array: boolean,
) {
  const declaration = array
    ? Buffer.concat([
        Buffer.from([7]),
        integer(300),
        Buffer.from([0]),
        integer(1),
        integer(1),
        Buffer.from([type]),
        info,
      ])
    : Buffer.concat([
        Buffer.from([5]),
        integer(300),
        text('Probe'),
        integer(1),
        text('Value'),
        Buffer.from([type]),
        info,
        integer(1),
      ]);
  return syntheticArchive(
    Buffer.concat([
      syntheticPayload().subarray(0, -1),
      ...(mode === 'backward' ? [target] : []),
      declaration,
      mode === 'inline' ? target : reference(301),
      ...(mode === 'forward' ? [target] : []),
      Buffer.from([11]),
    ]),
  );
}

describe('save-format inspection', () => {
  it('rejects invalid Boolean elements in compact primitive arrays', () => {
    const source = syntheticArchive(
      Buffer.concat([
        syntheticPayload().subarray(0, -1),
        Buffer.from([15]),
        integer(300),
        integer(3),
        Buffer.from([1, 0, 2, 1, 11]),
      ]),
    );
    expect(() => inspectSave(source, archiveKey)).toThrow(
      'The save is malformed or failed its integrity check.',
    );
    expect(() =>
      replacePassword(source, archiveKey, {
        sourceId: 'unused',
        regimeId: 'unused',
        password: 'Replacement',
      }),
    ).toThrow('The save is malformed or failed its integrity check.');
  });
  it.each([3, 5])(
    'rejects primitive type %s arrays without expanding millions of elements',
    (type) => {
      for (const count of [2_000_000, 0]) {
        const body =
          type === 3
            ? Buffer.alloc(count, 65)
            : Buffer.alloc(count * 2, Buffer.from([1, 48]));
        for (const header of [
          Buffer.concat([
            Buffer.from([15]),
            integer(300),
            integer(count),
            Buffer.from([type]),
          ]),
          Buffer.concat([
            Buffer.from([7]),
            integer(300),
            Buffer.from([0]),
            integer(1),
            integer(count),
            Buffer.from([0, type]),
          ]),
        ]) {
          const source = syntheticArchive(
            Buffer.concat([
              syntheticPayload().subarray(0, -1),
              header,
              body,
              Buffer.from([11]),
            ]),
          );
          expect(() => inspectSave(source, archiveKey)).toThrow(
            'Unsupported save format.',
          );
          expect(() =>
            replacePassword(source, archiveKey, {
              sourceId: 'unused',
              regimeId: 'unused',
              password: 'Replacement',
            }),
          ).toThrow('Unsupported save format.');
          if (count > 0) {
            expect(
              execFileSync(
                process.execPath,
                [
                  '--max-old-space-size=96',
                  '-r',
                  'ts-node/register/transpile-only',
                  '-e',
                  `
              const { inspectSave, replacePassword } = require('./src/save-format');
              const { readFileSync } = require('node:fs');
              const assert = require('node:assert/strict');
              const input = readFileSync(0);
              const key = input.subarray(0, 24);
              const source = input.subarray(24);
              assert.throws(() => inspectSave(source, key), { message: 'Unsupported save format.' });
              assert.throws(() => replacePassword(source, key, {
                sourceId: 'unused', regimeId: 'unused', password: 'Replacement',
              }), { message: 'Unsupported save format.' });
              process.stdout.write('bounded');
            `,
                ],
                { input: Buffer.concat([archiveKey, source]), timeout: 15_000 },
              ).toString(),
            ).toBe('bounded');
          }
        }
      }
    },
  );
  it('preserves typed regime arrays and metadata reuse through inspection and replacement', () => {
    const payload = syntheticPayload({ reuseMetadata: true });
    const declaration = Buffer.from([0, 0, 2, 1, 8, 1, 0, 0, 0]);
    const memberOffset = payload.indexOf(declaration);
    const arrayOffset = payload.indexOf(
      Buffer.from([16, 2, 0, 0, 0, 4, 0, 0, 0]),
    );
    expect(memberOffset).toBeGreaterThan(0);
    expect(arrayOffset).toBeGreaterThan(memberOffset);
    const source = syntheticArchive(
      Buffer.concat([
        payload.subarray(0, memberOffset),
        Buffer.from([0, 0, 4, 1, 8]),
        text('WindowsApplication1.RegimeClass[]'),
        integer(1),
        payload.subarray(memberOffset + 5, arrayOffset),
        Buffer.from([7]),
        integer(2),
        Buffer.from([0]),
        integer(1),
        integer(4),
        Buffer.from([4]),
        text('WindowsApplication1.RegimeClass'),
        integer(1),
        payload.subarray(arrayOffset + 9),
      ]),
    );
    const inspection = inspectSave(source, archiveKey);
    expect(inspection.regimes).toHaveLength(2);
    const output = replacePassword(source, archiveKey, {
      sourceId: inspection.sourceId,
      regimeId: inspection.regimes[0].id,
      password: 'Replacement',
    });
    expect(
      inspectSave(output, archiveKey).regimes.map(
        ({ id, ...regime }) => regime,
      ),
    ).toEqual(inspection.regimes.map(({ id, ...regime }) => regime));
  });
  it.each([
    {
      type: 1,
      info: Buffer.alloc(0),
      good: probeString,
      bad: probeClass('Probe'),
    },
    {
      type: 3,
      info: text('System.Probe'),
      good: probeClass('System.Probe', true),
      bad: probeClass('System.Other', true),
    },
    {
      type: 4,
      info: Buffer.concat([text('Probe'), integer(1)]),
      good: probeClass('Probe'),
      bad: probeClass('Other'),
    },
    { type: 5, info: Buffer.alloc(0), good: probeArray(16), bad: probeString },
    {
      type: 6,
      info: Buffer.alloc(0),
      good: probeArray(17),
      bad: probeArray(16),
    },
    {
      type: 7,
      info: Buffer.from([8]),
      good: probeArray(15, 8),
      bad: probeArray(15, 2),
    },
    {
      type: 3,
      info: text('System.Int32[]'),
      good: probeArray(15, 8),
      bad: probeArray(15, 2),
    },
  ])(
    'validates declared type $type for inline and resolved members and array elements (%#)',
    ({ type, info, good, bad }) => {
      for (const array of [false, true]) {
        for (const mode of ['inline', 'forward', 'backward'] as const) {
          expect(
            inspectSave(typedProbe(type, info, good, mode, array), archiveKey)
              .regimes,
          ).toHaveLength(2);
          const source = typedProbe(type, info, bad, mode, array);
          const before = Buffer.from(source);
          const sourceId = `sha256:${createHash('sha256').update(source).digest('hex')}`;
          expect(() => inspectSave(source, archiveKey)).toThrow(
            'The save is malformed or failed its integrity check.',
          );
          expect(() =>
            replacePassword(source, archiveKey, {
              sourceId,
              regimeId: createHash('sha256')
                .update(`${sourceId}:regime:1`)
                .digest('hex'),
              password: 'Replacement',
            }),
          ).toThrow('The save is malformed or failed its integrity check.');
          expect(source).toEqual(before);
        }
      }
    },
  );
  it('rejects a string array containing regime references at both public boundaries', () => {
    const payload = syntheticPayload();
    const header = Buffer.from([16, 2, 0, 0, 0, 4, 0, 0, 0]);
    const offset = payload.indexOf(header);
    expect(offset).toBeGreaterThan(0);
    payload[offset] = 17;
    const source = syntheticArchive(payload);
    const before = Buffer.from(source);
    const sourceId = `sha256:${createHash('sha256').update(source).digest('hex')}`;
    expect(() => inspectSave(source, archiveKey)).toThrow(
      'The save is malformed or failed its integrity check.',
    );
    expect(() =>
      replacePassword(source, archiveKey, {
        sourceId,
        regimeId: createHash('sha256')
          .update(`${sourceId}:regime:1`)
          .digest('hex'),
        password: 'Replacement',
      }),
    ).toThrow('The save is malformed or failed its integrity check.');
    expect(source).toEqual(before);
  });
  it('preserves unrelated bytes when the old serialized value begins with a Unicode BOM', () => {
    const payload = syntheticPayload({ secret: '\ufeffold' });
    const source = syntheticArchive(payload);
    const inspection = inspectSave(source, archiveKey);
    const output = replacePassword(source, archiveKey, {
      sourceId: inspection.sourceId,
      regimeId: inspection.regimes[0].id,
      password: 'abcdef',
    });
    const decoded = execFileSync(
      'python',
      [
        '-c',
        'import sys,io,zipfile; b=sys.stdin.buffer.read(); z=zipfile.ZipFile(io.BytesIO(b[24:])); sys.stdout.buffer.write(z.read(z.infolist()[0],pwd=b[:24]))',
      ],
      { input: Buffer.concat([archiveKey, output]) },
    );
    expect(decoded).toEqual(
      Buffer.concat([
        payload.subarray(0, -7),
        Buffer.from('abcdef'),
        Buffer.from([11]),
      ]),
    );
  });
  it('rejects stale identities, shared ownership, missing passwords and AI identities without mutating input', () => {
    for (const password of ['shared', 'null', 'absent'] as const) {
      const source = syntheticArchive(syntheticPayload({ password }));
      const before = Buffer.from(source);
      const inspection = inspectSave(source, archiveKey);
      expect(() =>
        replacePassword(source, archiveKey, {
          sourceId: inspection.sourceId,
          regimeId: inspection.regimes[0].id,
          password: 'NewSecret',
        }),
      ).toThrow();
      expect(source).toEqual(before);
    }
    const source = syntheticArchive();
    const inspection = inspectSave(source, archiveKey);
    for (const regimeId of [
      'invalid',
      createHash('sha256')
        .update(`${inspection.sourceId}:regime:3`)
        .digest('hex'),
    ]) {
      expect(() =>
        replacePassword(source, archiveKey, {
          sourceId: inspection.sourceId,
          regimeId,
          password: 'NewSecret',
        }),
      ).toThrow();
    }
    expect(() =>
      replacePassword(syntheticArchive(), archiveKey, {
        sourceId: inspection.sourceId,
        regimeId: inspection.regimes[0].id,
        password: 'NewSecret',
      }),
    ).toThrow();
  });
  it.each(['x', 'B'.repeat(128)])(
    'preserves every unrelated byte for variable-length replacement (%#)',
    (password) => {
      const payload = syntheticPayload();
      const source = syntheticArchive(payload);
      const inspection = inspectSave(source, archiveKey);
      const output = replacePassword(source, archiveKey, {
        sourceId: inspection.sourceId,
        regimeId: inspection.regimes[0].id,
        password,
      });
      const decoded = execFileSync(
        'python',
        [
          '-c',
          'import sys,io,zipfile; b=sys.stdin.buffer.read(); z=zipfile.ZipFile(io.BytesIO(b[24:])); sys.stdout.buffer.write(z.read(z.infolist()[0],pwd=b[:24]))',
        ],
        { input: Buffer.concat([archiveKey, output]) },
      );
      const prefix =
        password.length === 128 ? Buffer.from([128, 1]) : Buffer.from([1]);
      expect(decoded).toEqual(
        Buffer.concat([
          payload.subarray(0, -26),
          prefix,
          Buffer.from(password),
          Buffer.from([11]),
        ]),
      );
    },
  );
  it.each(['', 'line\nbreak', '\u00e9', 'x'.repeat(129), '\ud800'])(
    'rejects unsupported replacement input without echoing it (%#)',
    (password) => {
      const source = syntheticArchive();
      const inspection = inspectSave(source, archiveKey);
      expect(() =>
        replacePassword(source, archiveKey, {
          sourceId: inspection.sourceId,
          regimeId: inspection.regimes[0].id,
          password,
        }),
      ).toThrow('Use 1 to 128 printable ASCII characters.');
    },
  );
  it('replaces only the selected string body and produces independently valid encrypted ZIP bytes', () => {
    const payload = syntheticPayload();
    const source = syntheticArchive(payload);
    const inspection = inspectSave(source, archiveKey);
    const replacement = 'ReplacementValue12345678';
    const output = replacePassword(source, archiveKey, {
      sourceId: inspection.sourceId,
      regimeId: inspection.regimes[0].id,
      password: replacement,
    });
    const decoded = execFileSync(
      'python',
      [
        '-c',
        'import sys,io,zipfile; b=sys.stdin.buffer.read(); z=zipfile.ZipFile(io.BytesIO(b[24:])); sys.stdout.buffer.write(z.read(z.infolist()[0],pwd=b[:24]))',
      ],
      { input: Buffer.concat([archiveKey, output]) },
    );
    // Fixture's final record is an independently known 24-byte string, then MessageEnd.
    expect(decoded.subarray(0, -25)).toEqual(payload.subarray(0, -25));
    expect(decoded.subarray(-25, -1).toString()).toBe(replacement);
    expect(decoded.subarray(-1)).toEqual(payload.subarray(-1));
    expect(
      inspectSave(output, archiveKey).regimes.map(({ id, ...r }) => r),
    ).toEqual(inspection.regimes.map(({ id, ...r }) => r));
  });
  it('lists human regimes with byte-scoped identity and current marker, never password data', () => {
    const bytes = syntheticArchive();
    const result = inspectSave(bytes, archiveKey);
    expect(result).toEqual({
      sourceId: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      regimes: [
        {
          id: expect.any(String),
          name: 'North Reach',
          current: false,
          eligible: true,
          reason: null,
        },
        {
          id: expect.any(String),
          name: 'South Reach',
          current: true,
          eligible: false,
          reason: 'This regime has no existing password.',
        },
      ],
    });
    expect(inspectSave(bytes, archiveKey)).toEqual(result);
    expect(inspectSave(syntheticArchive(), archiveKey)).not.toEqual(result);
  });
  it('rejects unsupported bytes without echoing their contents', () => {
    expect(() =>
      inspectSave(Buffer.from('not a save'), Buffer.alloc(16)),
    ).toThrow('Unsupported save format.');
  });
  it.each(['null', 'absent'] as const)(
    'marks %s passwords ineligible',
    (password) => {
      const result = inspectSave(
        syntheticArchive(syntheticPayload({ password })),
        archiveKey,
      );
      expect(result.regimes.every((regime) => !regime.eligible)).toBe(true);
    },
  );
  it('rejects globally disabled protection', () => {
    expect(() =>
      inspectSave(
        syntheticArchive(syntheticPayload({ protection: false })),
        archiveKey,
      ),
    ).toThrow('Password protection is disabled for this save.');
  });
  it('does not offer a shared serialized password as a safe reset target', () => {
    const result = inspectSave(
      syntheticArchive(syntheticPayload({ password: 'shared' })),
      archiveKey,
    );
    expect(result.regimes.every((regime) => !regime.eligible)).toBe(true);
    expect(result.regimes[0].reason).toBe(
      'This regime shares a serialized password value and cannot be safely reset.',
    );
  });
  it('rejects unresolved references, truncated/trailing streams and unknown root layouts', () => {
    for (const payload of [
      syntheticPayload({ dangling: true }),
      syntheticPayload().subarray(0, -1),
      Buffer.concat([syntheticPayload(), Buffer.from([10])]),
    ]) {
      expect(() => inspectSave(syntheticArchive(payload), archiveKey)).toThrow(
        'The save is malformed or failed its integrity check.',
      );
    }
    expect(() =>
      inspectSave(
        syntheticArchive(syntheticPayload({ rootClass: 'Unknown' })),
        archiveKey,
      ),
    ).toThrow('Unsupported save format.');
  });
  it('rejects corrupted encryption, CRC and inconsistent directory metadata', () => {
    const original = syntheticArchive();
    for (const offset of [45, original.length - 30, original.length - 8]) {
      const bytes = Buffer.from(original);
      bytes[offset] ^= 1;
      expect(() => inspectSave(bytes, archiveKey)).toThrow();
    }
    expect(() => inspectSave(original, Buffer.alloc(16))).toThrow(
      'The save is malformed or failed its integrity check.',
    );
  });
  it('bounds compressed input and advertised archive expansion', () => {
    expect(() =>
      inspectSave(Buffer.alloc(25 * 1024 * 1024 + 1), archiveKey),
    ).toThrow('The save exceeds safe inspection limits.');
    const bytes = syntheticArchive();
    const central = bytes.readUInt32LE(bytes.length - 6);
    bytes.writeUInt32LE(64 * 1024 * 1024 + 1, central + 24);
    expect(() => inspectSave(bytes, archiveKey)).toThrow(
      'The save exceeds safe inspection limits.',
    );
  });
  it('uses fixtures independently decryptable with Python ZIP/CRC validation', () => {
    const payload = syntheticPayload();
    const digest = execFileSync(
      'python',
      [
        '-c',
        'import sys,io,zipfile,hashlib; b=sys.stdin.buffer.read(); z=zipfile.ZipFile(io.BytesIO(b[24:])); sys.stdout.write(hashlib.sha256(z.read(z.infolist()[0],pwd=b[:24])).hexdigest())',
      ],
      { input: Buffer.concat([archiveKey, syntheticArchive(payload)]) },
    ).toString();
    expect(digest).toBe(createHash('sha256').update(payload).digest('hex'));
  });
  it('resolves reused class metadata and rejects names aliasing password objects', () => {
    expect(
      inspectSave(
        syntheticArchive(syntheticPayload({ reuseMetadata: true })),
        archiveKey,
      ).regimes[1].name,
    ).toBe('South Reach');
    expect(() =>
      inspectSave(
        syntheticArchive(syntheticPayload({ nameReferencesPassword: true })),
        archiveKey,
      ),
    ).toThrow('Unsupported save format.');
  });
  it('bounds nesting, string allocation and array dimensions before allocation', () => {
    const integer = (n: number) => {
      const bytes = Buffer.alloc(4);
      bytes.writeInt32LE(n);
      return bytes;
    };
    const nested = Buffer.concat([
      ...Array.from({ length: 130 }, (_, n) =>
        Buffer.concat([Buffer.from([16]), integer(300 + n), integer(1)]),
      ),
      Buffer.from([10]),
    ]);
    const giantString = Buffer.concat([
      Buffer.from([6]),
      integer(300),
      Buffer.from([0x81, 0x80, 0x40]),
    ]);
    const giantArray = Buffer.concat([
      Buffer.from([15]),
      integer(300),
      integer(2147483647),
      Buffer.from([8]),
    ]);
    for (const extra of [nested, giantString, giantArray]) {
      const payload = Buffer.concat([
        syntheticPayload().subarray(0, -1),
        extra,
        Buffer.from([11]),
      ]);
      expect(() => inspectSave(syntheticArchive(payload), archiveKey)).toThrow(
        'The save exceeds safe inspection limits.',
      );
    }
  });
  it('handles cyclic references without recursion and rejects duplicate IDs and null-run overflow', () => {
    const integer = (n: number) => {
      const bytes = Buffer.alloc(4);
      bytes.writeInt32LE(n);
      return bytes;
    };
    const append = (extra: Buffer) =>
      syntheticArchive(
        Buffer.concat([
          syntheticPayload().subarray(0, -1),
          extra,
          Buffer.from([11]),
        ]),
      );
    expect(
      inspectSave(
        append(
          Buffer.concat([
            Buffer.from([16]),
            integer(300),
            integer(1),
            Buffer.from([9]),
            integer(300),
          ]),
        ),
        archiveKey,
      ).regimes,
    ).toHaveLength(2);
    for (const extra of [
      Buffer.concat([Buffer.from([6]), integer(200), Buffer.from([0])]),
      Buffer.concat([
        Buffer.from([16]),
        integer(300),
        integer(1),
        Buffer.from([13, 2]),
      ]),
    ]) {
      expect(() => inspectSave(append(extra), archiveKey)).toThrow(
        'The save is malformed or failed its integrity check.',
      );
    }
  });
});
