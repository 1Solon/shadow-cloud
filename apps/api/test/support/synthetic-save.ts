import { randomBytes } from 'node:crypto';
import { deflateRawSync, crc32 } from 'node:zlib';

export const archiveKey = randomBytes(24);
const i = (value: number) => {
  const b = Buffer.alloc(4);
  b.writeInt32LE(value);
  return b;
};
const text = (value: string) => {
  const b = Buffer.from(value);
  const prefix: number[] = [];
  let n = b.length;
  do {
    prefix.push((n & 127) | (n > 127 ? 128 : 0));
    n >>>= 7;
  } while (n);
  return Buffer.concat([Buffer.from(prefix), b]);
};
type Field = [string, number, Buffer, number?];
function object(id: number, name: string, fields: Field[]) {
  return Buffer.concat([
    Buffer.from([5]),
    i(id),
    text(name),
    i(fields.length),
    ...fields.map(([name]) => text(name)),
    Buffer.from(fields.map(([, type]) => type)),
    ...fields
      .filter(([, type]) => type === 0)
      .map(([, , , primitive]) => Buffer.from([primitive!])),
    i(1),
    ...fields.map(([, , value]) => value),
  ]);
}
const string = (id: number, value: string) =>
  Buffer.concat([Buffer.from([6]), i(id), text(value)]);
const ref = (id: number) => Buffer.concat([Buffer.from([9]), i(id)]);

// Synthetic MS-NRBF graph using only field names/types observed in the experiment.
// Random ephemeral contents are not credentials for any account or campaign.
export function syntheticPayload(
  options: {
    protection?: boolean;
    password?: 'present' | 'null' | 'absent' | 'shared';
    dangling?: boolean;
    rootClass?: string;
    reuseMetadata?: boolean;
    nameReferencesPassword?: boolean;
    turn?: number;
    secret?: string;
  } = {},
) {
  const password = options.password ?? 'present';
  const regime = (id: number, name: string, ai: boolean, secret: boolean) =>
    object(id, 'WindowsApplication1.RegimeClass', [
      [
        'Name',
        1,
        options.nameReferencesPassword && id === 3
          ? ref(200)
          : string(id + 100, name),
      ],
      ['AI', 0, Buffer.from([+ai]), 1],
      ...(password === 'absent' && secret
        ? []
        : [
            [
              'PassWord',
              1,
              secret && password !== 'null'
                ? ref(options.dangling ? 9999 : 200)
                : Buffer.from([10]),
            ] satisfies Field,
          ]),
    ]);
  return Buffer.concat([
    Buffer.from([0]),
    i(1),
    i(-1),
    i(1),
    i(0),
    Buffer.from([12]),
    i(1),
    text('Synthetic'),
    object(1, options.rootClass ?? 'WindowsApplication1.DataClass', [
      ['PasswordsOn', 0, Buffer.from([+(options.protection ?? true)]), 1],
      ['Turn', 0, i(options.turn ?? 2), 8],
      ['RegimeObj', 2, ref(2)],
    ]),
    Buffer.from([16]),
    i(2),
    i(4),
    Buffer.from([10]),
    ref(3),
    ref(4),
    ref(5),
    regime(3, 'North Reach', false, true),
    options.reuseMetadata
      ? Buffer.concat([
          Buffer.from([1]),
          i(4),
          i(3),
          string(104, 'South Reach'),
          Buffer.from([0, 10]),
        ])
      : regime(4, 'South Reach', false, password === 'shared'),
    regime(5, 'Machine Domain', true, false),
    string(200, options.secret ?? randomBytes(12).toString('hex')),
    Buffer.from([11]),
  ]);
}

// Independent fixture writer: PKWARE traditional encryption, single deflated
// entry and signed descriptor, matching the experiment's flags=9 framing.
export function syntheticArchive(
  payload = syntheticPayload(),
  key = archiveKey,
) {
  const compressed = deflateRawSync(payload);
  const keys = [0x12345678, 0x23456789, 0x34567890];
  const updateCrc = (crc: number, byte: number) => {
    let value = (crc ^ byte) >>> 0;
    for (let j = 0; j < 8; j++)
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    return value >>> 0;
  };
  const update = (byte: number) => {
    keys[0] = updateCrc(keys[0], byte);
    keys[1] =
      (Math.imul((keys[1] + (keys[0] & 255)) >>> 0, 134775813) + 1) >>> 0;
    keys[2] = updateCrc(keys[2], keys[1] >>> 24);
  };
  for (const byte of key) update(byte);
  const plain = Buffer.concat([Buffer.alloc(12), compressed]);
  const encrypted = Buffer.from(
    plain.map((byte) => {
      const temp = keys[2] | 2;
      const cipher = byte ^ ((Math.imul(temp, temp ^ 1) >>> 8) & 255);
      update(byte);
      return cipher;
    }),
  );
  const name = Buffer.from('synthetic.se1');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(9, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(name.length, 26);
  const descriptor = Buffer.alloc(16);
  descriptor.writeUInt32LE(0x08074b50);
  descriptor.writeUInt32LE(crc32(payload), 4);
  descriptor.writeUInt32LE(encrypted.length, 8);
  descriptor.writeUInt32LE(payload.length, 12);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(9, 8);
  central.writeUInt16LE(8, 10);
  descriptor.copy(central, 16, 4);
  central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(
    local.length + name.length + encrypted.length + descriptor.length,
    16,
  );
  return Buffer.concat([
    local,
    name,
    encrypted,
    descriptor,
    central,
    name,
    end,
  ]);
}
