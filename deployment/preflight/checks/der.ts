// A strict DER reader for the dev root's extensions (P1.35p S1; verify-896, architecture 03:50Z). node:crypto exposes no
// name constraints (Node v26.10.0, measured: neither X509Certificate nor toLegacyObject() has them), and the lockfile
// holds no ASN.1 parser, so this walks the certificate itself. X.690 (02/2021) section 10.1 and 8.1.3.5: DER takes the
// definite form, the fewest length octets, and a short form below 128. RFC 5280 section 4.1: Certificate is
// SEQUENCE { tbsCertificate, signatureAlgorithm, signatureValue }, extensions is the last, explicitly tagged [3] field of
// tbsCertificate, and each Extension is SEQUENCE { extnID, critical BOOLEAN DEFAULT FALSE, extnValue OCTET STRING },
// so DER omits a false `critical` (X.690 11.5) and encodes true as 0xff (X.690 11.1).

/** Anything that is not DER, or not a certificate's shape; C18 fails on it. */
export class DerError extends Error {}

/** One tag-length-value: its tag octet, its contents, and all of its octets. */
export type Tlv = { tag: number; value: Buffer; bytes: Buffer };

/** An Extension's OID as its content octets in hex, whether it is critical, and its extnValue's content octets. */
export type Extension = { oid: string; critical: boolean; value: Buffer };

const SEQUENCE = 0x30;
const CONSTRUCTED = 0x20;

function readTlv(bytes: Buffer, at: number): Tlv {
  const tag = bytes[at];
  const first = bytes[at + 1];
  if (tag === undefined || first === undefined) throw new DerError("truncated");
  if ((tag & 0x1f) === 0x1f) throw new DerError("high tag number");
  let length = first;
  let header = 2;
  if (first >= 0x80) {
    const count = first & 0x7f;
    if (count === 0) throw new DerError("indefinite length");
    if (count > 3 || at + 2 + count > bytes.length) throw new DerError("length too long");
    length = 0;
    for (const octet of bytes.subarray(at + 2, at + 2 + count)) length = length * 256 + octet;
    if (bytes[at + 2] === 0 || length < 0x80) throw new DerError("length not in its shortest form");
    header += count;
  }
  if (at + header + length > bytes.length) throw new DerError("truncated");
  return {
    tag,
    value: bytes.subarray(at + header, at + header + length),
    bytes: bytes.subarray(at, at + header + length),
  };
}

/** The TLVs that fill `bytes` exactly, in order. */
export function children(bytes: Buffer): Tlv[] {
  const found: Tlv[] = [];
  for (let at = 0; at < bytes.length; at += (found.at(-1) as Tlv).bytes.length) found.push(readTlv(bytes, at));
  return found;
}

/** The one TLV that is all of `bytes`, with tag `tag`: no trailing octets. */
function only(bytes: Buffer, tag: number): Tlv {
  const [tlv, ...rest] = children(bytes);
  if (tlv === undefined || rest.length > 0 || tlv.tag !== tag) throw new DerError("not one element");
  return tlv;
}

/** Every constructed element below `tlv`, so a non-DER length anywhere in the certificate refuses. */
function walk(tlv: Tlv): void {
  if ((tlv.tag & CONSTRUCTED) !== 0) for (const child of children(tlv.value)) walk(child);
}

/** The certificate's extensions in order; throws DerError on anything that is not a DER certificate. */
export function certificateExtensions(der: Buffer): Extension[] {
  const certificate = only(der, SEQUENCE);
  walk(certificate);
  const [tbs, algorithm, signature, ...more] = children(certificate.value);
  if (tbs?.tag !== SEQUENCE || algorithm?.tag !== SEQUENCE || signature?.tag !== 0x03 || more.length > 0) {
    throw new DerError("not a certificate");
  }
  const fields = children(tbs.value);
  const at = fields.findIndex((field) => field.tag === 0xa3);
  if (at === -1) return [];
  if (at !== fields.length - 1) throw new DerError("extensions are not the last field");
  return children(only((fields[at] as Tlv).value, SEQUENCE).value).map(extension);
}

function extension(tlv: Tlv): Extension {
  if (tlv.tag !== SEQUENCE) throw new DerError("not an extension");
  const [oid, second, third, ...more] = children(tlv.value);
  const flag = third === undefined ? undefined : second;
  const value = third ?? second;
  if (oid?.tag !== 0x06 || value?.tag !== 0x04 || more.length > 0) throw new DerError("not an extension");
  if (flag !== undefined && (flag.tag !== 0x01 || !flag.value.equals(Buffer.from([0xff])))) {
    throw new DerError("critical is not DER's TRUE");
  }
  return { oid: oid.value.toString("hex"), critical: flag !== undefined, value: value.value };
}

/** One DER tag-length-value; lengths up to 65535, far beyond what the expected encodings hold. */
export function der(tag: number, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  const n = body.length;
  const length = n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : [0x82, n >> 8, n & 0xff];
  return Buffer.concat([Buffer.from([tag, ...length]), body]);
}
