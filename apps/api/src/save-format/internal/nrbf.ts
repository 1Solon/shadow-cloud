import { bounded, requireFormat, SaveFormatError } from './errors';

type Info = number | { name: string; library?: number };
type Meta = {
  name: string;
  library?: number;
  names: string[];
  types: number[];
  infos: Info[];
};
export type Value =
  | { kind: 'class'; name: string; meta: Meta; members: Map<string, Value> }
  | {
      kind: 'array';
      lengths: number[];
      lower: number[];
      values: Value[];
      type: number;
      info: Info;
      vector: boolean;
    }
  | { kind: 'string'; value: string; prefix: number; body: number; end: number }
  | { kind: 'primitive'; type: number; value: number | boolean | null }
  | { kind: 'ref'; id: number }
  | { kind: 'null'; count: number }
  | { kind: 'library' | 'end' };

// Data-only port of the local experiment; class names are inert metadata.
// Primitive arrays are skipped without per-element allocations. Null runs stay
// compact, references resolve once by ID, and cycles are never traversed.
export class Nrbf {
  private pos = 0;
  private work = 0;
  private slots = 0;
  private textBytes = 0;
  private readonly objects = new Map<number, Value>();
  private readonly metadata = new Map<number, Meta>();
  private readonly references = new Set<number>();
  private readonly libraries = new Set<number>();
  private readonly usedLibraries = new Set<number>();
  private readonly decoder = new TextDecoder('utf-8', {
    fatal: true,
    ignoreBOM: true,
  });
  constructor(private readonly bytes: Buffer) {}
  private take(n: number) {
    requireFormat(n >= 0 && this.pos + n <= this.bytes.length);
    const start = this.pos;
    this.pos += n;
    return this.bytes.subarray(start, this.pos);
  }
  private byte() {
    return this.take(1)[0];
  }
  private int() {
    return this.take(4).readInt32LE();
  }
  private text() {
    let length = 0;
    for (let shift = 0; shift <= 28; shift += 7) {
      const byte = this.byte();
      requireFormat(shift < 28 || byte <= 7);
      length += (byte & 127) * 2 ** shift;
      if (!(byte & 128)) {
        bounded(length, 1024 * 1024);
        this.textBytes += length;
        bounded(this.textBytes, 32 * 1024 * 1024);
        return this.decoder.decode(this.take(length));
      }
    }
    throw new SaveFormatError('malformed');
  }
  private primitive(type: Info): Value {
    requireFormat(typeof type === 'number');
    if (type === 1) {
      const n = this.byte();
      requireFormat(n <= 1);
      return { kind: 'primitive', type, value: n === 1 };
    }
    if (type === 8) return { kind: 'primitive', type, value: this.int() };
    const sizes: Record<number, number> = {
      2: 1,
      6: 8,
      7: 2,
      9: 8,
      10: 1,
      11: 4,
      12: 8,
      13: 8,
      14: 2,
      15: 4,
      16: 8,
    };
    if (sizes[type]) this.take(sizes[type]);
    else if (type === 3) {
      const first = this.byte();
      const count =
        first < 128
          ? 1
          : first >= 0xc2 && first < 0xe0
            ? 2
            : first >= 0xe0 && first < 0xf0
              ? 3
              : 0;
      requireFormat(count > 0);
      this.decoder.decode(
        Buffer.concat([Buffer.from([first]), this.take(count - 1)]),
      );
    } else if (type === 5) this.text();
    else throw new SaveFormatError('unsupported');
    return { kind: 'primitive', type, value: null };
  }
  private additional(type: number) {
    if (type === 0 || type === 7) {
      const primitive = this.byte();
      if (
        ![1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].includes(
          primitive,
        )
      )
        throw new SaveFormatError('unsupported');
      return primitive;
    }
    if (type === 3 || type === 4) {
      const name = this.text();
      const library = type === 4 ? this.int() : undefined;
      if (library !== undefined) this.usedLibraries.add(library);
      return { name, library };
    }
    if ([1, 2, 5, 6].includes(type)) return 0;
    throw new SaveFormatError('unsupported');
  }
  private register(id: number, value: Value) {
    requireFormat(id !== 0 && !this.objects.has(id));
    bounded(this.objects.size + 1, 750_000);
    this.objects.set(id, value);
    return value;
  }
  private value(depth: number): Value {
    let value: Value;
    do {
      value = this.record(depth);
    } while (value.kind === 'library');
    requireFormat(value.kind !== 'end');
    return value;
  }
  private array(
    id: number,
    lengths: number[],
    lower: number[],
    type: number,
    info: Info,
    depth: number,
    vector = true,
  ): Value {
    let count = 1;
    for (const n of lengths)
      count = bounded(count * bounded(n, 64 * 1024 * 1024), 64 * 1024 * 1024);
    const values: Value[] = [];
    const result = this.register(id, {
      kind: 'array',
      lengths,
      lower,
      values,
      type,
      info,
      vector,
    });
    const sizes: Record<number, number> = {
      1: 1,
      2: 1,
      6: 8,
      7: 2,
      8: 4,
      9: 8,
      10: 1,
      11: 4,
      12: 8,
      13: 8,
      14: 2,
      15: 4,
      16: 8,
    };
    if (type === 0) {
      // Variable-width primitive arrays are outside the compact-block profile.
      if (typeof info !== 'number' || !sizes[info])
        throw new SaveFormatError('unsupported');
      const block = this.take(count * sizes[info]);
      if (info === 1) for (const byte of block) requireFormat(byte <= 1);
      return result;
    }
    for (let consumed = 0; consumed < count;) {
      bounded(++this.slots, 4_000_000);
      const value = this.value(depth + 1);
      consumed += value.kind === 'null' ? value.count : 1;
      requireFormat(consumed <= count);
      values.push(value);
    }
    return result;
  }
  private record(depth: number): Value {
    bounded(depth, 128);
    bounded(++this.work, 4_000_000);
    const tag = this.byte();
    if (tag === 12) {
      const id = this.int();
      requireFormat(id > 0 && !this.libraries.has(id));
      this.text();
      this.libraries.add(id);
      return { kind: 'library' };
    }
    if (tag === 1 || tag === 4 || tag === 5) {
      const id = this.int();
      let meta: Meta | undefined;
      if (tag === 1) meta = this.metadata.get(this.int());
      else {
        const name = this.text();
        const count = bounded(this.int(), 4096);
        const names = Array.from({ length: count }, () => this.text());
        requireFormat(new Set(names).size === count);
        const types = Array.from({ length: count }, () => this.byte());
        const infos = types.map((type) => this.additional(type));
        const library = tag === 5 ? this.int() : undefined;
        if (library !== undefined) this.usedLibraries.add(library);
        meta = { name, library, names, types, infos };
        this.metadata.set(id, meta);
      }
      requireFormat(meta);
      const members = new Map<string, Value>();
      const result = this.register(id, {
        kind: 'class',
        name: meta.name,
        meta,
        members,
      });
      this.slots += meta.names.length;
      bounded(this.slots, 6_000_000);
      for (let n = 0; n < meta.names.length; n++) {
        const value =
          meta.types[n] === 0
            ? this.primitive(meta.infos[n])
            : this.value(depth + 1);
        requireFormat(value.kind !== 'null' || value.count === 1);
        members.set(meta.names[n], value);
      }
      return result;
    }
    if (tag === 6) {
      const id = this.int();
      const prefix = this.pos;
      const value = this.text();
      return this.register(id, {
        kind: 'string',
        value,
        prefix,
        body: this.pos - Buffer.byteLength(value),
        end: this.pos,
      });
    }
    if (tag === 7) {
      const id = this.int();
      const shape = this.byte();
      const rank = bounded(this.int(), 32);
      requireFormat(
        shape <= 5 && rank > 0 && (![0, 1, 3, 4].includes(shape) || rank === 1),
      );
      const lengths = Array.from({ length: rank }, () => this.int());
      const lower = Array.from({ length: rank }, () =>
        shape >= 3 ? this.int() : 0,
      );
      const type = this.byte();
      return this.array(
        id,
        lengths,
        lower,
        type,
        this.additional(type),
        depth,
        shape <= 1,
      );
    }
    if (tag >= 15 && tag <= 17) {
      const id = this.int();
      const count = this.int();
      return this.array(
        id,
        [count],
        [0],
        tag === 15 ? 0 : tag === 16 ? 2 : 1,
        tag === 15 ? this.byte() : 0,
        depth,
      );
    }
    if (tag === 8) return this.primitive(this.byte());
    if (tag === 9) {
      const id = this.int();
      this.references.add(id);
      return { kind: 'ref', id };
    }
    if (tag === 10) return { kind: 'null', count: 1 };
    if (tag === 13 || tag === 14) {
      const count = tag === 13 ? this.byte() : this.int();
      requireFormat(count > 0);
      return { kind: 'null', count };
    }
    if (tag === 11) return { kind: 'end' };
    throw new SaveFormatError('unsupported');
  }
  parse() {
    requireFormat(this.byte() === 0);
    const root = this.int();
    this.int();
    if (this.int() !== 1 || this.int() !== 0)
      throw new SaveFormatError('unsupported');
    while (this.record(0).kind !== 'end') {
      /* All records must be framed. */
    }
    requireFormat(this.pos === this.bytes.length && this.objects.has(root));
    for (const id of this.references) requireFormat(this.objects.has(id));
    for (const id of this.usedLibraries) requireFormat(this.libraries.has(id));
    for (const obj of this.objects.values()) {
      if (obj.kind === 'class') {
        obj.meta.names.forEach((name, n) =>
          this.validate(
            obj.members.get(name)!,
            obj.meta.types[n],
            obj.meta.infos[n],
          ),
        );
      } else if (obj.kind === 'array') {
        for (const value of obj.values)
          this.validate(value, obj.type, obj.info);
      }
    }
    return this.objects.get(root)!;
  }
  private validate(raw: Value, type: number, info: Info) {
    const value = this.resolve(raw);
    if (value.kind === 'null') {
      requireFormat(type !== 0);
      return;
    }
    if (type === 2) return;
    if (type === 0) {
      requireFormat(value.kind === 'primitive' && value.type === info);
    } else if (type === 1) {
      requireFormat(value.kind === 'string');
    } else if (type === 3 || type === 4) {
      requireFormat(typeof info !== 'number');
      let name: string | undefined;
      let library: number | undefined;
      if (value.kind === 'class') {
        name = value.name;
        library = value.meta.library;
      } else if (value.kind === 'array') {
        const primitives: Record<number, string> = {
          1: 'Boolean',
          2: 'Byte',
          3: 'Char',
          5: 'Decimal',
          6: 'Double',
          7: 'Int16',
          8: 'Int32',
          9: 'Int64',
          10: 'SByte',
          11: 'Single',
          12: 'TimeSpan',
          13: 'DateTime',
          14: 'UInt16',
          15: 'UInt32',
          16: 'UInt64',
        };
        if (typeof value.info !== 'number') {
          name = value.info.name;
          library = value.info.library;
        } else {
          const element =
            value.type === 0
              ? primitives[value.info]
              : {
                  1: 'String',
                  2: 'Object',
                  5: 'Object[]',
                  6: 'String[]',
                  7: `${primitives[value.info]}[]`,
                }[value.type];
          if (element) name = `System.${element}`;
        }
        if (name)
          name += value.vector
            ? '[]'
            : value.lengths.length === 1
              ? '[*]'
              : `[${','.repeat(value.lengths.length - 1)}]`;
      }
      requireFormat(name === info.name && library === info.library);
    } else {
      requireFormat(value.kind === 'array' && value.vector);
      requireFormat(
        type === 5
          ? value.type !== 0
          : type === 6
            ? value.type === 1
            : type === 7 && value.type === 0 && value.info === info,
      );
    }
  }
  resolve(value: Value): Value {
    if (value.kind !== 'ref') return value;
    const target = this.objects.get(value.id);
    requireFormat(target);
    return target;
  }
  passwordOwners() {
    const owners = new Map<Value, number>();
    for (const obj of this.objects.values()) {
      if (obj.kind !== 'class') continue;
      const raw = obj.members.get('PassWord');
      if (raw) {
        const value = this.resolve(raw);
        if (value.kind === 'string') owners.set(value, 0);
      }
    }
    for (const obj of this.objects.values()) {
      const children =
        obj.kind === 'class'
          ? obj.members.values()
          : obj.kind === 'array'
            ? obj.values
            : [];
      for (const raw of children) {
        const value = this.resolve(raw);
        const count = owners.get(value);
        if (count !== undefined) owners.set(value, count + 1);
      }
    }
    return owners;
  }
}
