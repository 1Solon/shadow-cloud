import { crc32, inflateRawSync, deflateRawSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { bounded, requireFormat, SaveFormatError } from './errors';

export const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
export const MAX_PAYLOAD_BYTES = 64 * 1024 * 1024;
const table = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
  return n >>> 0;
});

// Called only after the source has passed readArchive's supported-profile checks.
export function rebuildArchive(
  source: Buffer,
  payload: Buffer,
  key: Uint8Array,
) {
  bounded(payload.length, MAX_PAYLOAD_BYTES);
  const oldCentral = source.readUInt32LE(source.length - 6);
  const local = Buffer.from(source.subarray(0, 30 + source.readUInt16LE(26)));
  const central = Buffer.from(source.subarray(oldCentral, source.length - 22));
  const end = Buffer.from(source.subarray(-22));
  const header = randomBytes(12);
  header[11] = source.readUInt16LE(10) >>> 8;
  const plain = Buffer.concat([header, deflateRawSync(payload)]);
  const keys = [0x12345678, 0x23456789, 0x34567890];
  const update = (byte: number) => {
    keys[0] = ((keys[0] >>> 8) ^ table[(keys[0] ^ byte) & 255]) >>> 0;
    keys[1] =
      (Math.imul((keys[1] + (keys[0] & 255)) >>> 0, 134775813) + 1) >>> 0;
    keys[2] =
      ((keys[2] >>> 8) ^ table[(keys[2] ^ (keys[1] >>> 24)) & 255]) >>> 0;
  };
  for (const byte of key) update(byte);
  const encrypted = Buffer.allocUnsafe(plain.length);
  for (let i = 0; i < plain.length; i++) {
    const temp = keys[2] | 2;
    encrypted[i] = plain[i] ^ ((Math.imul(temp, temp ^ 1) >>> 8) & 255);
    update(plain[i]);
  }
  const descriptor = Buffer.alloc(16);
  descriptor.writeUInt32LE(0x08074b50);
  for (const [offset, value] of [
    [4, crc32(payload)],
    [8, encrypted.length],
    [12, payload.length],
  ]) {
    descriptor.writeUInt32LE(value, offset);
    central.writeUInt32LE(value, offset + 12);
    // Preserve the source's optional zero local fields when a descriptor is used.
    if (local.readUInt32LE(offset + 10) !== 0)
      local.writeUInt32LE(value, offset + 10);
  }
  end.writeUInt32LE(local.length + encrypted.length + descriptor.length, 16);
  const output = Buffer.concat([local, encrypted, descriptor, central, end]);
  bounded(output.length, MAX_ARCHIVE_BYTES);
  requireFormat(readArchive(output, key).equals(payload));
  return output;
}

export function readArchive(bytes: Buffer, key: Uint8Array): Buffer {
  bounded(bytes.length, MAX_ARCHIVE_BYTES);
  if (bytes.length < 4 || bytes.readUInt32LE(0) !== 0x04034b50)
    throw new SaveFormatError('unsupported');
  requireFormat(bytes.length >= 98);
  // Conservative profile from the experiment: one entry, no ZIP64, no comment,
  // traditional encryption + deflate + signed data descriptor. No extraction.
  const end = bytes.length - 22;
  requireFormat(bytes.readUInt32LE(end) === 0x06054b50);
  if (
    bytes.readUInt16LE(end + 4) !== 0 ||
    bytes.readUInt16LE(end + 6) !== 0 ||
    bytes.readUInt16LE(end + 8) !== 1 ||
    bytes.readUInt16LE(end + 10) !== 1 ||
    bytes.readUInt16LE(end + 20) !== 0
  )
    throw new SaveFormatError('unsupported');
  const central = bytes.readUInt32LE(end + 16);
  requireFormat(
    central >= 30 &&
      central + 46 <= end &&
      central + bytes.readUInt32LE(end + 12) === end,
  );
  requireFormat(bytes.readUInt32LE(central) === 0x02014b50);
  if (
    bytes.readUInt16LE(6) !== 9 ||
    bytes.readUInt16LE(8) !== 8 ||
    bytes.readUInt16LE(4) > 20 ||
    bytes.readUInt16LE(central + 6) > 20 ||
    bytes.readUInt16LE(central + 8) !== 9 ||
    bytes.readUInt16LE(central + 10) !== 8 ||
    bytes.readUInt16LE(central + 34) !== 0 ||
    bytes.readUInt32LE(central + 42) !== 0 ||
    bytes.readUInt16LE(28) !== 0 ||
    bytes.readUInt16LE(central + 30) !== 0 ||
    bytes.readUInt16LE(central + 32) !== 0
  )
    throw new SaveFormatError('unsupported');
  const nameLength = bytes.readUInt16LE(26);
  const start = 30 + nameLength;
  requireFormat(
    nameLength > 0 &&
      bytes.readUInt16LE(central + 28) === nameLength &&
      central + 46 + nameLength === end,
  );
  requireFormat(
    bytes.subarray(30, start).equals(bytes.subarray(central + 46, end)),
  );
  requireFormat(bytes.readUInt32LE(10) === bytes.readUInt32LE(central + 12));
  const size = bounded(bytes.readUInt32LE(central + 20), MAX_ARCHIVE_BYTES);
  const expanded = bounded(bytes.readUInt32LE(central + 24), MAX_PAYLOAD_BYTES);
  const crc = bytes.readUInt32LE(central + 16);
  requireFormat(size >= 12 && start + size + 16 === central);
  const descriptor = start + size;
  requireFormat(
    bytes.readUInt32LE(descriptor) === 0x08074b50 &&
      bytes.readUInt32LE(descriptor + 4) === crc &&
      bytes.readUInt32LE(descriptor + 8) === size &&
      bytes.readUInt32LE(descriptor + 12) === expanded,
  );
  for (const [offset, expected] of [
    [14, crc],
    [18, size],
    [22, expanded],
  ]) {
    requireFormat(
      bytes.readUInt32LE(offset) === 0 ||
        bytes.readUInt32LE(offset) === expected,
    );
  }
  bounded(key.length, 1024);
  const keys = [0x12345678, 0x23456789, 0x34567890];
  const update = (byte: number) => {
    keys[0] = ((keys[0] >>> 8) ^ table[(keys[0] ^ byte) & 255]) >>> 0;
    keys[1] =
      (Math.imul((keys[1] + (keys[0] & 255)) >>> 0, 134775813) + 1) >>> 0;
    keys[2] =
      ((keys[2] >>> 8) ^ table[(keys[2] ^ (keys[1] >>> 24)) & 255]) >>> 0;
  };
  for (const byte of key) update(byte);
  const decrypted = Buffer.allocUnsafe(size);
  for (let i = 0; i < size; i++) {
    const temp = keys[2] | 2;
    const value = bytes[start + i] ^ ((Math.imul(temp, temp ^ 1) >>> 8) & 255);
    decrypted[i] = value;
    update(value);
  }
  requireFormat(decrypted[11] === bytes.readUInt16LE(10) >>> 8);
  const result = inflateRawSync(decrypted.subarray(12), {
    maxOutputLength: Math.max(1, expanded),
    info: true,
  }) as unknown as {
    buffer: Buffer;
    engine: { bytesWritten: number };
  };
  requireFormat(
    result.engine.bytesWritten === size - 12 &&
      result.buffer.length === expanded &&
      crc32(result.buffer) === crc,
  );
  return result.buffer;
}
